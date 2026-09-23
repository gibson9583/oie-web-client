export interface ConfigurationMapImportRow { key: string; value: string; comment: string }

// Swing uses Commons Configuration's PropertiesReader, not java.util.Properties:
// physical lines and values are trimmed, unknown value escapes retain their
// backslash, repeated values are first-wins, and comments are accumulated.
const trim = (value: string) => value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');

function unescape(value: string, key: boolean): string {
    let result = '';
    const escapes: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r' };
    for (let index = 0; index < value.length; index++) {
        const ch = value[index];
        if (ch !== '\\') { result += ch; continue; }
        const next = value[++index];
        if (next === undefined) { if (!key) result += '\\'; break; }
        if (next === 'u') {
            if (key) {
                while (value[index + 1] === 'u') index++;
                if (value[index + 1] === '+') index++;
            }
            const hex = value.slice(index + 1, index + 5);
            // Commons Configuration's value reader discards incomplete Unicode
            // escapes, while the key reader rejects them.
            if (!key && hex.length < 4) break;
            if (!/^[a-fA-F0-9]{4}$/.test(hex)) throw new Error(`Invalid Unicode escape: \\u${hex}`);
            result += String.fromCharCode(parseInt(hex, 16));
            index += 4;
        } else if (key && /^[0-7]$/.test(next)) {
            let octal = next;
            const limit = next <= '3' ? 3 : 2;
            while (octal.length < limit && /^[0-7]$/.test(value[index + 1] ?? '')) octal += value[++index];
            result += String.fromCharCode(parseInt(octal, 8));
        } else if (Object.hasOwn(escapes, next)) result += escapes[next];
        else result += key || ':#=!\\\'"'.includes(next) ? next : `\\${next}`;
    }
    return result;
}

function canonicalComment(lines: string[], first: boolean): string {
    let start = 0;
    if (first) {
        // A blank line separates the document header from the first key's
        // comment. Only exact empty lines are layout separators in Commons.
        const lastBlank = lines.lastIndexOf('');
        if (lastBlank >= 0) start = lastBlank + 1;
    }
    while (lines[start] === '') start++;
    return lines.slice(start).map(line => line.replace(/^[ \t]*[#!][ \t\f\v]*/, '')).join('\n');
}

export class MissingConfigurationMapInclude extends Error {
    constructor(public path: string, public optional: boolean) {
        super(`Select the included properties file "${path}".`);
    }
}

function includePath(parent: string, child: string): string {
    const normalized = child.replaceAll('\\', '/');
    const parts = (normalized.startsWith('/') ? normalized : parent.slice(0, parent.lastIndexOf('/') + 1) + normalized).split('/');
    const result: string[] = [];
    for (const part of parts) {
        if (part === '..' && result.length && result.at(-1) !== '..') result.pop();
        else if (part !== '.' && part !== '') result.push(part);
    }
    return result.join('/');
}

/** Parse the .properties format used by Swing's Configuration Map. */
export function parseConfigurationMap(content: string, options: {
    filename?: string;
    includes?: ReadonlyMap<string, string | null>;
} = {}): ConfigurationMapImportRow[] {
    const rows = new Map<string, ConfigurationMapImportRow>();

    // Commons interpolates getString twice. Each pass removes one escape '$',
    // resolves property references/defaults, and leaves unknown names intact.
    // Nested variable names are disabled, but defaults can contain references.
    function interpolate(value: string, path: string[] = []): string {
        let result = '', position = 0;
        while (position < value.length) {
            const start = value.indexOf('${', position);
            if (start < 0) return result + value.slice(position);
            let end = start + 2, depth = 1;
            for (; end < value.length; end++) {
                if (value.startsWith('${', end)) { depth++; end++; }
                else if (value[end] === '}' && --depth === 0) break;
            }
            if (depth) return result + value.slice(position);
            if (start > position && value[start - 1] === '$') {
                result += value.slice(position, start - 1) + '${';
                position = start + 2;
                continue;
            } else {
                result += value.slice(position, start);
                const name = value.slice(start + 2, end);
                const delimiter = name.indexOf(':-');
                const reference = delimiter < 0 ? name : name.slice(0, delimiter);
                if (rows.has(reference)) {
                    if (path.includes(reference)) throw new Error(`Cyclic property reference: ${[...path, reference].join(' → ')}`);
                    result += interpolate(rows.get(reference)!.value, [...path, reference]);
                } else if (delimiter >= 0) result += name.slice(delimiter + 2);
                else result += value.slice(start, end + 1);
            }
            position = end + 1;
        }
        return result;
    }

    function read(input: string, filename: string, path: string[]) {
        if (path.includes(filename)) throw new Error(`Cyclic properties include: ${[...path, filename].join(' → ')}`);
        let comments: string[] = [], logical = '';
        for (const physical of input.split(/\r\n|\r|\n/)) {
            const line = trim(physical);
            if (!line || line.startsWith('#') || line.startsWith('!')) { comments.push(physical); continue; }
            const trailing = line.match(/\\+$/)?.[0].length ?? 0;
            if (trailing % 2) { logical += line.slice(0, -1); continue; }
            logical += line;
            // Java's default regex whitespace is ASCII. Escaped separators and
            // whitespace belong to the key, while unescaped ones delimit it.
            const parts = /^((?:[^ \t\r\n\f\v\\:=]|\\.)*)(?:[ \t\r\n\f\v]*(?:[ \t\r\n\f\v]+|[:=])[ \t\r\n\f\v]*)?(.*)$/.exec(logical);
            if (!parts) throw new Error('Invalid configuration property');
            const key = unescape(trim(parts[1]), true);
            const value = unescape(trim(parts[2]), false);
            const optional = key.toLowerCase() === 'includeoptional';
            if (key.toLowerCase() === 'include' || optional) {
                const target = includePath(filename, interpolate(value));
                if ([...path, filename].includes(target)) throw new Error(`Cyclic properties include: ${[...path, filename, target].join(' → ')}`);
                if (!options.includes?.has(target)) throw new MissingConfigurationMapInclude(target, optional);
                const included = options.includes.get(target);
                if (included == null && !optional) throw new Error(`Required included properties file "${target}" was not selected.`);
                if (included != null) read(included, target, [...path, filename]);
            } else {
                const comment = canonicalComment(comments, rows.size === 0 && path.length === 0);
                const existing = rows.get(key);
                if (existing) {
                    if (comment) existing.comment += (existing.comment ? '\n' : '') + comment;
                } else rows.set(key, { key, value, comment });
            }
            comments = [];
            logical = '';
        }
    }
    read(content, includePath('', options.filename ?? 'configuration.properties'), []);
    return [...rows.values()].map(row => ({ ...row, value: interpolate(interpolate(row.value)) }))
        .sort((a, b) => a.key.toLowerCase() < b.key.toLowerCase() ? -1 : a.key.toLowerCase() > b.key.toLowerCase() ? 1 : 0);
}

/** Collect explicitly selected include files before changing any editor draft. */
export async function loadConfigurationMapImport(content: string, filename: string,
    selectInclude: (include: MissingConfigurationMapInclude) => Promise<string | null | undefined>
): Promise<ConfigurationMapImportRow[] | null> {
    const includes = new Map<string, string | null>();
    for (;;) {
        try { return parseConfigurationMap(content, { filename, includes }); }
        catch (error) {
            if (!(error instanceof MissingConfigurationMapInclude)) throw error;
            const included = await selectInclude(error);
            if (included === undefined) return null;
            includes.set(error.path, included);
        }
    }
}

/** Write values that the Swing PropertiesReader can read without losing escapes
 * or boundary whitespace. Unicode spaces avoid the reader's physical trim. */
export function serializeConfigurationMap(rows: ConfigurationMapImportRow[]): string {
    // Commons scans nested references even when the outer reference is escaped.
    // Each reference needs one escape for each of getString's two passes.
    const literalReferences = (value: string) => value.replace(/\$\{/g, () => '$$${');
    function escape(value: string, key: boolean): string {
        let result = '';
        for (let index = 0; index < value.length; index++) {
            const ch = value[index], code = value.charCodeAt(index);
            if (code <= 32 || code > 126) result += `\\u${code.toString(16).padStart(4, '0')}`;
            else if (ch === '\\' || (key && ':=#!'.includes(ch))) result += `\\${ch}`;
            else result += ch;
        }
        return result;
    }
    const lines: string[] = [];
    for (const row of rows) {
        if (!row.key.trim()) continue;
        if (row.comment.trim()) for (const line of row.comment.split(/\r\n|\r|\n/)) lines.push(`# ${line}`);
        lines.push(`${escape(row.key, true)}=${escape(literalReferences(row.value), false)}`);
    }
    return lines.join('\n') + (lines.length ? '\n' : '');
}

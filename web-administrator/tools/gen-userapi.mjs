/*
 * Generate TypeScript declarations for the Mirth/OIE JavaScript User API from
 * the engine's `userutil` Javadoc, plus a hand-authored preamble for the
 * variables the engine injects into a script's Rhino scope. The output is a
 * committed JS-string module (client/core/userapi.generated.js) that monaco.js
 * feeds to Monaco via addExtraLib, giving member completion / signature help /
 * hover docs in the script editors.
 *
 * Read-only on the engine — no engine changes. Regenerate when the API changes:
 *   npm run gen:userapi                     # engine at ../oie
 *   OIE_SRC=/path/to/oie npm run gen:userapi
 *
 * The Java parser is intentionally forgiving: it extracts the common shapes and
 * falls back to `any` for anything it can't map (under-declare, never break).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));            // web-administrator/tools
const repoRoot = resolve(here, '..', '..');                     // oie-web-client
const engineSrc = process.env.OIE_SRC || process.argv[2] || resolve(repoRoot, '..', 'oie');
const PKG_DIRS = [
    join(engineSrc, 'server/src/com/mirth/connect/server/userutil'),
    join(engineSrc, 'server/src/com/mirth/connect/userutil'),
];
const OUT = join(here, '..', 'client/core/userapi.generated.js');

/* ---- Java → TS type mapping ------------------------------------------------- */

function mapType(javaType) {
    let t = String(javaType).trim().replace(/\bfinal\b/g, '').trim();
    if (!t || t === 'void') return 'void';
    // Arrays.
    if (/\[\]$/.test(t)) {
        const base = t.replace(/\[\]$/, '');
        return base === 'byte' ? 'any' : `${mapType(base)}[]`;
    }
    // Generic collections → element[] ; maps → loose record.
    let m = t.match(/^(?:java\.util\.)?(List|Set|Collection|Iterator|Iterable)<(.+)>$/);
    if (m) return `${mapType(m[2])}[]`;
    if (/^(?:java\.util\.)?(Map|HashMap|Properties)\b/.test(t)) return '{ [key: string]: any }';
    // Strip any remaining generic args we don't model.
    t = t.replace(/<.*>$/, '');
    const SIMPLE = {
        String: 'string', CharSequence: 'string', char: 'string', Character: 'string',
        int: 'number', long: 'number', short: 'number', byte: 'number', double: 'number',
        float: 'number', Integer: 'number', Long: 'number', Short: 'number', Double: 'number',
        Float: 'number', Number: 'number', boolean: 'boolean', Boolean: 'boolean',
        Object: 'any', void: 'void',
    };
    const short = t.replace(/^.*\./, '');                       // drop package qualifier
    if (SIMPLE[t] || SIMPLE[short]) return SIMPLE[t] || SIMPLE[short];
    // A known userutil type keeps its name; anything else is opaque.
    return KNOWN.has(short) ? short : 'any';
}

/* ---- Javadoc → JSDoc -------------------------------------------------------- */

function parseDoc(block) {
    if (!block) return { summary: '', params: {}, returns: '' };
    const lines = block.replace(/\/\*\*+/g, '').replace(/\*+\//g, '')
        .split('\n').map((l) => l.replace(/^\s*\*?\s?/, '').replace(/\s+$/, ''));
    const params = {}; let returns = ''; const summaryParts = []; let tag = null;
    for (const line of lines) {
        const pm = line.match(/^@param\s+(\S+)\s*(.*)$/);
        const rm = line.match(/^@return\s*(.*)$/);
        if (pm) { tag = ['param', pm[1]]; params[pm[1]] = pm[2] || ''; continue; }
        if (rm) { tag = ['return']; returns = rm[1] || ''; continue; }
        if (/^@/.test(line)) { tag = null; continue; }          // @throws/@deprecated/etc.
        if (tag && line) {                                      // continuation of the current tag
            if (tag[0] === 'param') params[tag[1]] = (params[tag[1]] + ' ' + line).trim();
            else returns = (returns + ' ' + line).trim();
        } else if (!tag && line) summaryParts.push(line);
    }
    return { summary: summaryParts.join(' ').trim(), params, returns };
}

function jsdoc(doc, indent) {
    const out = [];
    if (doc.summary) out.push(doc.summary);
    for (const [name, desc] of Object.entries(doc.params)) out.push(`@param ${name} ${desc}`.trim());
    if (doc.returns) out.push(`@returns ${doc.returns}`.trim());
    if (!out.length) return '';
    const body = out.map((l) => `${indent} * ${l}`).join('\n');
    return `${indent}/**\n${body}\n${indent} */\n`;
}

/* ---- parse one .java file --------------------------------------------------- */

function splitParams(s) {
    const parts = []; let depth = 0, cur = '';
    for (const ch of s) {
        if (ch === '<') depth++; else if (ch === '>') depth--;
        if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((p) => p.trim()).filter(Boolean);
}

function parseClass(src) {
    const cm = src.match(/public\s+(?:final\s+)?(?:abstract\s+)?class\s+(\w+)/);
    if (!cm) return null;
    const className = cm[1];
    const lines = src.split('\n');
    const methods = [];
    let docBuf = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const t = line.trim();
        // Capture a javadoc block (may span lines).
        if (t.startsWith('/**')) {
            let block = '', j = i;
            for (; j < lines.length; j++) { block += lines[j] + '\n'; if (lines[j].includes('*/')) break; }
            docBuf = block; i = j; continue;
        }
        // Method declaration: public [static] [final] [<T>] <ReturnType> name(...)
        const mm = t.match(/^public\s+(static\s+)?(?:final\s+)?(?:<[^>]+>\s*)?([A-Za-z_][\w.$]*(?:<[^;{]*?>)?(?:\[\])?)\s+([A-Za-z_]\w*)\s*\(/);
        if (mm && t.includes('(')) {
            // Accumulate until the parameter list closes.
            let decl = t, j = i, depth = (decl.match(/\(/g) || []).length - (decl.match(/\)/g) || []).length;
            while (depth > 0 && j + 1 < lines.length) { j++; decl += ' ' + lines[j].trim(); depth += (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length; }
            const sig = decl.match(/^public\s+(static\s+)?(?:final\s+)?(?:<[^>]+>\s*)?([A-Za-z_][\w.$]*(?:<.*?>)?(?:\[\])?)\s+([A-Za-z_]\w*)\s*\(([\s\S]*?)\)/);
            if (sig && sig[3] !== className) {                  // skip constructors
                const isStatic = !!sig[1];
                const ret = mapType(sig[2]);
                const doc = parseDoc(docBuf);
                const params = splitParams(sig[4]).map((p) => {
                    const parts = p.replace(/\bfinal\b/g, '').trim().split(/\s+/);
                    const name = parts.pop();
                    const type = parts.join(' ');
                    return { name: name.replace(/[^\w]/g, '') || 'arg', type: type.endsWith('...') || /\.\.\./.test(p) ? `${mapType(type.replace('...', ''))}[]` : mapType(type) };
                });
                methods.push({ isStatic, ret, name: sig[3], params, doc });
            }
            docBuf = null; i = j; continue;
        }
        if (t && !t.startsWith('//') && !t.startsWith('@')) docBuf = null;   // doc only attaches to the next decl
    }
    return { className, methods };
}

/* ---- collect classes -------------------------------------------------------- */

const files = [];
for (const dir of PKG_DIRS) {
    let entries;
    try { entries = readdirSync(dir); } catch { console.warn(`(skip, not found) ${dir}`); continue; }
    for (const f of entries) if (f.endsWith('.java') && f !== 'package-info.java') files.push(join(dir, f));
}
if (!files.length) { console.error(`No userutil sources under ${engineSrc}. Set OIE_SRC.`); process.exit(1); }

// First pass: know the class names so mapType can keep userutil references.
const KNOWN = new Set(files.map((f) => f.replace(/.*\//, '').replace(/\.java$/, '')));

const classes = [];
const seen = new Set();
for (const file of files) {
    const parsed = parseClass(readFileSync(file, 'utf8'));
    if (!parsed || seen.has(parsed.className)) continue;
    seen.add(parsed.className);
    classes.push(parsed);
}
classes.sort((a, b) => a.className.localeCompare(b.className));

/* ---- emit ------------------------------------------------------------------- */

function emitClass(c) {
    const body = c.methods.map((m) => {
        const params = m.params.map((p) => `${p.name}: ${p.type}`).join(', ');
        return `${jsdoc(m.doc, '    ')}    ${m.isStatic ? 'static ' : ''}${m.name}(${params}): ${m.ret};`;
    }).join('\n');
    return `declare class ${c.className} {\n${body}\n}`;
}

const header = `/* GENERATED by tools/gen-userapi.mjs from the engine userutil Javadocs — DO NOT EDIT.
   Regenerate: npm run gen:userapi  (engine at ../oie or OIE_SRC). */`;
// Only the userutil classes (member completion / signatures / hover). The
// injected scope variables (msg, channelMap, logger, $gc, …) are offered by a
// dedicated completion provider in monaco.js, so they're not declared here.
const dts = ['/* ---- User API (com.mirth.connect[.server].userutil) ---- */', ...classes.map(emitClass)].join('\n\n');

writeFileSync(OUT, `${header}\nexport const USER_API_DTS = ${JSON.stringify(dts)};\n`, 'utf8');
const methodCount = classes.reduce((n, c) => n + c.methods.length, 0);
console.log(`Wrote ${OUT}\n  ${classes.length} classes, ${methodCount} methods, from ${engineSrc}`);

import { createHash } from 'node:crypto';

// Stable URLs such as core/api.js can remain in the browser cache across WAR
// upgrades. Give the entire runtime module graph a content-derived generation,
// including relative imports and plugin URLs resolved against the WAR context.
export function rewriteImportMap(html, modules) {
    const match = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
    if (!match) throw new Error('build-war: the built index is missing its import map');
    let map;
    try {
        map = JSON.parse(match[1]);
    } catch (e) {
        throw new Error(`build-war: could not parse the built import map — ${e.message}`);
    }

    const hash = createHash('sha256');
    for (const [name, bytes] of [...modules].sort(([a], [b]) => a.localeCompare(b))) {
        hash.update(name).update('\0').update(createHash('sha256').update(bytes).digest());
    }
    const generation = hash.digest('hex');
    const target = (name) => `./${name}?v=${generation}`;
    const rewriteTargets = (imports) => {
        for (const [key, url] of Object.entries(imports || {})) {
            if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) continue;
            imports[key] = modules.has(url.slice(1)) ? target(url.slice(1)) : `.${url}`;
        }
    };
    rewriteTargets(map.imports);
    for (const scope of Object.values(map.scopes || {})) rewriteTargets(scope);

    map.imports ||= {};
    for (const name of modules.keys()) {
        // Root aliases serve legacy plugins; context-relative keys also catch
        // imports from versioned parents and dynamically loaded plugin entries.
        map.imports[`/${name}`] = target(name);
        map.imports[`./${name}`] = target(name);
    }
    // JSON quoting alone does not protect an inline script element: the HTML
    // parser recognizes </script> even inside JSON strings. Keep filenames as
    // data if a build input contains HTML delimiters.
    const json = JSON.stringify(map, null, 2).replace(/</g, '\\u003c');
    const rendered = `<script type="importmap">\n${json}\n    </script>`;
    return html.slice(0, match.index) + rendered + html.slice(match.index + match[0].length);
}

/*
 * Build an OIE-deployable WAR without changing the standalone Node/Docker
 * artifact. OIE's embedded Jetty scans <OIE_HOME>/webapps/*.war and derives the
 * application context from the filename; index.jsp discovers that context at
 * runtime and points the SPA at the sibling engine API.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
    cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
    rmSync, statSync, writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');
const clientDir = path.join(root, 'client');
const packageInfo = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const artifactName = process.env.OIE_WAR_NAME || 'oie-webadmin.war';

if (!/^[a-zA-Z0-9._-]+\.war$/.test(artifactName)) {
    throw new Error('OIE_WAR_NAME must be a simple filename ending in .war');
}

const outputDir = path.resolve(root, process.env.OIE_WAR_OUTPUT_DIR || 'dist');
const artifact = path.join(outputDir, artifactName);
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'oie-web-client-war-'));
const stage = path.join(temporaryRoot, 'stage');

function runBuild() {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['run', 'build'], {
        cwd: root,
        env: { ...process.env, OIE_WEBADMIN_BUILD_BASE: './' },
        stdio: 'inherit'
    });
    if (result.status !== 0) throw new Error(`Web client build failed (${result.status ?? 'no exit status'})`);
}

function runtimeFile(source) {
    const name = path.basename(source);
    if (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.map')) return false;
    if (name.endsWith('.test.js')) return false;
    return true;
}

function copyRuntimeDir(name, filter = runtimeFile) {
    const source = path.join(clientDir, name);
    if (existsSync(source)) cpSync(source, path.join(stage, name), { recursive: true, filter });
}

function bundledPluginManifests() {
    const pluginsDir = path.join(root, 'plugins');
    const manifests = [];
    for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(pluginsDir, entry.name, 'plugin.json');
        if (!existsSync(manifestPath)) continue;
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.enabled === false) continue;
        if (!manifest.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(manifest.id)) {
            throw new Error(`${manifestPath}: missing a valid plugin id`);
        }
        manifests.push({
            id: manifest.id,
            name: manifest.name || manifest.id,
            version: manifest.version || '0.0.0',
            author: manifest.author || '',
            description: manifest.description || '',
            apiMin: manifest.oie?.apiMin ? String(manifest.oie.apiMin) : null,
            entry: manifest.client?.entry ? `/plugins/${manifest.id}/${manifest.client.entry}` : null
        });
    }
    return manifests;
}

// A .replace() that fails loudly if its target has drifted, rather than silently
// leaving the string unchanged (and the WAR subtly wrong).
function replaceExpected(html, from, to) {
    if (!html.includes(from)) {
        throw new Error(`build-war: expected marker not found in the built index: ${from}`);
    }
    return html.replace(from, to);
}

// Vite does not process import maps, so their targets stay root-absolute — correct
// for the Node/Vite server at "/", wrong for a WAR mounted under the engine context.
// Rewrite the map structurally (every in-app target becomes context-relative) so new
// or reordered entries are covered automatically instead of by enumerating today's
// keys; prefix keys stay absolute so legacy plugin imports still resolve.
function rewriteImportMap(html) {
    const match = html.match(/<script type="importmap">\s*([\s\S]*?)\s*<\/script>/);
    if (!match) throw new Error('build-war: the built index is missing its import map');
    let map;
    try {
        map = JSON.parse(match[1]);
    } catch (e) {
        throw new Error(`build-war: could not parse the built import map — ${e.message}`);
    }
    const toContextRelative = (url) =>
        typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? `.${url}` : url;
    const rewriteTargets = (imports) => {
        for (const key of Object.keys(imports || {})) imports[key] = toContextRelative(imports[key]);
    };
    rewriteTargets(map.imports);
    for (const scope of Object.values(map.scopes || {})) rewriteTargets(scope);
    const rendered = `<script type="importmap">\n${JSON.stringify(map, null, 2)}\n    </script>`;
    return html.slice(0, match.index) + rendered + html.slice(match.index + match[0].length);
}

function indexJsp() {
    const builtIndex = path.join(clientDir, 'dist', 'index.html');
    let html = readFileSync(builtIndex, 'utf8');

    // Make the import map's root-absolute targets context-relative for the WAR.
    html = rewriteImportMap(html);

    // Point the SPA at its deployed servlet context and the sibling engine API.
    html = replaceExpected(html,
        '<meta name="oie-webadmin-app-base" content="">',
        '<base href="<%= appContext %>/">\n    <meta name="oie-webadmin-app-base" content="<%= appContext %>">');
    html = replaceExpected(html,
        '<meta name="oie-webadmin-api-base" content="/api">',
        '<meta name="oie-webadmin-api-base" content="<%= engineContext %>/api">');

    return `<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>\n<%\n` +
        `response.setStatus(200);\n` +
        `response.setHeader("Cache-Control", "no-cache");\n` +
        `response.setHeader("X-Content-Type-Options", "nosniff");\n` +
        `response.setHeader("Referrer-Policy", "same-origin");\n` +
        `String appContext = request.getContextPath();\n` +
        `int contextBoundary = appContext.lastIndexOf('/');\n` +
        `String engineContext = contextBoundary > 0 ? appContext.substring(0, contextBoundary) : "";\n` +
        `%>\n${html}`;
}

const webXml = `<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://xmlns.jcp.org/xml/ns/javaee"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://xmlns.jcp.org/xml/ns/javaee http://xmlns.jcp.org/xml/ns/javaee/web-app_3_1.xsd"
         version="3.1">
    <display-name>OIE Web Client</display-name>
    <welcome-file-list>
        <welcome-file>index.jsp</welcome-file>
    </welcome-file-list>
    <error-page>
        <error-code>404</error-code>
        <location>/index.jsp</location>
    </error-page>
    <mime-mapping>
        <extension>wasm</extension>
        <mime-type>application/wasm</mime-type>
    </mime-mapping>
</web-app>
`;

const manifest = `Manifest-Version: 1.0
Implementation-Title: OIE Web Client
Implementation-Version: ${packageInfo.version}
Built-By: npm run build:war

`;

try {
    runBuild();
    mkdirSync(stage, { recursive: true });

    // Hashed Vite shell/chunks first; index.html becomes the context-aware JSP.
    cpSync(path.join(clientDir, 'dist'), stage, {
        recursive: true,
        filter: (source) => path.basename(source) !== 'index.html'
    });
    writeFileSync(path.join(stage, 'index.jsp'), indexJsp());

    // Framework modules and plugin assets are intentionally runtime-loaded and
    // therefore live beside (not inside) the Vite shell bundle.
    for (const name of ['core', 'connectors', 'datatypes', 'vendor', 'assets']) copyRuntimeDir(name);
    cpSync(path.join(root, 'plugins'), path.join(stage, 'plugins'), {
        recursive: true,
        filter: runtimeFile
    });

    mkdirSync(path.join(stage, 'webadmin'), { recursive: true });
    writeFileSync(path.join(stage, 'webadmin', 'plugins.json'), JSON.stringify(bundledPluginManifests(), null, 2) + '\n');
    writeFileSync(path.join(stage, 'webadmin', 'config.json'), JSON.stringify({
        engines: [{ name: 'This OIE server' }],
        devMode: false,
        version: packageInfo.version,
        codeTemplateCompletions: true,
        deployment: 'war'
    }, null, 2) + '\n');

    mkdirSync(path.join(stage, 'WEB-INF'), { recursive: true });
    mkdirSync(path.join(stage, 'META-INF'), { recursive: true });
    writeFileSync(path.join(stage, 'WEB-INF', 'web.xml'), webXml);
    writeFileSync(path.join(stage, 'META-INF', 'MANIFEST.MF'), manifest);
    cpSync(path.join(repoRoot, 'LICENSE'), path.join(stage, 'META-INF', 'LICENSE'));

    mkdirSync(outputDir, { recursive: true });
    execFileSync('jar', ['--create', '--file', artifact, '-C', stage, '.'], { stdio: 'inherit' });

    const entries = execFileSync('jar', ['--list', '--file', artifact], { encoding: 'utf8' });
    for (const required of ['index.jsp', 'WEB-INF/web.xml', 'webadmin/config.json', 'webadmin/plugins.json']) {
        if (!entries.split(/\r?\n/).includes(required)) throw new Error(`WAR validation failed: missing ${required}`);
    }
    const sizeMiB = (statSync(artifact).size / 1024 / 1024).toFixed(1);
    console.log(`\nWAR: ${artifact} (${sizeMiB} MiB)`);
    console.log('Deploy: copy it to <OIE_HOME>/webapps/ and restart OIE.');
} finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
}

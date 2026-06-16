/*
 * Regenerate ./oie-schema.d.ts from the engine's OpenAPI spec.
 *
 * The engine already serves /api/openapi.json (swagger-jaxrs2 + @Operation
 * annotations) — no engine change needed. This fetches that spec, strips the
 * example payloads that confuse the generator, and runs openapi-typescript to
 * produce the committed type file consumed by index.d.ts.
 *
 * Usage:
 *   npm run gen:schema -w @oie/web-api          # via the web admin proxy on :3030 (adds the CSRF header)
 *   OIE_OPENAPI_URL=https://host:8443/api/openapi.json npm run gen:schema -w @oie/web-api
 *       # for a direct engine URL with a self-signed cert, also set NODE_TLS_REJECT_UNAUTHORIZED=0
 *   node gen-schema.mjs ./some-openapi.json     # from a local spec file (offline)
 *
 * The output is committed, so normal builds never need a live engine — rerun
 * this only when the engine's API changes.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const here = dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] || process.env.OIE_OPENAPI_URL || 'http://localhost:3030/api/openapi.json';

let spec;
if (/^https?:/i.test(src)) {
    const res = await fetch(src, { headers: { 'X-Requested-With': 'OpenIntegrationEngine-WebAdmin' } });
    if (!res.ok) throw new Error(`Failed to fetch ${src}: ${res.status} ${res.statusText}`);
    spec = await res.json();
} else {
    spec = JSON.parse(readFileSync(src, 'utf8'));
}

// Strip example payloads (they trip up the generator); promote a lone `default`
// response to a 2XX so typed responses resolve. Mirrors the OIE oieapi-types pipeline.
function clean(node) {
    if (!node || typeof node !== 'object') return;
    delete node.examples;
    if (node.responses && Object.keys(node.responses).length === 1 && node.responses.default) {
        node.responses['2XX'] = node.responses.default;
    }
    for (const key of Object.keys(node)) clean(node[key]);
}
clean(spec);

const out = join(here, 'oie-schema.d.ts');
writeFileSync(out, astToString(await openapiTS(spec)), 'utf8');
console.log(`Wrote ${out} from ${src}`);

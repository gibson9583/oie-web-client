import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';

export const root = path.resolve(import.meta.dirname, '..');
export function sourceFiles() {
    return globSync(['web-administrator/client/**/*.{ts,tsx}', 'web-administrator/plugins/**/*.{ts,tsx}'], {
        cwd: root, exclude: file => /(^|\/)(vendor|dist|node_modules|locales)$/.test(file)
    }).filter(file => !/\.d\.ts$|\.test\./.test(file)).sort();
}
export function astOf(file) {
    return parse(readFileSync(path.join(root, file), 'utf8'), { sourceType: 'module',
        plugins: ['typescript', ...(file.endsWith('.tsx') ? ['jsx'] : [])] });
}
export function visit(node, fn, parent) {
    if (!node?.type || fn(node, parent) === false) return;
    for (const [key, value] of Object.entries(node)) {
        if (['loc', 'comments', 'leadingComments', 'trailingComments', 'innerComments'].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(child => visit(child, fn, node));
        else if (value && typeof value === 'object') visit(value, fn, node);
    }
}
export const functionName = node => node.callee?.name ?? node.callee?.property?.name;
export const translationCalls = new Set(['t', 'tc', 'tx']);
export function extract() {
    const messages = {};
    const scopes = new Map();
    const richMessages = new Set();
    for (const file of sourceFiles()) {
        if (file.endsWith("/core/i18n.ts")) continue;
        const scope = file.startsWith('web-administrator/plugins/') ? file.split('/')[2] : '';
        if (!scopes.has(scope)) scopes.set(scope, new Set());
        const ast = astOf(file);
        const bindings = new Map();
        visit(ast, node => {
            if (node.type === 'ImportDeclaration' && /i18n\.js$|^@oie\/web-ui$/.test(node.source.value)) {
                for (const spec of node.specifiers) if (['t', 'tc', 'tx'].includes(spec.imported?.name)) bindings.set(spec.local.name, spec.imported.name);
            }
            if (node.type === 'VariableDeclarator' && node.id.type === 'ObjectPattern' && node.init?.type === 'CallExpression' && functionName(node.init) === 'scope') {
                for (const prop of node.id.properties) if (['t', 'tc', 'tx'].includes(prop.key?.name)) bindings.set(prop.value.name, prop.key.name);
            }
        });
        visit(ast, node => {
            if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier' || !bindings.has(node.callee.name)) return;
            const name = bindings.get(node.callee.name);
            const context = name === 'tc' ? node.arguments[0] : null;
            const message = node.arguments[name === 'tc' ? 1 : 0];
            if (message?.type !== 'StringLiteral' || context && context.type !== 'StringLiteral') {
                throw new Error(file + ':' + node.loc.start.line + ': translation messages must be literals');
            }
            const key = context ? context.value + '\u0004' + message.value : message.value;
            if (name === 'tx') richMessages.add(key);
            const refs = (messages[key] ??= []);
            if (!refs.includes(file)) refs.push(file);
            scopes.get(scope).add(key);
            // Values may themselves contain translated labels or rich elements.
            // Keep traversing so those nested messages are extracted too.
        });
    }
    return { messages: Object.fromEntries(Object.entries(messages).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)), scopes, richMessages };
}

// A reviewed occurrence budget for remaining protocol values, identifiers,
// code examples and English developer reference material. New UI prose must
// use t/tc/tx; deleting an occurrence does not buy room for a different literal.
import { readFileSync, writeFileSync } from 'node:fs';
import { astOf, sourceFiles, root, visit, translationCalls, functionName } from './i18n-source.mjs';

export function candidates(ast) {
    const found = [];
    visit(ast, (node, parent) => {
        if (parent?.type === 'CallExpression' && translationCalls.has(functionName(parent)) &&
            parent.arguments.indexOf(node) < (functionName(parent) === 'tc' ? 2 : 1)) return false;
        if (['ImportDeclaration', 'TSLiteralType'].includes(node.type)) return false;
        if (node.type !== 'StringLiteral' && node.type !== 'JSXText' && node.type !== 'TemplateElement') return;
        if (parent?.type === 'ObjectProperty' && parent.key === node) return;
        if (parent?.type === 'ObjectProperty' && ['class', 'className', 'style', 'text'].includes(parent.key?.name)) return;
        if (parent?.type === 'ExportNamedDeclaration') return;
        if (parent?.type === 'JSXAttribute' && !['title', 'placeholder', 'label', 'aria-label', 'alt'].includes(parent.name.name)) return;
        const value = node.type === 'TemplateElement' ? node.value.cooked : node.value;
        if (!value || !(/[A-Z][a-z]{2}|[a-z]+ [a-z]+/.test(value) || node.type === 'TemplateElement' && /[A-Za-z][ \t]|[ \t][A-Za-z]/.test(value))) return;
        if (/^(?:[./#]|https?:|com\.|java\.)/.test(value) || /^[a-z][a-zA-Z0-9.]*$/.test(value)) return;
        if (['SwitchCase', 'TSLiteralType', 'MemberExpression'].includes(parent?.type)) return;
        if (parent?.type === 'BinaryExpression' && ['===', '!==', '==', '!='].includes(parent.operator)) return;
        found.push({ key: parent?.type + ':' + value, line: node.loc.start.line });
    });
    return found;
}

export function inventory() {
    const output = {};
    for (const file of sourceFiles()) {
        // Runtime/code catalogs contain program text, not interface copy.
        if (/\/(?:i18n|country-regions|userapi\.generated|reference-catalog|step-script|script-completions|sent-format)\.ts$/.test(file)) continue;
        for (const { key } of candidates(astOf(file))) {
            const id = file + '\u0004' + key;
            output[id] = (output[id] ?? 0) + 1;
        }
    }
    return Object.fromEntries(Object.entries(output).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    const file = root + '/tools/i18n-literals.json';
    const current = inventory();
    if (process.argv.includes('--record-reviewed')) writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
    else {
        const baseline = JSON.parse(readFileSync(file, 'utf8'));
        const additions = Object.keys(current).filter(key => current[key] > (baseline[key] ?? 0));
        if (additions.length) { console.error('Untranslated literals added:\n' + additions.join('\n')); process.exitCode = 1; }
        else console.log('[i18n] No new raw UI literals');
    }
}

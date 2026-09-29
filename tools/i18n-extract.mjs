import { readFileSync, writeFileSync } from 'node:fs';
import { extract, root } from './i18n-source.mjs';
const { messages } = extract();
const target = root + '/web-administrator/client/locales/messages.json';
const output = JSON.stringify(messages, null, 2) + '\n';
if (process.argv.includes('--check')) {
    if (readFileSync(target, 'utf8') !== output) throw new Error('Run npm run i18n:extract to update source references.');
} else writeFileSync(target, output);
console.log('[i18n] ' + Object.keys(messages).length + ' source messages');

import { writeFileSync } from 'node:fs';
import { extract, root } from './i18n-source.mjs';
const { messages } = extract();
writeFileSync(root + '/web-administrator/client/locales/messages.json', JSON.stringify(messages, null, 2) + '\n');
console.log('[i18n] ' + Object.keys(messages).length + ' source messages');

import { readFileSync, existsSync } from 'node:fs';
import { IntlMessageFormat } from 'intl-messageformat';
import { extract, root } from './i18n-source.mjs';

// Argument kind, select choices, exact-number plural branches and rich tags
// must agree. Plural categories may vary by language (Chinese has only other).
export { messageSignature as signature } from '../web-administrator/client/core/i18n.js';
import { messageSignature as signature } from '../web-administrator/client/core/i18n.js';
export function validateMessage(source, translation, rich = true) {
    const message = source.includes('\u0004') ? source.split('\u0004').slice(1).join('\u0004') : source;
    const sourceAst = new IntlMessageFormat(message, 'en', undefined, { ignoreTag: !rich }).getAst();
    const targetAst = new IntlMessageFormat(translation, 'zh-CN', undefined, { ignoreTag: !rich }).getAst();
    if (signature(sourceAst) !== signature(targetAst)) throw new Error('ICU arguments, tags or choices differ');
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
    const { scopes, richMessages } = extract();
    let errors = 0;
    for (const [scope, messages] of scopes) {
        const file = scope ? 'web-administrator/plugins/' + scope + '/i18n/zh-CN.json' : 'web-administrator/client/locales/zh-CN.json';
        const catalog = existsSync(root + '/' + file) ? JSON.parse(readFileSync(root + '/' + file, 'utf8')) : {};
        let covered = 0;
        for (const message of messages) {
            try { validateMessage(message, catalog[message] ?? message, richMessages.has(message)); }
            catch (error) { console.error(file, JSON.stringify(message), error.message); errors++; }
            if (Object.hasOwn(catalog, message)) covered++;
        }
        for (const [key, value] of Object.entries(catalog)) {
            try { validateMessage(key, value, richMessages.has(key)); } catch (error) { console.error(file, JSON.stringify(key), error.message); errors++; }
            if (!messages.has(key)) console.warn('[i18n] Obsolete:', file, JSON.stringify(key));
        }
        if (messages.size) console.log('[i18n] ' + (scope || 'host') + ': ' + covered + '/' + messages.size + ' translated');
    }
    if (errors) process.exitCode = 1;
}

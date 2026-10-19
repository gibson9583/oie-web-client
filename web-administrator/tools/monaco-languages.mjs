import { dirname, relative, resolve, sep } from 'node:path';

// Rhino scripts plus the stock document/message/connector editors. HTML embeds
// CSS, and Monaco implements JavaScript IntelliSense with its TypeScript service.
export const HOST_DEFINITIONS = Object.freeze(['css', 'html', 'javascript', 'sql', 'typescript', 'xml']);
export const HOST_SERVICES = Object.freeze(['css', 'html', 'json', 'typescript']);

function languagePath(monacoMain, file) {
    return relative(resolve(dirname(monacoMain), '../languages'), file).split(sep).join('/');
}

/** Retain Monaco's generic editor contributions without its language catalog. */
export function hostMonacoLanguages(monacoMain) {
    const registrations = new Set([
        ...HOST_DEFINITIONS.map(id => `definitions/${id}/register.js`),
        ...HOST_SERVICES.map(id => `features/${id}/register.js`)
    ]);
    return {
        name: 'host-monaco-languages',
        setup(builder) {
            builder.onResolve({ filter: /[/\\]languages[/\\](?:definitions|features)[/\\][^/\\]+[/\\]register\.js$/ }, args => {
                const path = languagePath(monacoMain, resolve(args.resolveDir, args.path));
                if (!path.startsWith('../') && !registrations.has(path)) {
                    return { path: 'unselected-language', namespace: 'host-monaco-languages' };
                }
            });
            builder.onLoad({ filter: /.*/, namespace: 'host-monaco-languages' }, () => ({ contents: '', loader: 'js' }));
        }
    };
}

/** Fail closed if a dependency upgrade introduces an unselected language. */
export function assertHostMonacoLanguages(metafile, monacoMain) {
    const definitions = new Set(), services = new Set();
    for (const input of Object.keys(metafile.inputs)) {
        const path = languagePath(monacoMain, resolve(input));
        if (path.startsWith('../')) continue;
        if (path === 'definitions/_.contribution.js') continue; // Shared registration helper.
        if (path === 'features/common/lspLanguageFeatures.js') continue; // Shared data-editor adapters.
        const [kind, id, file] = path.split('/');
        if (kind === 'definitions') {
            if (!HOST_DEFINITIONS.includes(id)) throw new Error(`Unselected Monaco language definition: ${path}`);
            if (file === 'register.js') definitions.add(id);
        } else if (kind === 'features' && HOST_SERVICES.includes(id)) {
            if (file === 'register.js') services.add(id);
        } else {
            throw new Error(`Unselected Monaco language service: ${path}`);
        }
    }
    if (HOST_DEFINITIONS.some(id => !definitions.has(id)) || HOST_SERVICES.some(id => !services.has(id))) {
        throw new Error('A required host Monaco language registration is missing.');
    }
    return { definitions: [...definitions].sort(), services: [...services].sort() };
}

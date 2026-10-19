import type * as MonacoNs from 'monaco-editor';

export interface EditorLanguageDefinition {
    configuration?: MonacoNs.languages.LanguageConfiguration;
    tokensProvider: MonacoNs.languages.IMonarchLanguage;
}

export interface EditorLanguageProvider {
    aliases?: string[];
    extensions?: string[];
    /** Fetch the plugin's grammar on demand. Failed/timed-out loads may be retried. */
    load(): EditorLanguageDefinition | Promise<EditorLanguageDefinition>;
}

interface Registration {
    provider: EditorLanguageProvider;
    loading: Promise<boolean> | null;
    registered?: boolean;
}

const registrations = new Map<string, Registration>();
const LOAD_TIMEOUT_MS = 10000;

/** Register metadata only; the provider runs when an editor requests this id. */
export function registerEditorLanguage(id: string, provider: EditorLanguageProvider): void {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(id)) throw new Error('Invalid editor language id.');
    if (!provider || typeof provider.load !== 'function') throw new Error('An editor language loader is required.');
    if (registrations.has(id)) throw new Error(`Editor language already registered: ${id}`);
    registrations.set(id, { provider: { load: provider.load.bind(provider), aliases: provider.aliases?.slice(), extensions: provider.extensions?.slice() }, loading: null });
}

/** Internal: optional failures leave the requesting editor on its textarea. */
export function ensureEditorLanguage(monaco: typeof MonacoNs, id: string): Promise<boolean> {
    const entry = registrations.get(id);
    if (!entry) return Promise.resolve(true);
    if (entry.loading) return entry.loading;
    entry.loading = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const installed: MonacoNs.IDisposable[] = [];
        try {
            // Plugins cannot replace a language already owned by the host.
            if (!entry.registered && (monaco.languages.getLanguages().some(language => language.id === id)
                || ['js', 'rhino', 'text'].includes(id))) return true;
            const definition = await Promise.race([
                Promise.resolve().then(() => entry.provider.load()),
                new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), LOAD_TIMEOUT_MS); })
            ]);
            // A timed-out provider can finish later, but must not register then.
            if (!definition?.tokensProvider) return false;
            if (!entry.registered) {
                monaco.languages.register({ id, aliases: entry.provider.aliases, extensions: entry.provider.extensions });
                entry.registered = true; // Monaco's public registration API has no unregister.
            }
            if (definition.configuration) installed.push(monaco.languages.setLanguageConfiguration(id, definition.configuration));
            installed.push(monaco.languages.setMonarchTokensProvider(id, definition.tokensProvider));
            return true;
        } catch {
            for (const disposable of installed.reverse()) disposable.dispose();
            return false;
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    })().then(loaded => {
        if (!loaded) entry.loading = null;
        return loaded;
    });
    return entry.loading;
}

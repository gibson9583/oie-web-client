import { h, modal, promptDialog } from '@oie/web-ui';
import { uuid } from '@oie/web-api';
import type { LibraryImportCallbacks } from './code-template-import.js';

/** Shared Swing import decisions for standalone templates, libraries and channel bundles. */
export function libraryImportCallbacks(assertSession: () => void, ids: Map<string, string>): LibraryImportCallbacks {
    return {
        resolveConflict: async (kind, name) => {
            assertSession();
            const label = kind === 'library' ? 'Library' : 'Code Template';
            const choice = await new Promise<'overwrite' | 'copy' | 'skip' | null>(resolve => {
                modal({
                    title: `Import ${label} Conflict`,
                    body: h('div', kind === 'library'
                        ? `The library "${name}" already exists. Update its settings and merge its templates, or import a separate copy? Existing templates will be kept.`
                        : `The code template "${name}" already exists. Replace its code and settings, or import a separate copy?`),
                    onClose: () => resolve(null),
                    buttons: [
                        { label: 'Cancel', onClick: () => resolve(null) },
                        { label: kind === 'library' ? 'Skip Library' : 'Keep Existing', onClick: () => resolve('skip') },
                        { label: 'Import as Copy', primary: true, onClick: () => resolve('copy') },
                        { label: 'Overwrite', danger: true, onClick: () => resolve('overwrite') }
                    ]
                });
            });
            assertSession();
            return choice;
        },
        rename: async (kind, name) => {
            assertSession();
            const label = kind === 'library' ? 'Library' : 'Code Template';
            const renamed = await promptDialog(`Import ${label} Name`,
                name ? `"${name}" is already in use. Enter a different name for the imported ${label.toLowerCase()}.`
                    : `Enter a name for the imported ${label.toLowerCase()}.`, name ? `${name} (imported)` : '');
            assertSession();
            return renamed;
        },
        newId: key => {
            assertSession();
            if (!ids.has(key)) ids.set(key, uuid());
            return ids.get(key)!;
        }
    };
}

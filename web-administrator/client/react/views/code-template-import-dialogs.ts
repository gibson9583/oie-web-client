import { t as translate } from "../../core/i18n.js";
import { h, modal, promptDialog } from '@oie/web-ui';
import { uuid } from '@oie/web-api';
import type { LibraryImportCallbacks } from './code-template-import.js';

/** Shared Swing import decisions for standalone templates, libraries and channel bundles. */
export function libraryImportCallbacks(assertSession: () => void, ids: Map<string, string>): LibraryImportCallbacks {
    return {
        resolveConflict: async (kind, name) => {
            assertSession();
            const label = kind === 'library' ? translate("Library") : translate("Code Template");
            const choice = await new Promise<'overwrite' | 'copy' | 'skip' | null>(resolve => {
                modal({
                    title: translate("Import {value1} Conflict", { value1: String(label) }),
                    body: h('div', kind === 'library'
                        ? translate("The library \"{value1}\" already exists. Update its settings and merge its templates, or import a separate copy? Existing templates will be kept.", { value1: String(name) })
                        : translate("The code template \"{value1}\" already exists. Replace its code and settings, or import a separate copy?", { value1: String(name) })),
                    onClose: () => resolve(null),
                    buttons: [
                        { label: translate("Cancel"), onClick: () => resolve(null) },
                        { label: kind === 'library' ? translate("Skip Library") : translate("Keep Existing"), onClick: () => resolve('skip') },
                        { label: translate("Import as Copy"), primary: true, onClick: () => resolve('copy') },
                        { label: translate("Overwrite"), danger: true, onClick: () => resolve('overwrite') }
                    ]
                });
            });
            assertSession();
            return choice;
        },
        rename: async (kind, name) => {
            assertSession();
            const label = kind === 'library' ? translate("Library") : translate("Code Template");
            const renamed = await promptDialog(translate("Import {value1} Name", { value1: String(label) }),
                name ? translate("\"{value1}\" is already in use. Enter a different name for the imported {value2}.", { value1: String(name), value2: String(label.toLowerCase()) })
                    : translate("Enter a name for the imported {value1}.", { value1: String(label.toLowerCase()) }), name ? `${name} (imported)` : '');
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

import { t } from '../../core/i18n.js';
import { h, modal, promptDialog } from '@oie/web-ui';
import { uuid } from '@oie/web-api';
import type { LibraryImportCallbacks } from './code-template-import.js';

/** Shared Swing import decisions for standalone templates, libraries and channel bundles. */
export function libraryImportCallbacks(assertSession: () => void, ids: Map<string, string>): LibraryImportCallbacks {
    return {
        resolveConflict: async (kind, name) => {
            assertSession();
            const label = kind === 'library' ? t("Library") : t("Code Template");
            const choice = await new Promise<'overwrite' | 'copy' | 'skip' | null>(resolve => {
                modal({
                    title: t("Import {value1} Conflict", { value1: String(label) }),
                    body: h('div', kind === 'library'
                        ? t("The library \"{value1}\" already exists. Update its settings and merge its templates, or import a separate copy? Existing templates will be kept.", { value1: String(name) })
                        : t("The code template \"{value1}\" already exists. Replace its code and settings, or import a separate copy?", { value1: String(name) })),
                    onClose: () => resolve(null),
                    buttons: [
                        { label: t("Cancel"), onClick: () => resolve(null) },
                        { label: kind === 'library' ? t("Skip Library") : t("Keep Existing"), onClick: () => resolve('skip') },
                        { label: t("Import as Copy"), primary: true, onClick: () => resolve('copy') },
                        { label: t("Overwrite"), danger: true, onClick: () => resolve('overwrite') }
                    ]
                });
            });
            assertSession();
            return choice;
        },
        rename: async (kind, name) => {
            assertSession();
            const label = kind === 'library' ? t("Library") : t("Code Template");
            const renamed = await promptDialog(t("Import {value1} Name", { value1: String(label) }),
                name ? t("\"{value1}\" is already in use. Enter a different name for the imported {value2}.", { value1: String(name), value2: String(label.toLowerCase()) })
                    : t("Enter a name for the imported {value1}.", { value1: String(label.toLowerCase()) }), name ? `${name} (imported)` : '');
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

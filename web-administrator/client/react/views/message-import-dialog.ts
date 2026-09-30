import { t } from '../../core/i18n.js';
import { checkbox, h, modal, select } from '@oie/web-ui';
import { pickMessageFiles } from '../../core/message-import-files.js';

export type MessageImportSource = { recursive: boolean } & ({ path: string } | { files: File[] });

export function messageImportDialog(assertSession: () => void): Promise<MessageImportSource | null> {
    return new Promise(resolve => {
        const source = select([
            { value: 'files', label: t("My Computer — Files or Archives") },
            { value: 'folder', label: t("My Computer — Folder") },
            { value: 'server', label: t("Server") }
        ], 'files', { 'aria-label': t("Import From"), onChange: () => { path.disabled = source.value !== 'server'; } });
        const path = h('input', { type: 'text', disabled: true, 'aria-label': t("Server File/Folder/Archive") }) as HTMLInputElement;
        const recursive = checkbox(t("Include Sub-folders"), true);
        const error = h('div', { role: 'alert' });
        modal({
            title: t("Import Messages"),
            body: h('div', { class: 'flex flex-col gap-3' },
                h('label', t("Import From"), source),
                h('label', t("Server File/Folder/Archive"), path), recursive.el,
                h('p', t("RECEIVED, QUEUED, or PENDING messages will be set to ERROR upon import.")), error),
            onClose: () => resolve(null),
            buttons: [
                { label: t("Cancel"), onClick: () => resolve(null) },
                { label: t("Import"), primary: true, onClick: async () => {
                    try {
                        assertSession();
                        if (source.value === 'server') {
                            if (!path.value.trim()) { error.textContent = t("Please enter a file/folder to import."); return false; }
                            resolve({ path: path.value, recursive: recursive.input.checked });
                        } else {
                            const files = await pickMessageFiles(source.value === 'folder');
                            assertSession();
                            if (!files) return false;
                            resolve({ files, recursive: recursive.input.checked });
                        }
                    } catch {
                        resolve(null);
                    }
                } }
            ]
        });
    });
}

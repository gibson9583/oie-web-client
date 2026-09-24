import { checkbox, h, modal, select } from '@oie/web-ui';
import { pickMessageFiles } from '../../core/message-import-files.js';

export type MessageImportSource = { recursive: boolean } & ({ path: string } | { files: File[] });

export function messageImportDialog(assertSession: () => void): Promise<MessageImportSource | null> {
    return new Promise(resolve => {
        const source = select([
            { value: 'files', label: 'My Computer — Files or Archives' },
            { value: 'folder', label: 'My Computer — Folder' },
            { value: 'server', label: 'Server' }
        ], 'files', { 'aria-label': 'Import From', onChange: () => { path.disabled = source.value !== 'server'; } });
        const path = h('input', { type: 'text', disabled: true, 'aria-label': 'Server File/Folder/Archive' }) as HTMLInputElement;
        const recursive = checkbox('Include Sub-folders', true);
        const error = h('div', { role: 'alert' });
        modal({
            title: 'Import Messages',
            body: h('div', { class: 'flex flex-col gap-3' },
                h('label', 'Import From', source),
                h('label', 'Server File/Folder/Archive', path), recursive.el,
                h('p', 'RECEIVED, QUEUED, or PENDING messages will be set to ERROR upon import.'), error),
            onClose: () => resolve(null),
            buttons: [
                { label: 'Cancel', onClick: () => resolve(null) },
                { label: 'Import', primary: true, onClick: async () => {
                    try {
                        assertSession();
                        if (source.value === 'server') {
                            if (!path.value.trim()) { error.textContent = 'Please enter a file/folder to import.'; return false; }
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

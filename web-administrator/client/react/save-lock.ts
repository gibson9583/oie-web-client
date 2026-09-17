import * as store from '../core/store.js';

/** Keep a submitted editor model stable through persistence and any reload.
 * Dialogs remain usable for conflict decisions; the editor and its task pane
 * cannot accept another edit/save. The shell also fences route changes.
 */
export async function withEditorSave<T>(save: () => Promise<T>, label = 'Saving changes…'): Promise<T | false> {
    if (store.getState('editorSave')) return false;
    const token = {};
    const root = document.querySelector<HTMLElement>('.content-row');
    const previousInert = root?.inert;
    const previousBusy = root?.getAttribute('aria-busy');
    const focus = document.activeElement as HTMLElement | null;
    const status = document.createElement('div');
    status.className = 'p-2 text-center';
    status.setAttribute('role', 'status');
    status.textContent = label;
    if (root) {
        // WebKit can keep sending text to an already-focused input after its
        // ancestor becomes inert. Remove that focus before freezing the form.
        if (focus && root.contains(focus)) focus.blur();
        root.inert = true;
        root.setAttribute('aria-busy', 'true');
        root.before(status);
    }
    store.setState('editorSave', token);
    try { return await save(); }
    finally {
        if (root) {
            root.inert = previousInert || false;
            if (previousBusy === null || previousBusy === undefined) root.removeAttribute('aria-busy');
            else root.setAttribute('aria-busy', previousBusy);
        }
        status.remove();
        if (store.getState('editorSave') === token) {
            store.setState('editorSave', null);
            if (focus?.isConnected && !document.querySelector('[role="dialog"]')) focus.focus();
        }
    }
}

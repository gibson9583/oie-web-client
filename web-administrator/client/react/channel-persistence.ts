import { confirmDialog } from '@oie/web-ui';
import * as store from '../core/store.js';
import { saveChannelModel } from '../core/channel-save.js';
import { captureEngineSession } from '../core/engine-fetch.js';
import { channelDependencyState, persistLibraryAssociations, persistChannelDependencies } from '../core/channel-dependencies.js';

/** UI continuations must stop quietly when their initiating session has ended. */
export function channelSessionActive(): () => boolean {
    let assertSession: () => void;
    try { assertSession = captureEngineSession(); }
    catch { return () => false; }
    return () => {
        try { assertSession(); return true; }
        catch { return false; }
    };
}

export const confirmLibraryOverwrite = () => confirmDialog('Code Template Libraries Modified',
    'One or more code templates or libraries have been modified since you last refreshed. Do you want to overwrite the changes?',
    { danger: true, okLabel: 'Overwrite' });

export async function persistChannelModel(channel: any): Promise<boolean> {
    const assertSession = captureEngineSession();
    assertSession();
    const saved = await saveChannelModel(channel, {
        userId: store.getState('user')?.id,
        skipUnchanged: true,
        confirmCreationRetry: () => confirmDialog('Creation Outcome Unknown',
            'The previous create request did not return a result and the channel is not visible yet. The engine may still be processing it. Retry creation with the same channel ID?',
            { danger: true, okLabel: 'Retry Creation' }),
        confirmConflict: () => confirmDialog('Channel Modified',
            'This channel has been modified since you first opened it, or its edit timestamp could not be verified. Overwrite the saved channel with your changes?',
            { danger: true, okLabel: 'Overwrite' })
    });
    assertSession();
    if (saved) store.setState('editingChannelNew', false);
    return saved;
}

/** Classic/subeditor saves also finish shared writes carried from the wizard. */
export async function persistChannelEdits(channel: any): Promise<boolean> {
    const assertSession = captureEngineSession();
    assertSession();
    const saved = await persistChannelModel(channel);
    assertSession();
    if (!saved) return false;
    const pending = channelDependencyState(channel);
    const version = channel['@version'] || store.getState('serverVersion');
    const librariesSaved = await persistLibraryAssociations(channel, pending.libraries, version, confirmLibraryOverwrite);
    assertSession();
    if (!librariesSaved) return false;
    await persistChannelDependencies(pending.dependencies);
    assertSession();
    return true;
}

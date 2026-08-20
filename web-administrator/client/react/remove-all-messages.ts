import { checkbox, h, modal, promptDialog, toast } from '@oie/web-ui';
import api from '@oie/web-api';
import { platform } from '@oie/web-shell';
import { getPref } from '../core/prefs.js';

export interface RemoveAllMessagesChannel {
    channelId: string;
    name?: string;
    state?: string | null;
}

export interface RemoveAllMessagesDialogOptions {
    channels: RemoveAllMessagesChannel[];
    onDone?: () => void | Promise<void>;
}

/**
 * Swing-parity RemoveMessagesDialog shared by the dashboard and message browser.
 * Running channels are opt-in; when included, the engine stops them, removes
 * their messages, and restores the connectors that were active beforehand.
 */
export function openRemoveAllMessagesDialog({ channels, onDone }: RemoveAllMessagesDialogOptions): void {
    const selected = channels.filter(channel => channel?.channelId);
    if (!selected.length) {
        toast('Select a channel first', 'warn');
        return;
    }

    const stateOf = (channel: RemoveAllMessagesChannel) =>
        channel.state ? String(channel.state).toUpperCase() : null;
    const running = selected.filter(channel => {
        const state = stateOf(channel);
        return state !== null && state !== 'STOPPED';
    });
    const canClearStatistics = platform.checkTask('dashboard', 'doClearStats');
    const includeRunning = checkbox(
        'Include selected channels that are not stopped (they will be temporarily stopped while messages are removed)',
        false,
        { disabled: running.length === 0 }
    );
    const clearStatistics = checkbox(
        'Clear statistics for affected channels',
        canClearStatistics,
        { disabled: !canClearStatistics }
    );
    const scope = selected.length === 1 && selected[0].name
        ? `from ${selected[0].name}`
        : `for ${selected.length} selected channels`;

    modal({
        title: 'Remove All Messages',
        body: h('div',
            h('div.mb-[13px]',
                `Permanently remove all messages (including QUEUED) ${scope}? This cannot be undone.`),
            h('div', { class: 'flex flex-col gap-1.5' }, includeRunning.el, clearStatistics.el),
            running.length
                ? h('div.hint.mt-[13px]', running.length === 1
                    ? `One selected channel is currently ${stateOf(running[0])}. Select the first option to include it.`
                    : `${running.length} selected channels are not stopped. Select the first option to include them.`)
                : null,
            !canClearStatistics
                ? h('div.hint.mt-[13px]', 'You do not have permission to clear dashboard statistics.')
                : null),
        buttons: [
            { label: 'Cancel' },
            {
                label: 'Remove All', danger: true,
                onClick: async () => {
                    const shouldIncludeRunning = includeRunning.input.checked;
                    const targets = shouldIncludeRunning
                        ? selected
                        : selected.filter(channel => !running.includes(channel));

                    // A single running channel with the safe default left in
                    // place is a guaranteed no-op. Keep the options open instead
                    // of repeating the old false-success behavior.
                    if (!targets.length) {
                        toast('Select the option to include running channels, or stop the selected channel first.', 'warn');
                        return false;
                    }

                    if (getPref('confirmReprocessRemove') !== false) {
                        const text = await promptDialog('Remove All Messages',
                            `This will remove all messages for ${targets.length} channel${targets.length === 1 ? '' : 's'}. Type REMOVEALL to continue.`);
                        if (text === null) return false;
                        if (text !== 'REMOVEALL') {
                            toast('You must type REMOVEALL to remove all messages.', 'warn');
                            return false;
                        }
                    }

                    const failures: Array<{ channel: RemoveAllMessagesChannel; error: any }> = [];
                    for (const channel of targets) {
                        try {
                            await api.messages.removeAll(
                                channel.channelId,
                                shouldIncludeRunning,
                                clearStatistics.input.checked
                            );
                        } catch (error: any) {
                            failures.push({ channel, error });
                        }
                    }

                    await onDone?.();
                    if (failures.length) {
                        const failed = failures.map(({ channel }) => channel.name || channel.channelId).join(', ');
                        const details = failures.map(({ error }) => error?.message || String(error)).join('; ');
                        toast(`Remove all failed for ${failed}: ${details}`, 'error');
                        return;
                    }

                    const skipped = selected.length - targets.length;
                    const result = targets.length === 1 ? 'All messages removed' : `Messages removed from ${targets.length} channels`;
                    toast(skipped
                        ? `${result}; ${skipped} running channel${skipped === 1 ? '' : 's'} skipped`
                        : result);
                }
            }
        ]
    });
}

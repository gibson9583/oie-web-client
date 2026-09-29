import { t as translate } from "../core/i18n.js";
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
        toast(translate("Select a channel first"), 'warn');
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
        translate("Include selected channels that are not stopped (they will be temporarily stopped while messages are removed)"),
        false,
        { disabled: running.length === 0 }
    );
    const clearStatistics = checkbox(
        translate("Clear statistics for affected channels"),
        canClearStatistics,
        { disabled: !canClearStatistics }
    );
    const scope = selected.length === 1 && selected[0].name
        ? translate("from {name}", { name: selected[0].name })
        : translate("for {value1} selected channels", { value1: String(selected.length) });

    modal({
        title: translate("Remove All Messages"),
        body: h('div',
            h('div.mb-[13px]',
                translate("Permanently remove all messages (including QUEUED) {value1}? This cannot be undone.", { value1: String(scope) })),
            h('div', { class: 'flex flex-col gap-1.5' }, includeRunning.el, clearStatistics.el),
            running.length
                ? h('div.hint.mt-[13px]', running.length === 1
                    ? translate("One selected channel is currently {value1}. Select the first option to include it.", { value1: String(stateOf(running[0])) })
                    : translate("{value1} selected channels are not stopped. Select the first option to include them.", { value1: String(running.length) }))
                : null,
            !canClearStatistics
                ? h('div.hint.mt-[13px]', translate("You do not have permission to clear dashboard statistics."))
                : null),
        buttons: [
            { label: translate("Cancel") },
            {
                label: translate("Remove All"), danger: true,
                onClick: async () => {
                    const shouldIncludeRunning = includeRunning.input.checked;
                    const targets = shouldIncludeRunning
                        ? selected
                        : selected.filter(channel => !running.includes(channel));

                    // A single running channel with the safe default left in
                    // place is a guaranteed no-op. Keep the options open instead
                    // of repeating the old false-success behavior.
                    if (!targets.length) {
                        toast(translate("Select the option to include running channels, or stop the selected channel first."), 'warn');
                        return false;
                    }

                    if (getPref('confirmReprocessRemove') !== false) {
                        const text = await promptDialog(translate("Remove All Messages"),
                            translate("{value2, plural, one {This will remove all messages for {value1} channel. Type {token} to continue.} other {This will remove all messages for {value1} channels. Type {token} to continue.}}", { value1: String(targets.length), value2: targets.length, token: "REMOVEALL" }));
                        if (text === null) return false;
                        if (text !== 'REMOVEALL') {
                            toast(translate("You must type {token} to remove all messages.", { token: "REMOVEALL" }), 'warn');
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
                        toast(translate("Remove all failed for {value1}: {value2}", { value1: String(failed), value2: String(details) }), 'error');
                        return;
                    }

                    const skipped = selected.length - targets.length;
                    const result = targets.length === 1 ? translate("All messages removed") : translate("Messages removed from {value1} channels", { value1: String(targets.length) });
                    toast(skipped
                        ? translate("{value3, plural, one {{value1}; {value2} running channel skipped} other {{value1}; {value2} running channels skipped}}", { value1: String(result), value2: String(skipped), value3: skipped })
                        : result);
                }
            }
        ]
    });
}

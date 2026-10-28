import { useEffect, useState } from 'react';
import api from '@oie/web-api';
import { platform } from '@oie/web-shell';
import { captureEngineSession } from '../../core/engine-fetch.js';
import { INSPECT_CHANNEL_TASKS } from '../../core/route-tasks.js';
import * as router from '../../core/router.js';
import { AccessDeniedView } from '../access-denied.jsx';
import { Icon, useStoreKey } from '../bridges.jsx';
import { TaskButton } from '../ui.jsx';
import { ChannelInspectorTab } from './channel-inspector.jsx';

const canInspect = () => INSPECT_CHANNEL_TASKS.every(([group, task]) => platform.checkTask(group, task));
type InspectionLoad = { id: string; channel?: any; error?: string; denied?: boolean };

/** Saved configuration only. Never load or publish the editor's working copy. */
export function ChannelInspectorView({ params }: { params: { channelId: string } }) {
    const permissions = useStoreKey('webPlugins');
    const allowed = canInspect();
    const id = params.channelId;
    const [attempt, setAttempt] = useState(0);
    const [loaded, setLoaded] = useState<InspectionLoad>({ id });

    useEffect(() => {
        let alive = true;
        setLoaded({ id });
        if (!allowed || !canInspect()) return () => { alive = false; };
        let assertSession: (() => void) | undefined;
        (async () => {
            try {
                assertSession = captureEngineSession();
                const channel = await api.channels.get(id);
                if (!alive) return;
                assertSession();
                if (!canInspect()) { setLoaded({ id, denied: true }); return; }
                // The engine also returns no channel when RBAC redacts this ID.
                if (!channel?.id || String(channel.id) !== id) {
                    setLoaded({ id, error: 'This channel was not found or is not available with your permissions.' });
                    return;
                }
                setLoaded({ id, channel });
            } catch (error: any) {
                if (!alive) return;
                if (!canInspect()) { setLoaded({ id, denied: true }); return; }
                try { assertSession?.(); }
                catch { setLoaded({ id, error: 'The session changed. Reload the page to continue.' }); return; }
                setLoaded({ id, error: error?.status === 403
                    ? 'This channel is not available with your permissions.'
                    : 'The channel could not be loaded. Try again.' });
            }
        })();
        return () => { alive = false; };
    }, [id, attempt, allowed, permissions]);

    const reload = () => {
        if (!canInspect()) { setLoaded({ id, denied: true }); return; }
        setAttempt(value => value + 1);
    };
    if (!allowed || loaded.denied) return <AccessDeniedView />;
    const current: InspectionLoad = loaded.id === id ? loaded : { id };
    const loading = !current.channel && !current.error;
    return (
        <div className="view flex flex-col flex-1 min-h-0">
            <div className="view-header flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-line">
                <Icon name="search" size={18} />
                <h2 className="font-semibold break-words min-w-0">{current.channel?.name || 'Channel Inspector'}</h2>
                <span className="tag">Read only</span>
                <span className="flex-1" />
                <TaskButton label="Back to Channels" icon="channels" task="doShowChannel" group="view" onClick={() => router.navigate('/channels')} />
                <button type="button" className="btn" onClick={reload} disabled={loading}>Reload channel</button>
            </div>
            <div className="view-body flex flex-col flex-1 min-h-0">
                {loading ? <div className="dt-empty" role="status">Loading channel…</div>
                    : current.error ? <div className="dt-empty" role="alert"><p>{current.error}</p><button type="button" className="btn mt-3" onClick={reload}>Retry</button></div>
                        : <ChannelInspectorTab channel={current.channel} revision={attempt} dirty={false} isNew={false} readOnly />}
            </div>
        </div>
    );
}

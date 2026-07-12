/*
 * Guided Alert builder — a step-by-step alternative to the classic alert editor,
 * modeled on the channel wizard (chevron stepper, validate-on-advance, prompt on
 * leave, Review with Save). It produces the exact same alert model as newAlert()
 * (from alert-editor.jsx), so create/update/enable are unchanged.
 *
 * Steps: Basics → Trigger → Channels → Actions → Review. First pass: channel-level
 * selection (whole channels), not per-connector granularity — that stays in the
 * classic editor's channel tree.
 */

import { useEffect, useReducer, useRef, useState } from 'react';
import api from '@oie/web-api';
import { alertBaseline, confirmIfAlertChanged } from '../alert-conflict.js';
import { registerUnsavedCheck } from '../../core/unsaved.js';
import { toast, saveFile } from '@oie/web-ui';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { Icon } from '../bridges.jsx';
import { reactView, ViewTasks } from '../mount.jsx';
import { RailPane, TaskButton } from '../ui.jsx';
import { getPref } from '../../core/prefs.js';
import { useWizardModel, useWizardSteps, useLeaveGuard, WizardStepper, WizardHeader } from './wizard-frame.jsx';
import {
    newAlert, ERROR_EVENT_TYPES, ALERT_VARIABLES, eventTypeLabel, protocolsOf, recipientOptionsOf
} from './alert-editor.jsx';

const STEPS = ['Basics', 'Trigger', 'Channels', 'Actions', 'Review'];

// Normalize the action group list to an array with at least one group.
function normalizeActionGroups(a) {
    const ag = a.actionGroups = a.actionGroups || {};
    let groups = api.asList(ag.alertActionGroup);
    if (!groups.length) groups = [{ actions: null, subject: '', template: '' }];
    ag.alertActionGroup = groups;
    return a;
}

// Loader: resolve the alert to edit (see wizard-frame's useWizardModel), then
// render the wizard. /alerts/new/guided creates; /alerts/:alertId/guided edits.
function AlertWizardView({ params }) {
    const version = store.getState('serverVersion') || '4.5.2';
    const { model, isNew, ready } = useWizardModel({
        routeId: params && params.alertId,
        storeKey: 'editingAlert',
        isValid: (a) => !!a.trigger,
        makeNew: () => newAlert('', version),
        fetch: (id) => api.alerts.get(id),
        normalize: normalizeActionGroups,
        backPath: '/alerts'
    });
    if (!ready || !model) return <div className="view"><div className="view-body"><div className="dt-empty">Loading alert…</div></div></div>;
    return <AlertWizardInner key={model.id || 'new'} alert={model} isNew={isNew} />;
}

function AlertWizardInner({ alert, isNew }) {
    const baselineRef = useRef(null);   // server copy at edit start (alert conflict check)
    useEffect(() => {
        if (!isNew && alert.id) alertBaseline(alert.id).then((b) => { baselineRef.current = b; });
        // Tab-close guard: the wizard's dirty flag, synchronous (core/unsaved.js).
        return registerUnsavedCheck(() => dirtyRef.current);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const [, forceRender] = useReducer((x) => x + 1, 0);
    const switchingRef = useRef(false);
    const focusedRef = useRef('template');   // which text field a clicked variable inserts into
    const grp = alert.actionGroups.alertActionGroup[0];

    const dirtyRef = useRef(false);
    const savedRef = useRef(false);
    const bump = () => { dirtyRef.current = true; forceRender(); };

    const { step, setStep, maxStep, goStep } = useWizardSteps(isNew, STEPS.length);
    const [nameTouched, setNameTouched] = useState(!isNew);   // don't flag a blank name until touched
    const [saving, setSaving] = useState(false);
    const [data, setData] = useState({ channels: [], protocols: [], recipients: {} });
    const [chFilter, setChFilter] = useState('');

    useEffect(() => {
        let alive = true;
        Promise.all([api.channels.idsAndNames().catch(() => null), api.alerts.options().catch(() => null)]).then(([ch, opts]) => {
            if (!alive) return;
            const channels = [];
            for (const en of api.asList(ch && ch.entry)) {
                const p = api.asList(en && en.string);
                if (p.length >= 2) channels.push({ id: String(p[0]), name: String(p[1]) });
            }
            channels.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
            setData({ channels, protocols: protocolsOf(opts), recipients: recipientOptionsOf(opts) });
        });
        return () => { alive = false; };
    }, []);

    // Keep the model in the store + prompt-on-leave (shared with the channel wizard).
    useLeaveGuard({
        model: alert, isNew, storeKey: 'editingAlert', storeNewKey: 'editingAlertNew',
        entityLabel: 'alert', dirtyRef, savedRef, switchingRef, save: () => saveAlert(false)
    });

    /* ---- model helpers ---- */
    const trigger = alert.trigger;
    const ac = trigger.alertChannels = trigger.alertChannels || {};
    const errTypes = new Set(api.asList(trigger.errorEventTypes && trigger.errorEventTypes.errorEventType).map(String));
    const setErrType = (t, on) => {
        if (on) errTypes.add(t); else errTypes.delete(t);
        trigger.errorEventTypes = errTypes.size ? { errorEventType: [...errTypes] } : null;
        bump();
    };
    const enabledChannels = new Set(api.asList(ac.enabledChannels && ac.enabledChannels.string).map(String));
    const setChannel = (id, on) => {
        if (on) enabledChannels.add(id); else enabledChannels.delete(id);
        ac.enabledChannels = enabledChannels.size ? { string: [...enabledChannels] } : null;
        bump();
    };

    const actionList = () => api.asList(grp.actions, 'alertAction').filter((a) => a && typeof a === 'object');
    const setActions = (list) => { grp.actions = list.length ? { alertAction: list } : null; bump(); };
    const defaultProtocol = () => data.protocols[0] || 'Email';
    const addAction = () => setActions([...actionList(), { protocol: defaultProtocol(), recipient: '' }]);
    const patchAction = (i, patch) => setActions(actionList().map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
    const removeAction = (i) => setActions(actionList().filter((_, idx) => idx !== i));

    const insertVar = (v) => {
        const key = focusedRef.current === 'subject' ? 'subject' : 'template';
        grp[key] = `${grp[key] || ''}\${${v}}`;
        bump();
    };

    // Recipients are stored by id; show the friendly name (channel/user) in the summary.
    const recipientLabel = (protocol, rid) => {
        const opts = data.recipients[protocol];
        if (Array.isArray(opts)) { const o = opts.find((x) => x.value === rid); return o ? o.label : rid; }
        return rid;
    };
    const enabledNames = [...enabledChannels].map((id) => (data.channels.find((c) => c.id === id) || {}).name || id);

    /* ---- validation ---- */
    // Hard requirements (block save): name (parity with the classic editor) + a valid
    // error-filter regex (a genuine bug the classic editor doesn't catch).
    function nameError() { return String(alert.name || '').trim() ? null : 'An alert name is required.'; }
    function regexError() {
        const r = trigger.regex;
        if (!r || !String(r).trim()) return null;
        try { new RegExp(r); return null; } catch (e) { return `Invalid regular expression: ${e.message}`; }
    }
    function stepProblems(i) {
        if (STEPS[i] === 'Basics') return nameError() ? [nameError()] : [];
        if (STEPS[i] === 'Trigger') return regexError() ? [regexError()] : [];
        return [];
    }
    function allProblems() {
        return [nameError(), regexError()].filter(Boolean);
    }
    function firstProblemStep() {
        for (let i = 0; i < STEPS.length; i++) if (stepProblems(i).length) return i;
        return -1;
    }
    // Non-blocking heads-ups (an inert alert is still a valid draft, like the classic editor).
    function warnings() {
        const out = [];
        if (!enabledChannels.size && !ac.newChannelSource && !ac.newChannelDestination) out.push('No channels selected — this alert will never fire.');
        if (!actionList().length) out.push('No actions — this alert won’t notify anyone.');
        else if (actionList().some((a) => !String(a.recipient || '').trim())) out.push('An action has no recipient.');
        return out;
    }

    /* ---- navigation + save ---- */
    function tryNext() {
        const probs = stepProblems(step);
        if (probs.length) { toast(probs.join('  ·  '), 'warn'); return; }
        goStep(step + 1);
    }

    async function saveAlert(enable) {
        const probs = allProblems();
        if (probs.length) { const s = firstProblemStep(); if (s >= 0) setStep(s); toast(probs.join('  ·  '), 'warn'); return false; }
        if (enable) alert.enabled = true;
        try {
            if (isNew) {
                await api.alerts.create(alert);
            } else {
                if (!await confirmIfAlertChanged(alert.id, baselineRef.current)) return false;
                await api.alerts.update(alert.id, alert);
            }
            savedRef.current = true;
            dirtyRef.current = false;
            return true;
        } catch (e) {
            toast(e && e.message ? e.message : 'Could not save the alert.', 'error');
            return false;
        }
    }
    async function finish(enable) {
        if (saving) return;
        setSaving(true);
        const ok = await saveAlert(enable);
        if (!ok) { setSaving(false); return; }
        store.setState('navGuard', null);
        toast(`Alert “${alert.name}” ${isNew ? 'created' : 'saved'}${enable ? ' and enabled' : ''}.`, 'info');
        router.navigate('/alerts');
    }
    function switchToClassic() {
        switchingRef.current = true;
        store.setState('editingAlert', alert);
        store.setState('editingAlertNew', isNew);
        store.setState('navGuard', null);
        router.navigate(`/alerts/${alert.id}/edit${isNew ? '?new=1' : ''}`);
    }
    async function exportAlert() {
        if (isNew) { toast('Save the alert first, then export it', 'warn'); return; }
        try {
            await saveFile(`${alert.name || alert.id}.xml`, 'application/xml', async () => {
                const xml = await api.getXml(`/alerts/${alert.id}`);
                if (!xml || !String(xml).trim()) throw new Error('Alert not found on the server — save it first');
                return xml;
            });
        } catch (e) { toast(`Export failed: ${e.message}`, 'error'); }
    }

    const isLast = step === STEPS.length - 1;
    const stepName = STEPS[step];
    const channels = data.channels.filter((c) => !chFilter.trim() || c.name.toLowerCase().includes(chFilter.trim().toLowerCase()));
    const nErr = step === 0 && nameTouched ? nameError() : null;

    return (
        <div className="view">
            {/* Alert Tasks rail — mirrors the classic alert editor's tasks, plus the
                view switch (like the Dashboard's Card/Table toggle). */}
            <ViewTasks>
                <RailPane title="Alert Tasks" paneKey="tasks:Alert Tasks" group="alertEdit">
                    <div className="taskbar" data-pane-title="Alert Tasks">
                        {getPref('showViewSwitch') !== false && <TaskButton label="Classic editor" icon="edit" onClick={switchToClassic} />}
                        {/* A NEW alert is still being built (create lives in the footer); an
                            EXISTING alert adds Save (when dirty). */}
                        {!isNew && dirtyRef.current && <TaskButton label="Save Alert" icon="save" primary task="doSaveAlerts" onClick={() => finish(false)} />}
                        {!isNew && <TaskButton label="Export Alert" icon="export" task="doExportAlert" onClick={exportAlert} />}
                        <TaskButton label="Back to Alerts" icon="logout" onClick={() => router.navigate('/alerts')} />
                    </div>
                </RailPane>
            </ViewTasks>
            <WizardHeader icon="alerts" title={isNew ? 'New Alert — Wizard' : `${alert.name || 'Alert'} — Wizard`} />
            <WizardStepper steps={STEPS} step={step} maxStep={maxStep} onStep={setStep} />

            <div className="view-body overflow-x-hidden">
                <div className="wiz-pane" key={step}>
                    {/* ---- Basics ---- */}
                    {stepName === 'Basics' && (
                        <div className="panel !mt-0 max-w-[640px]">
                            <div className="panel-body flex flex-col gap-4">
                                <label className="flex flex-col gap-1">
                                    <span className="text-text-dim">Alert name</span>
                                    <input autoFocus type="text" className={`w-full ${nErr ? 'cform-invalid' : ''}`} value={alert.name}
                                        placeholder="My Alert" onChange={(e) => { alert.name = e.target.value; setNameTouched(true); bump(); }} />
                                    {nErr ? <span className="text-err text-[11px]">{nErr}</span> : null}
                                </label>
                                <label className="flex items-center gap-2">
                                    <input type="checkbox" checked={alert.enabled === true} onChange={(e) => { alert.enabled = e.target.checked; bump(); }} />
                                    Enabled
                                </label>
                                <div className="hint">An alert watches for errors on the channels you pick, and notifies via the actions you configure.</div>
                            </div>
                        </div>
                    )}

                    {/* ---- Trigger ---- */}
                    {stepName === 'Trigger' && (
                        <div className="flex flex-col gap-4 max-w-[720px]">
                            <div className="panel !mt-0">
                                <div className="panel-header">Error types</div>
                                <div className="panel-body grid sm:grid-cols-2 gap-x-6 gap-y-2">
                                    {ERROR_EVENT_TYPES.map((t) => (
                                        <label key={t} className="flex items-center gap-2">
                                            <input type="checkbox" checked={errTypes.has(t)} onChange={(e) => setErrType(t, e.target.checked)} />
                                            {eventTypeLabel(t)}
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div className="panel !mt-0">
                                <div className="panel-header">Error message filter</div>
                                <div className="panel-body flex flex-col gap-1">
                                    <textarea className={`w-full ${regexError() ? 'cform-invalid' : ''}`} rows={3} value={trigger.regex || ''}
                                        placeholder="Only trigger when the error matches this regular expression (leave blank to match any error)"
                                        onChange={(e) => { trigger.regex = e.target.value; bump(); }} />
                                    {regexError() ? <span className="text-err text-[11px]">{regexError()}</span> : null}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ---- Channels ---- */}
                    {stepName === 'Channels' && (
                        <div className="panel !mt-0 max-w-[720px]">
                            <div className="panel-header">Channels to watch</div>
                            <div className="panel-body flex flex-col gap-2">
                                {data.channels.length > 6 && <input type="text" placeholder="Filter channels…" value={chFilter} onChange={(e) => setChFilter(e.target.value)} />}
                                <div className="flex flex-col border border-line rounded-md max-h-[320px] overflow-auto divide-y divide-line">
                                    {channels.length === 0 && <div className="p-2 text-text-faint text-[12px]">No channels.</div>}
                                    {channels.map((c) => (
                                        <label key={c.id} className="flex items-center gap-2 px-2.5 py-2 hover:bg-bg1 cursor-pointer" title={c.name}>
                                            <input type="checkbox" checked={enabledChannels.has(c.id)} onChange={(e) => setChannel(c.id, e.target.checked)} />
                                            <span className="truncate">{c.name}</span>
                                        </label>
                                    ))}
                                </div>
                                <div className="grid sm:grid-cols-2 gap-2 pt-1">
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={ac.newChannelSource === true} onChange={(e) => { ac.newChannelSource = e.target.checked; bump(); }} />Apply to sources of new channels</label>
                                    <label className="flex items-center gap-2"><input type="checkbox" checked={ac.newChannelDestination === true} onChange={(e) => { ac.newChannelDestination = e.target.checked; bump(); }} />Apply to destinations of new channels</label>
                                </div>
                                <div className="hint">Pick which channels this alert watches. Per-connector granularity is available in the classic editor.</div>
                            </div>
                        </div>
                    )}

                    {/* ---- Actions ---- */}
                    {stepName === 'Actions' && (
                        <div className="flex flex-col gap-4 max-w-[820px]">
                            <div className="panel !mt-0">
                                <div className="panel-header">Notifications</div>
                                <div className="panel-body flex flex-col gap-2">
                                    {actionList().length === 0 && <div className="hint">No actions yet — add one to send a notification when the alert fires.</div>}
                                    {actionList().length > 0 && (
                                        <div className="flex items-center gap-2 px-0.5 text-[11px] uppercase tracking-wide text-text-faint">
                                            <span className="w-[160px] flex-none">Protocol</span><span className="flex-1">Recipient</span><span className="w-[30px] flex-none" />
                                        </div>
                                    )}
                                    {actionList().map((a, i) => {
                                        const opts = data.recipients[a.protocol];
                                        return (
                                            <div key={i} className="flex items-center gap-2">
                                                <select className="w-[160px] flex-none" value={a.protocol} onChange={(e) => patchAction(i, { protocol: e.target.value, recipient: '' })}>
                                                    {data.protocols.map((p) => <option key={p} value={p}>{p}</option>)}
                                                </select>
                                                {Array.isArray(opts) ? (
                                                    <select className="flex-1 min-w-0" value={a.recipient || ''} onChange={(e) => patchAction(i, { recipient: e.target.value })}>
                                                        <option value="">Select…</option>
                                                        {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                    </select>
                                                ) : (
                                                    <input type="text" className="flex-1 min-w-0" placeholder="Recipient (e.g. name@example.com)" value={a.recipient || ''} onChange={(e) => patchAction(i, { recipient: e.target.value })} />
                                                )}
                                                <button type="button" className="btn btn-sm btn-danger w-[30px] flex-none justify-center" onClick={() => removeAction(i)}><Icon name="trash" size={13} /></button>
                                            </div>
                                        );
                                    })}
                                    <div><button type="button" className="btn btn-sm" onClick={addAction}><Icon name="plus" size={13} />Add action</button></div>
                                </div>
                            </div>

                            <div className="flex flex-col lg:flex-row gap-4">
                                <div className="panel !mt-0 flex-1 min-w-0">
                                    <div className="panel-header">Message</div>
                                    <div className="panel-body flex flex-col gap-3">
                                        <label className="flex flex-col gap-1">
                                            <span className="text-text-dim text-[12px]">Subject</span>
                                            <input type="text" className="w-full" value={grp.subject || ''} onFocus={() => { focusedRef.current = 'subject'; }} onChange={(e) => { grp.subject = e.target.value; bump(); }} />
                                        </label>
                                        <label className="flex flex-col gap-1">
                                            <span className="text-text-dim text-[12px]">Template</span>
                                            <textarea className="w-full" rows={8} value={grp.template || ''} onFocus={() => { focusedRef.current = 'template'; }} onChange={(e) => { grp.template = e.target.value; bump(); }} />
                                        </label>
                                    </div>
                                </div>
                                <div className="panel !mt-0 w-full lg:w-[240px] flex-none">
                                    <div className="panel-header">Variables</div>
                                    <div className="panel-body flex flex-col gap-2">
                                        <div className="border border-line rounded overflow-auto max-h-[360px] min-h-[120px]">
                                            {ALERT_VARIABLES.map((v) => (
                                                <div key={v} role="button" draggable
                                                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', `\${${v}}`); e.dataTransfer.effectAllowed = 'copy'; }}
                                                    onClick={() => insertVar(v)}
                                                    className="step-item cursor-grab" title={`Click or drag to insert \${${v}}`}>
                                                    <div className="flex-1 min-w-0"><div className="truncate">{v}</div></div>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="hint">Click to insert into the focused field, or drag onto the subject/template.</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ---- Review ---- */}
                    {stepName === 'Review' && (
                        <div className="panel !mt-0 max-w-[820px]">
                            {warnings().length > 0 && (
                                <div className="panel-body pb-0">
                                    {warnings().map((w, i) => (
                                        <div key={i} className="flex items-center gap-2 text-[12px] text-amber"><Icon name="warning" size={13} />{w}</div>
                                    ))}
                                </div>
                            )}
                            <div className="panel-body">
                                {[
                                    ['Name', alert.name || <span className="text-err">(required)</span>],
                                    ['Enabled', alert.enabled ? 'Yes' : 'No'],
                                    ['Error types', errTypes.size ? [...errTypes].map(eventTypeLabel).join(', ') : 'None'],
                                    ['Error filter', trigger.regex ? trigger.regex : '(any error)'],
                                    ['Channels', enabledNames.length ? enabledNames.join(', ') : (ac.newChannelSource || ac.newChannelDestination ? 'New channels only' : 'None')],
                                    ['Actions', actionList().length ? actionList().map((a) => `${a.protocol} → ${recipientLabel(a.protocol, a.recipient) || '(none)'}`).join(', ') : 'None'],
                                    ['Subject', grp.subject ? grp.subject : '(none)'],
                                    ['Template', grp.template ? <pre className="whitespace-pre-wrap font-mono text-[12px] max-h-[160px] overflow-auto m-0">{grp.template}</pre> : '(none)']
                                ].map(([label, value]) => (
                                    <div key={label} className="flex gap-4 py-2 border-b border-line">
                                        <div className="w-[160px] flex-none text-text-dim">{label}</div>
                                        <div className="flex-1 min-w-0">{value}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-line">
                <button className="btn" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>Back</button>
                <div className="ml-auto flex items-center gap-2">
                    {!isLast ? (
                        <button className="btn btn-primary" disabled={stepName === 'Basics' && !!nameError()} onClick={tryNext}>Next</button>
                    ) : isNew ? (
                        <>
                            <button className="btn" disabled={saving || !!nameError()} onClick={() => finish(false)}><Icon name="save" size={14} />{saving ? 'Creating…' : 'Create Alert'}</button>
                            <button className="btn btn-primary" disabled={saving || !!nameError()} onClick={() => finish(true)}><Icon name="check" size={14} />Create &amp; Enable</button>
                        </>
                    ) : dirtyRef.current ? (
                        <button className="btn btn-primary" disabled={saving || !!nameError()} onClick={() => finish(false)}><Icon name="save" size={14} />{saving ? 'Saving…' : 'Save Alert'}</button>
                    ) : (
                        <button className="btn" onClick={() => router.navigate('/alerts')}><Icon name="x" size={14} />Exit</button>
                    )}
                </div>
            </div>
        </div>
    );
}

export function register(platform) {
    platform.registerView('/alerts/new/guided', reactView(AlertWizardView), { title: 'New Alert — Wizard' });
    platform.registerView('/alerts/:alertId/guided', reactView(AlertWizardView), { title: 'Alert — Wizard' });
}

export { AlertWizardView };

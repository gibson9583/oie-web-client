/*
 * Shared scaffolding for the guided builders (channel wizard, alert wizard).
 * These are the entity-agnostic, mechanically-duplicated parts — the model
 * loader, the step state, the leave/prompt-to-save guard, and the chevron
 * stepper + header markup. Each wizard still owns its own steps, model shape,
 * validation, save/deploy logic, footer, and task rail.
 */

import { useEffect, useRef, useState } from 'react';
import { toast, modal, h } from '@oie/web-ui';
import * as store from '../../core/store.js';
import * as router from '../../core/router.js';
import { Icon } from '../bridges.jsx';

/*
 * Loader: resolve the model to edit. The route decides new-vs-existing —
 * `.../new/guided` creates via makeNew(); `.../:id/guided` edits an existing one,
 * taken from the store handoff (unsaved edits carried from the classic editor) or
 * fetched on a deep-link. Returns { model, isNew, ready }; render a spinner until
 * ready, then mount the inner wizard keyed on model.id.
 *
 *   routeId   - the route param value ('new' | an id | undefined)
 *   storeKey  - store key holding the handed-over model (e.g. 'editingChannel')
 *   isValid   - (stored) => bool: is the stored object a usable model of this type
 *   makeNew   - () => model: build a blank model for the new-channel/alert case
 *   fetch     - (id) => Promise<model>: load an existing model from the engine
 *   normalize - (model) => model: optional in-place fix-ups before use
 *   backPath  - where to navigate if the fetch fails
 */
export function useWizardModel({ routeId, storeKey, isValid, makeNew, fetch, normalize, backPath }) {
    const wantExisting = !!routeId && routeId !== 'new';
    const isNew = !wantExisting;
    const norm = normalize || ((x) => x);
    const ref = useRef(null);
    if (!ref.current) {
        const stored = store.getState(storeKey);
        if (stored && (!isValid || isValid(stored)) && (!wantExisting || String(stored.id) === String(routeId))) {
            ref.current = norm(stored);
        } else if (isNew) {
            ref.current = norm(makeNew());
        }
    }
    const [ready, setReady] = useState(!!ref.current);
    useEffect(() => {
        if (ref.current) return undefined;
        let alive = true;
        fetch(routeId).then((loaded) => {
            if (!alive) return;
            ref.current = norm(loaded);
            store.setState(storeKey, ref.current);
            setReady(true);
        }).catch((e) => {
            if (alive) { toast(e && e.message ? e.message : 'Could not load.', 'error'); router.navigate(backPath); }
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return { model: ref.current, isNew, ready };
}

/*
 * Step state. New models reveal steps as you advance (maxStep grows); existing
 * models start with every step visited so you can jump to any of them.
 */
export function useWizardSteps(isNew, count) {
    const [step, setStep] = useState(0);
    const [maxStep, setMaxStep] = useState(isNew ? 0 : count - 1);
    const goStep = (i) => { setStep(i); setMaxStep((m) => Math.max(m, i)); };
    return { step, setStep, maxStep, setMaxStep, goStep };
}

function confirmLeave(entityLabel, isNew, canSave) {
    return new Promise((resolve) => {
        // Users whose role can't save must not be offered a Save the server
        // would reject — OK-only notice instead (channel editor parity).
        if (canSave === false) {
            modal({
                title: `Unsaved ${entityLabel}`,
                body: h('div', `You don't have permission to save this ${entityLabel}. Your changes will be discarded.`),
                buttons: [{ label: 'OK', primary: true, onClick: () => resolve('discard') }],
                onClose: () => resolve('cancel')
            });
            return;
        }
        modal({
            title: `Unsaved ${entityLabel}`,
            body: h('div', isNew
                ? `This ${entityLabel} hasn’t been created yet. Save it before leaving?`
                : 'You have unsaved changes. Save before leaving?'),
            buttons: [
                { label: 'Discard', danger: true, onClick: () => resolve('discard') },
                { label: 'Cancel', onClick: () => resolve('cancel') },
                { label: 'Save', primary: true, onClick: () => resolve('save') }
            ],
            onClose: () => resolve('cancel')
        });
    });
}

/*
 * Keep the working model in the store (so the embedded editors and a classic-editor
 * switch see it), and install the prompt-to-save nav guard — the same guard the
 * classic editors use. A view switch sets switchingRef so the guard/cleanup leaves
 * the model in the store on the way out.
 *
 *   save    - () => Promise<bool>: the wizard's save (no deploy); called on "Save".
 *   canSave - optional () => bool (RBAC check); false swaps the Save prompt for
 *             an OK-only "no permission" notice.
 */
export function useLeaveGuard({ model, isNew, storeKey, storeNewKey, dirtyKey, entityLabel, dirtyRef, savedRef, switchingRef, save, canSave }) {
    const cleanupStore = () => {
        if (store.getState(storeKey) === model) {
            store.setState(storeKey, null);
            store.setState(storeNewKey, false);
            if (dirtyKey) store.setState(dirtyKey, false);
        }
    };
    // Point the store at this model for the wizard's lifetime; drop it on a real exit.
    useEffect(() => {
        store.setState(storeKey, model);
        store.setState(storeNewKey, isNew);
        return () => {
            // switchingRef is read at unmount on purpose — it's set just before a
            // classic-editor switch so we leave the model in the store then.
            // eslint-disable-next-line react-hooks/exhaustive-deps
            if (!switchingRef.current && store.getState(storeKey) === model) {
                cleanupStore();
                store.setState('navGuard', null);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // Prompt on leaving with unsaved work.
    useEffect(() => {
        const guard = async () => {
            if (savedRef.current) return;               // already created/updated → allow
            if (!(isNew || dirtyRef.current)) return;   // nothing unsaved → allow
            const choice = await confirmLeave(entityLabel, isNew, canSave ? canSave() : true);
            if (choice === 'cancel') return false;      // stay
            if (choice === 'save') { const ok = await save(); if (!ok) return false; }
            store.setState('navGuard', null);
            cleanupStore();
        };
        store.setState('navGuard', guard);
        return () => { if (store.getState('navGuard') === guard) store.setState('navGuard', null); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}

/* Chevron stepper — any visited step is clickable. */
export function WizardStepper({ steps, step, maxStep, onStep }) {
    return (
        <div className="wiz-steps px-4 py-3 border-b border-line select-none overflow-x-auto">
            {steps.map((label, i) => {
                const active = i === step;
                const visited = i <= maxStep;
                const done = visited && !active;
                return (
                    <div key={label} role="button" aria-current={active ? 'step' : undefined}
                        className={`wiz-step ${done ? 'done' : ''} ${active ? 'active' : ''} ${visited ? 'clickable' : ''}`}
                        onClick={() => visited && onStep(i)}>
                        {done ? <Icon name="check" size={13} /> : null}
                        <span>{label}</span>
                    </div>
                );
            })}
        </div>
    );
}

/* View header: entity icon + title (e.g. "New Channel — Wizard"). */
export function WizardHeader({ icon, title }) {
    return (
        <div className="view-header flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 border-b border-line">
            <Icon name={icon} size={18} />
            <div className="font-semibold truncate">{title}</div>
        </div>
    );
}

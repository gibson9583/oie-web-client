/*
 * The "selected for compare" chip — a floating marker, bottom-right of the
 * message browser, for as long as an anchor exists.
 *
 * It shows the REFERENCE ONLY (Msg 41207 · Source · Raw). Never content: the
 * chip is visible across the whole view, including over other people's
 * shoulders, and the anchor is a coordinate rather than a payload precisely so
 * that showing it costs nothing. Its ✕ is the user-facing reset to IDLE.
 */

import { useEffect, useState } from 'react';
import { toast } from '@oie/web-ui';
import { on } from '../core/store.js';
import { getAnchor, clearCompare, describeRef } from '../core/compare.js';
import { Icon } from './bridges.jsx';

export function CompareChip() {
    const [anchor, setAnchor] = useState(() => getAnchor());
    // Non-React code resets the selection too (the api layer's session handling),
    // so the chip follows the store's event rather than a prop.
    useEffect(() => on('compare:changed', () => setAnchor(getAnchor())), []);

    if (!anchor) return null;
    return (
        <div className="compare-chip" role="status" aria-live="polite">
            <Icon name="compare" size={15} />
            <div className="compare-chip-body">
                <div className="compare-chip-title">Selected for compare</div>
                <div className="compare-chip-ref mono">{describeRef(anchor)}</div>
                <div className="compare-chip-hint">reference only, no content stored</div>
            </div>
            <button type="button" className="icon-btn" title="Clear compare selection"
                aria-label="Clear compare selection"
                onClick={() => { clearCompare(); toast('Compare selection cleared'); }}>
                <Icon name="x" size={13} />
            </button>
        </div>
    );
}

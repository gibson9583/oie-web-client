/*
 * Radix Tabs over panels that are still built with h().
 *
 * The app's own <Tabs> (react/ui.jsx) keeps every panel mounted, because the
 * editors inside them must not lose their state on a switch. The DOM tabs() this
 * replaces did the opposite — it rebuilt the active panel from its render()
 * every time — and the one dialog still using it (Channel Dependencies) relies
 * on that: each panel reads a mutable working model when it is drawn.
 *
 * So this component keeps tabs()' semantics exactly (render on activation, drop
 * on leave) and takes only the strip from Radix: roles, roving focus, arrow keys
 * and Home/End, none of which the hand-written strip will now drift from.
 */

import { useEffect, useRef, useState } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

/** Runs `render()` on mount and hosts whatever DOM node it returns. */
function DomPanel({ render }) {
    const ref = useRef(null);
    useEffect(() => {
        const host = ref.current;
        if (!host) return undefined;
        const node = render();
        if (node instanceof Node) host.appendChild(node);
        return () => host.replaceChildren();
    }, [render]);
    // `contents` so this wrapper is invisible to layout — the panels are flex
    // children of .tab-body and size themselves against it.
    return <div ref={ref} className="contents" />;
}

export function DomTabs({ defs, label = 'Tabs', bodyStyle }) {
    const [active, setActive] = useState(0);
    return (
        <TabsPrimitive.Root value={String(active)} onValueChange={(v) => setActive(Number(v))}
            style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <TabsPrimitive.List className="tabs" aria-label={label}>
                {defs.map((def, i) => (
                    <TabsPrimitive.Trigger key={i} value={String(i)}
                        className={'tab' + (i === active ? ' active' : '')}>
                        {def.label}
                    </TabsPrimitive.Trigger>
                ))}
            </TabsPrimitive.List>
            <div className="tab-body" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, ...bodyStyle }}>
                {defs.map((def, i) => (
                    <TabsPrimitive.Content key={i} value={String(i)}
                        style={{ flex: 1, minHeight: 0, flexDirection: 'column' }}>
                        <DomPanel render={def.render} />
                    </TabsPrimitive.Content>
                ))}
            </div>
        </TabsPrimitive.Root>
    );
}

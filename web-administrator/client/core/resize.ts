/*
 * Global drag-resize wiring. Any element with class .split-handle becomes a
 * live splitter:
 *
 *   - orientation: data-orient="v" (row divider, resizes height) or "h"
 *     (column divider, resizes width). Defaults to the parent's
 *     .split.vertical class, else horizontal.
 *   - target: data-resize="prev" (default) resizes the previous sibling,
 *     data-resize="next" resizes the next sibling.
 *
 * Views and plugins get resizable sections for free by inserting a handle
 * between two siblings in a flex container.
 */

let installed = false;

export function initSplitters(): void {
    if (installed) return;
    installed = true;

    document.addEventListener('mousedown', (e) => {
        const handle = (e.target as Element).closest('.split-handle') as HTMLElement | null;
        if (!handle) return;

        const vertical = handle.dataset.orient
            ? handle.dataset.orient === 'v'
            : !!handle.parentElement?.classList.contains('vertical');
        const next = handle.dataset.resize === 'next';
        const target = (next ? handle.nextElementSibling : handle.previousElementSibling) as HTMLElement | null;
        if (!target) return;

        e.preventDefault();
        const startPos = vertical ? e.clientY : e.clientX;
        const startSize = vertical ? target.getBoundingClientRect().height : target.getBoundingClientRect().width;

        // Fix the target's size explicitly so flex siblings absorb the change.
        target.style.flex = 'none';
        document.body.style.cursor = vertical ? 'row-resize' : 'col-resize';
        document.body.style.userSelect = 'none';
        handle.classList.add('dragging');

        function onMove(ev: MouseEvent): void {
            const delta = (vertical ? ev.clientY : ev.clientX) - startPos;
            // Dragging toward a "next" target shrinks it; toward "prev" grows it.
            const size = Math.max(48, startSize + (next ? -delta : delta));
            target!.style[vertical ? 'height' : 'width'] = size + 'px';
            if (vertical) target!.style.maxHeight = 'none';
            else target!.style.maxWidth = 'none';
        }

        function onUp(): void {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            handle!.classList.remove('dragging');
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

import type { Locator } from '@playwright/test';
import { expect } from './base.js';

/** Read the displayed editor model, including text beyond Monaco's viewport. */
export async function expectInspectorCode(container: Locator, values: string[]) {
    const editors = container.locator('.ci-code-editor');
    await expect(editors).toHaveCount(values.length);
    for (let i = 0; i < values.length; i++) {
        const editor = editors.nth(i);
        await editor.scrollIntoViewIfNeeded();
        await expect.poll(() => editor.evaluate(el => {
            const monaco = (window as any).monaco;
            const instance = monaco?.editor.getEditors().find((ed: any) => el.contains(ed.getDomNode()));
            const value = instance ? instance.getValue() : el.querySelector<HTMLTextAreaElement>('textarea.ce-area')?.value;
            return value?.replace(/\r\n|\r/g, '\n');
        })).toBe(values[i].replace(/\r\n|\r/g, '\n'));
    }
}

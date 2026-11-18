import type { Page } from '@playwright/test';
import { test, expect } from './base.js';
import { mockEngine } from './mock.js';
import { makeChannel } from './connector-fixtures.js';

const STEP = 'com.mirth.connect.plugins.javascriptstep.JavaScriptStep';
const ITERATOR = 'com.mirth.connect.model.IteratorStep';
type Element = { type: string; name: string; [field: string]: any };

function wire(elements: Element[]) {
    const result: Record<string, any[]> = {};
    elements.forEach(({ type, ...element }, sequenceNumber) => {
        (result[type] ||= []).push({ '@version': '4.6.0', enabled: true, ...element, sequenceNumber });
    });
    return elements.length ? result : '';
}

function step(name: string): Element {
    return { type: STEP, name, script: `trace.add('${name}');` };
}

function iterator(name: string, indexVariable: string, elements: Element[]): Element {
    return { type: ITERATOR, name, properties: {
        '@version': '4.6.0', target: "msg['OBX']", indexVariable,
        prefixSubstitutions: { string: "msg['OBX']" }, children: wire(elements)
    } };
}

function ordered(elements: Record<string, any>) {
    const position = (element: any) => Number(String(element.sequenceNumber).split('-').at(-1));
    return Object.values(elements).flatMap(value => Array.isArray(value) ? value : [value])
        .sort((left, right) => position(left) - position(right));
}

const row = (page: Page, name: string) => page.locator('table.dt tbody tr[data-path]')
    .filter({ has: page.locator(`input.grid-name[value="${name}"]`) });

for (const kind of ['transformer', 'filter', 'response']) {
    test(`Swing sibling order survives adding a ${kind} element and reopening the channel`, async ({ page }) => {
        const filter = kind === 'filter';
        const noun = filter ? 'Rule' : 'Step';
        const scriptType = filter ? 'com.mirth.connect.plugins.javascriptrule.JavaScriptRule' : STEP;
        const mixedType = filter ? 'com.mirth.connect.plugins.rulebuilder.RuleBuilderRule' : 'com.mirth.connect.plugins.messagebuilder.MessageBuilderStep';
        const loopType = filter ? 'com.mirth.connect.model.IteratorRule' : ITERATOR;
        const base = { '@version': '4.6.0', enabled: true };
        const scripts = [
            { ...base, sequenceNumber: '0-0', name: 'Before', ...(filter
                ? { script: 'return true;', operator: 'NONE' } : { script: "tmp.value = 'before';" }) },
            { ...base, sequenceNumber: '0-2', name: 'After', ...(filter
                ? { script: 'return false;', operator: 'AND' } : { script: 'observed.push(tmp.value);' }) }
        ];
        const mixed = filter ? { field: 'input', condition: 'EQUALS', values: { string: "'yes'" }, operator: 'OR' }
            : { messageSegment: 'tmp.value', mapping: "'written'", replacements: '', defaultValue: '' };
        const loop = { ...base, name: 'Rows', sequenceNumber: 0, properties: {
            target: 'rows', indexVariable: 'i', prefixSubstitutions: '', children: {
                [scriptType]: scripts, [mixedType]: { ...base, name: 'Middle', sequenceNumber: '0-1', ...mixed }
            }
        } };
        let channel = makeChannel('swing-order-' + kind);
        const target = () => kind === 'response' ? channel.destinationConnectors.connector[0].responseTransformer : channel.sourceConnector[kind];
        target().elements = { [loopType]: loop };
        let saves = 0;
        await mockEngine(page, {
            [`GET /channels/${channel.id}`]: () => ({ channel }),
            [`PUT /channels/${channel.id}`]: (req: any) => { channel = req.postDataJSON().channel; saves++; return true; }
        });
        await page.goto(`/channels/${channel.id}/${kind}/${kind === 'response' ? 1 : 0}`);
        await expect(row(page, 'Middle').locator('td.num')).toHaveText('0-1');
        await row(page, 'Before').locator('td.num').click();
        await page.getByRole('button', { name: 'Add New ' + noun, exact: true }).click();
        const type = page.locator('tr.selected td:last-child select');
        await expect(type).toHaveValue(filter ? mixedType : 'com.mirth.connect.plugins.mapper.MapperStep');
        await type.selectOption(scriptType);
        await expect(page.locator('tr.selected td.num')).toHaveText('0-3');
        await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
        await expect.poll(() => saves).toBe(1);
        const children = target().elements[loopType][0].properties.children;
        expect(children[scriptType].map((el: any) => el.sequenceNumber)).toEqual(['0-0', '0-2', '0-3']);
        expect(children[mixedType][0].sequenceNumber).toBe('0-1');
        if (filter) expect(children[mixedType][0].operator).toBe('OR');
        await page.reload();
        await expect(row(page, 'Middle').locator('td.num')).toHaveText('0-1');
        await expect(row(page, 'After').locator('td.num')).toHaveText('0-2');
    });
}

for (const nested of [false, true]) {
    test(`detaching a step appends after following siblings in the ${nested ? 'outer Iterator' : 'root'} list`, async ({ page }, info) => {
        const detached = step('Detached');
        const parent = iterator('Inner', nested ? 'j' : 'i', [detached]);
        const siblings = [parent, step('First following'), step('Second following')];
        const elements = nested ? [iterator('Outer', 'i', siblings), step('Root following')] : siblings;
        let channel = makeChannel(`detach-order-${nested ? 'nested' : 'root'}`);
        channel.sourceConnector.transformer.elements = wire(elements);
        const writes: any[] = [];
        await mockEngine(page, {
            [`GET /channels/${channel.id}`]: () => ({ channel }),
            [`PUT /channels/${channel.id}`]: (request: any) => { channel = request.postDataJSON().channel; writes.push(channel); return true; }
        });
        await page.goto(`/channels/${channel.id}/transformer/0`);
        await row(page, 'Detached').locator('td.num').click();
        await page.getByRole('button', { name: 'Remove From Iterator', exact: true }).click();
        const visibleOrder = await page.locator('table.dt tbody input.grid-name').evaluateAll(inputs =>
            inputs.map(input => (input as HTMLInputElement).value));
        expect(visibleOrder).toEqual(nested
            ? ['Outer', 'Inner', 'First following', 'Second following', 'Detached', 'Root following']
            : ['Inner', 'First following', 'Second following', 'Detached']);
        await expect(row(page, 'Detached')).toHaveClass(/selected/);
        await page.getByRole('button', { name: 'Save Channel', exact: true }).click();
        await expect.poll(() => writes.length).toBe(1);
        const saved = writes[0].sourceConnector.transformer.elements;
        const enclosing = nested ? ordered(saved)[0].properties.children : saved;
        expect(ordered(enclosing).map((element: any) => element.name))
            .toEqual(['Inner', 'First following', 'Second following', 'Detached']);
        expect(ordered(enclosing)[0].properties.children).toBe('');
        expect(ordered(enclosing).at(-1).script).toBe(detached.script);
        await info.attach('saved-detachment-order', { body: JSON.stringify(saved, null, 2), contentType: 'application/json' });
        // Reload exercises the serialized sequence numbers as well as the live
        // array, whose order determines the engine's generated script order.
        await page.reload();
        await expect.poll(async () => page.locator('table.dt tbody input.grid-name').evaluateAll(inputs =>
            inputs.map(input => (input as HTMLInputElement).value))).toEqual(visibleOrder);
    });
}

/*
 * Type regression guard for @oie/web-ui.
 */
import { h, DataTable, modal, buildForm, CHARSETS, field, textInput } from '@oie/web-ui';
import type { Column } from '@oie/web-ui';

function goodUsage() {
    // h() overloads: string child AND attrs+children both work.
    const a: HTMLElement = h('div', 'plain text child');
    const b: HTMLElement = h('div.cls', { class: 'x', onClick: () => {} }, h('span', 'nested'));

    const cols: Column<{ name: string }>[] = [{ key: 'name', label: 'Name', render: (r) => r.name }];
    const table = new DataTable(cols, { selectable: 'single', emptyText: 'none' });
    table.setRows([{ name: 'a' }]);
    const sel: { name: string }[] = table.selectedRows();

    const m = modal({ title: 'Hi', body: field('Name', textInput('')), buttons: [{ label: 'OK', onClick: () => true }] });
    m.close();

    buildForm(h('div'), {}, [{ key: 'x', label: 'X', type: 'select', options: CHARSETS }], () => {});

    return [a, b, sel];
}

function badUsage() {
    const cols: Column[] = [{ key: 'k', label: 'K' }];
    // @ts-expect-error selectable only accepts 'single' | 'multi' | false
    new DataTable(cols, { selectable: 'yes' });
    // @ts-expect-error modal requires a title
    modal({ body: h('div') });
}

void goodUsage;
void badUsage;

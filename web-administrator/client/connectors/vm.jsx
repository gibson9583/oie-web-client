/*
 * Channel Reader (VmReceiverProperties) / Channel Writer (VmDispatcherProperties).
 *
 * React port: the def.render(host, ctx) panels become def.component(ctx) => JSX.
 * Field schemas + defaults are reused VERBATIM; only the rendering layer is JSX.
 * The Channel Id dropdown keeps its original imperative <select> (populated
 * asynchronously from channels.idsAndNames) as a `custom` field — the same DOM
 * node the panel always built, mounted into the React form.
 */

import { React } from './react-platform.js';
import { h, clear, select, textInput, icon } from '@oie/web-ui';
import { ConnectorForm, mapEntries, defaultSourceProperties, defaultDestinationProperties } from './react-forms.js';

/* XStream List<String>: { '@class': 'java.util.ArrayList', string: [...] } */
function asArray(value) {
    if (value === null || value === undefined || value === '') return [];
    return Array.isArray(value) ? value : [value];
}
function stringList(list) {
    if (!list || typeof list !== 'object') return [];
    return asArray(list.string).map((v) => String(v ?? ''));
}
function writeStringList(list, values) {
    const target = list && typeof list === 'object' ? list : {};
    if (!target['@class']) target['@class'] = 'java.util.ArrayList';
    if (values.length) target.string = values;
    else delete target.string;
    return target;
}

const channelReader = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.vm.VmReceiverProperties',
            '@version': version,
            pluginProperties: null,
            sourceConnectorProperties: defaultSourceProperties(version)
        };
    },
    component() {
        return (
            <div className="cform-section">
                <div className="cform-section-title">Channel Reader Settings</div>
                <div className="hint" style={{ padding: '2px 0' }}>
                    Channel Reader listens for messages routed from other channels on this server. It has no connector-specific settings.
                </div>
            </div>
        );
    }
};

/* Channel id→name map is fetched once and cached for the editor's lifetime so a
   form repaint (after picking a channel) reuses it instead of re-fetching. */
let channelNamesPromise = null;
function loadChannelNames(platform) {
    if (!channelNamesPromise) channelNamesPromise = platform.api.channels.idsAndNames();
    return channelNamesPromise;
}

/* Synthetic combo labels Swing surfaces when the text field holds a value that
   isn't a known channel id. They only ever appear in the dropdown (never written
   to channelId) — they exist solely to describe the free-text field's state. */
const NONE_LABEL = '<None>';
const MAP_VARIABLE_LABEL = '<Map Variable>';
const NOT_FOUND_LABEL = '<Channel Not Found>';

/* Channel Id dual control, mirroring ChannelWriter's editable channelIdField
   (the source of truth) paired with the channelNames combo (a convenience
   picker). Both are rendered side-by-side and kept in two-way sync:
     - The free-text field is bound to properties.channelId so a user can type a
       RAW channel id or a Velocity map variable like ${channelId}. Swing stores
       'none' when the field is blank, so a blank field clears channelId to 'none'.
     - The combo is keyed by channel NAME and resolves to an id; '<None>' clears
       the field. Selecting an entry writes its id into the field (updateField in
       reverse). The combo also shows synthetic labels (<None> / <Map Variable> /
       <Channel Not Found>) describing whatever the field currently holds.
   Combo option order matches Swing: '<None>' first, then channels sorted
   alpha-numerically by NAME (Collections.sort on channelNameArray). */
function channelControlNode(properties, platform, onChange) {
    const wrap = h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } });
    // channelList: name -> id, used to resolve the combo selection and reverse-sync.
    let channelList = [];

    const field = textInput(properties.channelId === 'none' ? '' : (properties.channelId ?? ''), {
        placeholder: '<None>', title: "The destination channel's unique global id.",
        style: { width: '250px' }
    });
    const combo = select([{ value: NONE_LABEL, label: NONE_LABEL }], NONE_LABEL, {
        title: 'Select the channel to which messages accepted by this destination\'s filter should be written, or none to not write the message at all.',
        style: { width: '250px' }
    });

    // Reverse-sync the combo selection to whatever the field text holds, matching
    // ChannelWriter.updateField(): blank -> <None>, a known channel name (we store
    // id->name, so look up the name) -> that name, contains '$' -> <Map Variable>,
    // else -> <Channel Not Found>.
    function syncCombo() {
        const text = String(field.value ?? '');
        let selection;
        if (text.trim() === '') {
            selection = NONE_LABEL;
        } else {
            const match = channelList.find(([, id]) => id === text);
            if (match) selection = match[0];
            else if (text.includes('$')) selection = MAP_VARIABLE_LABEL;
            else selection = NOT_FOUND_LABEL;
        }
        combo.value = selection;
    }

    // The field is the source of truth: Swing stores 'none' for a blank field.
    field.addEventListener('input', () => {
        const text = field.value;
        properties.channelId = text.trim() === '' ? 'none' : text;
        syncCombo();
        onChange();
    });

    // Combo fills the field (channelNamesActionPerformed): '<None>' clears it; a
    // channel name resolves to its id. Synthetic labels are non-selectable no-ops.
    combo.addEventListener('change', () => {
        const name = combo.value;
        let id = null;
        if (name === NONE_LABEL) id = '';
        else {
            const match = channelList.find(([n]) => n === name);
            if (match) id = match[1];
        }
        if (id !== null) {
            field.value = id;
            properties.channelId = id.trim() === '' ? 'none' : id;
            onChange();
        }
        syncCombo();
    });

    wrap.appendChild(field);
    wrap.appendChild(combo);

    loadChannelNames(platform).then((map) => {
        // mapEntries yields [channelId, channelName]; build the name->id list and
        // sort by NAME (alpha-numeric) to match Collections.sort(channelNameArray).
        channelList = mapEntries(map)
            .map(([id, name]) => [name, id])
            .sort((a, b) => a[0].localeCompare(b[0]));
        clear(combo);
        // '<None>' first, then sorted channel names, plus the synthetic labels so
        // the combo can describe a raw id / map variable the field may hold.
        combo.appendChild(h('option', { value: NONE_LABEL }, NONE_LABEL));
        for (const [name] of channelList) combo.appendChild(h('option', { value: name }, name));
        for (const label of [MAP_VARIABLE_LABEL, NOT_FOUND_LABEL]) {
            combo.appendChild(h('option', { value: label }, label));
        }
        syncCombo();
    }).catch(() => { /* keep the static <None> option */ });

    return wrap;
}

/* Single-column "Map Variable" List<String> table (mapVariables), mirroring
   ChannelWriter.mapVariablesTable. The keys are injected into the source map of
   the destination channel's message; per the Swing tooltip, only the bare key is
   entered (no "${}" syntax). Each row carries its own inline Delete next to the
   variable; a New button below appends a row. */
function mapVariablesTable(properties, onChange) {
    const wrap = h('div');
    const rows = stringList(properties.mapVariables);
    const commit = () => {
        properties.mapVariables = writeStringList(properties.mapVariables, rows.filter((v) => v !== ''));
        onChange();
    };
    function uniqueName() {
        for (let i = 1; i <= rows.length + 1; i++) {
            const name = 'Variable ' + i;
            if (!rows.some((v) => v.toLowerCase() === name.toLowerCase())) return name;
        }
        return 'Variable ' + (rows.length + 1);
    }
    function paint() {
        clear(wrap);
        const table = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
        table.appendChild(h('div', { className: 'cform-label', style: { fontWeight: '600', fontSize: '12px' } }, 'Map Variable'));
        rows.forEach((value, i) => {
            const input = textInput(value, {
                placeholder: 'Map Variable', style: { flex: '1' },
                onInput: (e) => { rows[i] = e.target.value; commit(); }
            });
            const delBtn = h('button.icon-btn', {
                type: 'button', title: 'Delete',
                onClick: () => { rows.splice(i, 1); commit(); paint(); }
            }, icon('x'));
            table.appendChild(h('div', { style: { display: 'flex', gap: '6px', marginBottom: '4px', alignItems: 'center' } }, input, delBtn));
        });
        const newBtn = h('button.btn', {
            type: 'button',
            onClick: () => { rows.push(uniqueName()); commit(); paint(); }
        }, 'New');
        wrap.appendChild(table);
        wrap.appendChild(h('div', { style: { marginTop: '6px' } }, newBtn));
    }
    paint();
    return wrap;
}

const channelWriter = {
    defaults(version) {
        return {
            '@class': 'com.mirth.connect.connectors.vm.VmDispatcherProperties',
            '@version': version,
            pluginProperties: null,
            destinationConnectorProperties: defaultDestinationProperties(version),
            channelId: 'none',
            channelTemplate: '${message.encodedData}',
            mapVariables: { '@class': 'java.util.ArrayList' }
        };
    },
    component({ properties, platform, onChange }) {
        return (
            <ConnectorForm properties={properties} onChange={onChange} fields={[
                { section: 'Channel Writer Settings' },
                {
                    type: 'custom', label: 'Channel Id', span: true,
                    tooltip: "The destination channel's unique global id. Type a raw channel id or a ${mapVariable}, or pick a channel from the dropdown to fill it.",
                    render: () => channelControlNode(properties, platform, onChange)
                },
                {
                    type: 'custom', label: 'Message Metadata', span: true,
                    tooltip: 'The following map variables will be included in the source map of the destination channel\'s message. Only use the map key itself, without the "${}" syntax.',
                    render: () => mapVariablesTable(properties, onChange)
                },
                { key: 'channelTemplate', label: 'Template', type: 'code', minHeight: '340px' }
            ]} />
        );
    }
};

export function register(platform) {
    platform.registerConnectorPanel('Channel Reader', 'SOURCE', channelReader);
    platform.registerConnectorPanel('Channel Writer', 'DESTINATION', channelWriter);
}

/*
 * Directory Resource — web admin plugin (directoryresource ResourceClientPlugin
 * equivalent). Registers the "Directory" resource type with the Settings →
 * Resources panel via registerResourceType: the type provides the new-resource
 * factory and the directory settings editor (directory, subdirectories,
 * description, loaded libraries). The Resources panel itself stays core and
 * renders whatever resource types are registered.
 *
 * DirectoryResourceProperties fields (verified): pluginPointName
 * 'Directory Resource', type 'Directory', id, name, description,
 * includeWithGlobalScripts, loadParentFirst, directory, directoryRecursion.
 * Libraries: GET /extensions/directoryresource/resources/{id}/libraries.
 */

const DIRECTORY_RESOURCE_CLASS = 'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties';

async function loadLibraries(ui, api, entry, libHost) {
    const { h, clear, loading } = ui;
    clear(libHost).appendChild(loading('Loading libraries…'));
    try {
        const raw = await api.get(`/extensions/directoryresource/resources/${encodeURIComponent(entry.obj.id)}/libraries`);
        const libs = api.asList(raw, 'string').map(String).filter(s => s !== '');
        clear(libHost);
        if (!libs.length) {
            libHost.appendChild(h('div.faint', 'No libraries loaded'));
        } else {
            libHost.appendChild(h('ul', {
                style: {
                    margin: '0', paddingLeft: '18px', maxHeight: '180px', overflow: 'auto',
                    fontFamily: 'var(--font-mono)', fontSize: '12px'
                }
            }, libs.map(l => h('li', l))));
        }
    } catch (e) {
        clear(libHost).appendChild(h('div.faint', 'Library list unavailable'));
    }
}

export function register(platform) {
    platform.registerResourceType('Directory', {
        type: 'Directory',
        label: 'Directory',
        propertiesClass: DIRECTORY_RESOURCE_CLASS,
        detailHeader: 'Directory Settings',

        /* New directory resource. ctx: { version, containerIsArray } — version
           mirrors an existing entry so the engine doesn't migrate from scratch;
           the @class is only needed for the array-shaped container. */
        create({ version, containerIsArray }) {
            const obj = {};
            if (version) obj['@version'] = version;
            if (containerIsArray) obj['@class'] = DIRECTORY_RESOURCE_CLASS;
            obj.pluginPointName = 'Directory Resource';
            obj.type = 'Directory';
            obj.id = crypto.randomUUID();
            obj.name = '';
            obj.description = '';
            obj.includeWithGlobalScripts = false;
            obj.loadParentFirst = false;
            obj.directory = '';
            obj.directoryRecursion = true;
            return obj;
        },

        renderDetail(host, { entry, locked, platform, refreshTable }) {
            const { h, field, textInput, checkbox } = platform.ui;
            const nameInput = textInput(entry.obj.name || '', {
                disabled: locked, onInput: (e) => { entry.obj.name = e.target.value; }
            });
            const dirInput = textInput(entry.obj.directory || '', {
                disabled: locked, onInput: (e) => { entry.obj.directory = e.target.value; }
            });
            const recursion = checkbox('Include All Subdirectories', entry.obj.directoryRecursion !== false, {
                onChange: (e) => { entry.obj.directoryRecursion = e.target.checked; }
            });
            const description = h('textarea', {
                onInput: (e) => { entry.obj.description = e.target.value; }
            }, entry.obj.description || '');
            const libHost = h('div');

            host.appendChild(h('div.form-grid',
                field('Name', nameInput, locked ? 'The Default Resource cannot be renamed' : null),
                field('Directory', dirInput, locked ? 'The Default Resource directory cannot be changed' : null),
                h('div.field', h('label', 'Subdirectories'), recursion.el),
                h('div.field.span-2', h('label', 'Description'), description),
                h('div.field.span-2', h('label', 'Loaded Libraries'), libHost)));
            loadLibraries(platform.ui, platform.api, entry, libHost);

            // Refresh the table's name cell when the name input loses focus.
            nameInput.addEventListener('change', () => { if (refreshTable) refreshTable(); });
        }
    });
}

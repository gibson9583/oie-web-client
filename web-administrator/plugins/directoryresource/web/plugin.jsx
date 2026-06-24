/*
 * Directory Resource — web admin plugin (directoryresource ResourceClientPlugin
 * equivalent, React). Registers the "Directory" resource type with the Settings →
 * Resources panel via registerResourceType: the type provides the new-resource
 * factory (create) and the directory settings editor (directory, subdirectories,
 * description, loaded libraries). The Resources panel itself stays core and
 * renders whatever resource types are registered.
 *
 * Authored in JSX against the host's React (platform.React) so the plugin
 * component shares the app's single React instance. The data model (the
 * DirectoryResourceProperties factory + the libraries fetch) is the same as the
 * original imperative plugin; only the detail editor's rendering became
 * React/JSX. The registry now holds a `component` (the detail editor) in place of
 * the old renderDetail(host, ctx); it receives the SAME ctx as PROPS —
 * { entry, locked, platform, refreshTable } — and returns JSX. The component
 * mutates entry.obj.* in place (the same object the Resources panel saves) and
 * calls refreshTable() when the name changes, matching the imperative version.
 *
 * DirectoryResourceProperties fields (verified): pluginPointName
 * 'Directory Resource', type 'Directory', id, name, description,
 * includeWithGlobalScripts, loadParentFirst, directory, directoryRecursion.
 * Libraries: GET /extensions/directoryresource/resources/{id}/libraries.
 */
import { platform } from '@oie/web-shell';
const React = platform.React;

const DIRECTORY_RESOURCE_CLASS = 'com.mirth.connect.plugins.directoryresource.DirectoryResourceProperties';

export function register(platform) {

    /* Loaded libraries list — GET .../resources/{id}/libraries. Fetched on mount
       (and when the resource id changes); same logic as the imperative
       loadLibraries(). */
    function LoadedLibraries({ entry, api }) {
        const [state, setState] = React.useState({ phase: 'loading', libs: [] });
        const id = entry.obj.id;
        React.useEffect(() => {
            let cancelled = false;
            setState({ phase: 'loading', libs: [] });
            (async () => {
                try {
                    const raw = await api.get(`/extensions/directoryresource/resources/${encodeURIComponent(id)}/libraries`);
                    const libs = api.asList(raw, 'string').map(String).filter(s => s !== '');
                    if (cancelled) return;
                    setState({ phase: 'ready', libs });
                } catch (e) {
                    if (cancelled) return;
                    setState({ phase: 'error', libs: [] });
                }
            })();
            return () => { cancelled = true; };
        }, [id]);

        if (state.phase === 'loading') {
            return <div className="loading-block"><div className="spinner" />Loading libraries…</div>;
        }
        if (state.phase === 'error') {
            return <div className="text-text-faint">Library list unavailable</div>;
        }
        if (!state.libs.length) {
            return <div className="text-text-faint">No libraries loaded</div>;
        }
        return (
            <ul className="m-0 pl-[18px] max-h-[180px] overflow-auto font-mono text-[12px]">
                {state.libs.map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}
            </ul>
        );
    }

    /* Directory settings editor. ctx (props): { entry, locked, platform, refreshTable }. */
    function DirectoryDetail({ entry, locked, platform, refreshTable }) {
        const obj = entry.obj;
        // Local mirrors so controlled inputs re-render; writes go straight to obj.
        const [name, setName] = React.useState(obj.name || '');
        const [directory, setDirectory] = React.useState(obj.directory || '');
        const [recursion, setRecursion] = React.useState(obj.directoryRecursion !== false);
        const [description, setDescription] = React.useState(obj.description || '');

        return (
            <div className="form-grid">
                <div className="field">
                    <label>Name</label>
                    <input type="text" value={name} disabled={locked}
                        onInput={(e) => { obj.name = e.target.value; setName(e.target.value); }}
                        onChange={(e) => { obj.name = e.target.value; setName(e.target.value); }}
                        onBlur={() => { if (refreshTable) refreshTable(); }} />
                    {locked ? <div className="hint">The Default Resource cannot be renamed</div> : null}
                </div>
                <div className="field">
                    <label>Directory</label>
                    <input type="text" value={directory} disabled={locked}
                        onInput={(e) => { obj.directory = e.target.value; setDirectory(e.target.value); }}
                        onChange={(e) => { obj.directory = e.target.value; setDirectory(e.target.value); }} />
                    {locked ? <div className="hint">The Default Resource directory cannot be changed</div> : null}
                </div>
                <div className="field">
                    <label>Subdirectories</label>
                    <label className="check">
                        <input type="checkbox" checked={recursion}
                            onChange={(e) => { obj.directoryRecursion = e.target.checked; setRecursion(e.target.checked); }} />
                        Include All Subdirectories
                    </label>
                </div>
                <div className="field span-2">
                    <label>Description</label>
                    <textarea value={description}
                        onInput={(e) => { obj.description = e.target.value; setDescription(e.target.value); }}
                        onChange={(e) => { obj.description = e.target.value; setDescription(e.target.value); }} />
                </div>
                <div className="field span-2">
                    <label>Loaded Libraries</label>
                    <LoadedLibraries entry={entry} api={platform.api} />
                </div>
            </div>
        );
    }

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

        // The detail editor is now a React component (was renderDetail(host, ctx));
        // the Resources panel renders <def.component {...ctx}/> via <PluginSlot>.
        component: DirectoryDetail
    });
}

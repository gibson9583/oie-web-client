/** One entry of the schema-driven connector form (see buildForm below). */
export interface FormField {
    key?: string;
    label?: string | ((properties: any) => string);
    /** Renders a section header instead of a field. */
    section?: string | null;
    type?: 'text' | 'password' | 'number' | 'select' | 'checkbox' | 'radio' | 'display' | 'textarea' | 'code' | 'keyvalue' | 'custom' | string;
    options?: Array<string | {
        value: any;
        label: string;
    }> | ((properties: any) => Array<string | {
        value: any;
        label: string;
    }>);
    width?: string;
    placeholder?: string;
    checkLabel?: string;
    minHeight?: string;
    language?: string | ((properties: any) => string);
    rows?: number;
    numeric?: boolean;
    mapShape?: 'string' | 'list';
    /** Full-width control (label above). */
    span?: boolean;
    tooltip?: string;
    /** Swing-style greying: the control stays visible but inert. */
    disabled?: boolean | ((properties: any) => boolean);
    /** Occupy the whole row (both grid columns, no label cell). */
    full?: boolean;
    /** Re-render the form when this field changes (for dependent visibility). */
    refresh?: boolean;
    visible?(properties: any): boolean;
    compute?(properties: any): any;
    render?(properties: any, ctx: {
        onChange: () => void;
        repaint: () => void;
    }): HTMLElement;
    append?(properties: any, ctx: {
        onChange: () => void;
        repaint: () => void;
    }): HTMLElement | null;
    onSet?(properties: any, value: any): void;
    [extra: string]: any;
}
export interface RequiredFieldSpec {
    key: string;
    label: string;
    when?(properties: any): boolean;
}
export declare function getPath(obj: any, path: string): any;
export declare function setPath(obj: any, path: string, value: any): any;
export declare function requireFields(properties: any, specs: RequiredFieldSpec[]): Array<{
    key: string;
    label: string;
}>;
export declare function listenerAddressField(hostKey: string, label?: string): FormField;
export declare function mapEntries(map: any): Array<[string, string]>;
export declare function writeMapEntries(map: any, rows: Array<[string, string]>, shape?: 'string' | 'list'): any;
export declare function buildForm(host: HTMLElement, properties: any, fields: FormField[], onChange: () => void): {
    repaint: () => void;
};
export declare function asBool(value: any): boolean;
export declare function portsInUseButton({ disabled }?: {
    disabled?: boolean;
}): HTMLElement;
export declare const YES_NO: Array<{
    value: boolean;
    label: string;
}>;
export declare function pollSection(properties: any, onChange: () => void): HTMLElement;
export declare function pollSettingsPanel(properties: any, onChange: () => void): HTMLElement;
export declare function defaultSourceProperties(version: string, overrides?: any): any;
export declare function defaultDestinationProperties(version: string, overrides?: any): any;
export declare function defaultListenerProperties(version: string, port?: string | number): any;
export declare function defaultPollProperties(version: string): any;
export declare function successToast(message: string): import("../core/ui.js").UiHandle;
export declare function apiErrorMessage(e: any): string;
export declare function postConnectorProperties(path: string, properties: any, channel: any, params?: any): Promise<any>;
export declare function connectorTestButton({ label, icon: iconName, path, channel, properties, disabled }: {
    label?: string;
    icon?: string;
    path: string;
    channel: any;
    properties: any;
    disabled?: boolean;
}): HTMLElement;
export declare const CHARSETS: Array<{
    value: string;
    label: string;
}>;
export declare function frameModeSampleFrame(tm: any): string;
export declare function frameModeSettingsDialog(tm: any, onChange: () => void, opts?: {
    mllp?: boolean;
}): void;

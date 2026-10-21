export declare function loadDisabledExtensions(): Promise<void>;
export declare function isExtensionDisabled(name: string | null | undefined): boolean;
/** True when every named extension is disabled (a bundled plugin with no names is never disabled). */
export declare function allExtensionsDisabled(names: unknown): boolean;
export declare function isElementTypeDisabled(type: string): boolean;

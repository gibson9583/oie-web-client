export declare const wizardStepLabel: (value: string) => string;
export declare const channelTabLabel: (value: string) => string;
export declare const connectorTabLabel: (value: string) => string;
export declare const referenceTabLabel: (value: string) => string;
export declare function builtinSectionLabel(value: string): string | undefined;
export declare const navigationSectionLabel: (value: string) => string;
export declare const eventLevelLabel: (value: string) => string;
export declare const alertEventTypeLabel: (value: string) => string;
export declare const messageStatusLabel: (value: string) => string;
export declare const wireTransportLabel: (value: string) => string;
/** Translate only the Node proxy's machine codes; keep engine-provided prose intact. */
export declare function proxyErrorLabel(code: unknown, fallback: string): string;

import type { FormField } from './forms.js';
export * from './forms.js';
export declare function ConnectorForm({ properties, fields, onChange }: {
    properties: any;
    fields: FormField[];
    onChange: () => void;
}): import("react").JSX.Element;
export declare function PortsInUseButton(): import("react").JSX.Element;
export declare function ConnectorTestButton({ label, icon: iconName, path, channel, properties }: {
    label?: string;
    icon?: string;
    path: string;
    channel: any;
    properties: any;
}): import("react").JSX.Element;
export declare function PollSection({ properties, onChange }: {
    properties: any;
    onChange: () => void;
}): import("react").JSX.Element;
export declare function TransmissionModePanel({ properties, onChange }: {
    properties: any;
    onChange: () => void;
}): import("react").JSX.Element;

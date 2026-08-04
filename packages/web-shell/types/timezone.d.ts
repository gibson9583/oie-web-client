export type TimezoneMode = 'server' | 'local' | 'utc';
/** Subscribe to mode/server-zone changes. Returns an unsubscribe function. */
export declare function onTimezoneChange(cb: () => void): () => void;
export declare function timezoneMode(): TimezoneMode;
export declare function setTimezoneMode(next: TimezoneMode): void;
export declare function cycleTimezone(): void;
/** The zone the current mode resolves to (server mode falls back to UTC). */
export declare function resolvedZone(): string;
/** Short zone abbreviation for a label, e.g. "EST", "PDT", "UTC". */
export declare function tzAbbr(zone?: string): string;
/** Abbreviation for the current mode — uses the engine's own short name in
    Server mode (e.g. "EDT"), since the parsed Etc/GMT zone would read "GMT-4". */
export declare function resolvedAbbr(): string;
/** Render a Date as "YYYY-MM-DD HH:MM:SS" in the resolved zone. */
export declare function formatInZone(date: Date, zone?: string): string;
/** Fetch the engine's configured zone once; emits so labels/views can refresh.
    Parses the engine's "<name> (UTC <offset>)" display string. */
export declare function loadServerTimezone(): Promise<void>;

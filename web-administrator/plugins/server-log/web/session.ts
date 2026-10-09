/* In-memory state for one signed-in session. The dashboard may unmount this
 * plugin, but navigating is not a new log session. Nothing is persisted to disk. */
export interface LogItem {
    id: string | number;
    serverId?: string;
    date?: unknown;
    [key: string]: any;
}

interface Snapshot {
    items: LogItem[];
    paused: boolean;
    logSize: number;
    error: string | null;
    resetting: boolean;
}

const POLL_MS = 5000;
const DEFAULT_LOG_SIZE = 100;
type FetchLogs = () => Promise<LogItem[]>;

function fingerprint(item: LogItem): string {
    return JSON.stringify([item.serverId, item.id, item.date, item.level, item.category, item.message]);
}

export class ServerLogSession {
    private snapshot: Snapshot = { items: [], paused: false, logSize: DEFAULT_LOG_SIZE, error: null, resetting: false };
    private listeners = new Set<() => void>();
    private lastItem: LogItem | null = null;
    private lastId: number | null = null;
    private baselinePending = false;
    private resetVersion = 0;
    private resetPending = false;
    private disposed = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private flight: Promise<void> | null = null;

    constructor(private fetchLogs: FetchLogs) {}

    getSnapshot = (): Snapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        if (this.listeners.size === 1) void this.poll();
        return () => {
            this.listeners.delete(listener);
            if (!this.listeners.size) this.stopTimer();
        };
    };

    private publish(patch: Partial<Snapshot>): void {
        this.snapshot = { ...this.snapshot, ...patch };
        this.listeners.forEach(listener => listener());
    }

    private stopTimer(): void {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }

    clear(): void {
        if (this.disposed) return;
        this.resetPending = false;
        // An outstanding request belongs to the display the user just cleared.
        // Consume its cursor without displaying its rows. If it fails, retain
        // this intent until the next successful fetch establishes the baseline.
        this.baselinePending = this.baselinePending || this.lastId === null || this.flight !== null;
        this.publish({ items: [], error: null, resetting: false });
    }

    /** Restore the engine's retained history without changing display settings. */
    reset(): void {
        if (this.disposed || (this.resetPending && this.snapshot.resetting)) return;
        this.resetVersion++;
        this.resetPending = true;
        this.baselinePending = false;
        this.publish({ error: null, resetting: true });
        // Wait for an older read to settle, then fetch a fresh snapshot. Its
        // success or failure belongs to the superseded display and is ignored.
        void this.poll();
    }

    togglePause(): void {
        if (this.disposed) return;
        this.publish({ paused: !this.snapshot.paused });
        this.stopTimer();
        if (!this.snapshot.paused) void this.poll();
    }

    setSize(value: number): void {
        if (this.disposed) return;
        const logSize = Math.max(1, Math.min(99999, Math.trunc(value) || DEFAULT_LOG_SIZE));
        this.publish({ logSize, items: this.snapshot.items.slice(0, logSize) });
    }

    dispose(): void {
        this.disposed = true;
        this.stopTimer();
        this.lastId = null;
        this.lastItem = null;
        this.resetPending = false;
        this.publish({ items: [], error: null, paused: false, logSize: DEFAULT_LOG_SIZE, resetting: false });
    }

    private async receive(): Promise<void> {
        const resetVersion = this.resetVersion;
        const resetting = this.resetPending;
        const retained = await this.fetchLogs();
        // A queued Reset supersedes this read; Clear cancels that Reset and
        // allows the same read to establish its baseline without losing a batch.
        if (this.disposed || (this.resetPending && resetVersion !== this.resetVersion)) return;
        const suppress = this.baselinePending;
        // Pause freezes the display and cursor; resuming can fetch these rows
        // again. A clear baseline may still finish while paused.
        if (this.snapshot.paused && !suppress && !resetting) return;

        const history = retained.filter(item => Number.isFinite(Number(item.id)))
            .sort((a, b) => Number(b.id) - Number(a.id));
        const newest = history[0];
        const cursor = this.lastId;
        const anchor = history.find(item => Number(item.id) === cursor);
        // Compare identity even when IDs have overtaken the saved cursor. An
        // empty snapshot or an aged-out anchor cannot prove a process restart.
        const replace = resetting || !!(newest && cursor !== null && (Number(newest.id) < cursor ||
            (anchor && this.lastItem && fingerprint(anchor) !== fingerprint(this.lastItem))));
        const fresh = replace || cursor === null ? history : history.filter(item => Number(item.id) > cursor);
        if (newest) {
            this.lastId = Number(newest.id);
            this.lastItem = newest;
        } else if (this.resetPending || this.lastId === null) {
            // Only a still-pending Reset may discard an established cursor;
            // Clear can cancel it while the request is in flight.
            this.lastId = 0;
            this.lastItem = null;
        }
        this.baselinePending = false;
        this.resetPending = false;
        // Defensive de-duplication also protects against repeated server rows.
        const byId = new Map<string, LogItem>();
        const previous = replace ? [] : this.snapshot.items;
        for (const item of suppress ? previous : fresh.concat(previous)) {
            if (!byId.has(String(item.id))) byId.set(String(item.id), item);
        }
        this.publish({ items: [...byId.values()].slice(0, this.snapshot.logSize), error: null, resetting: false });
    }

    private poll(): Promise<void> {
        this.stopTimer();
        if (this.disposed || !this.listeners.size || (this.snapshot.paused && !this.resetPending)) return Promise.resolve();
        if (this.flight) return this.flight;
        const resetVersion = this.resetVersion;
        if (this.resetPending) this.publish({ resetting: true });
        // A single shared request survives remounts; it cannot race a resume or
        // another mount. Once hidden, it may finish but cannot schedule a poll.
        this.flight = this.receive().catch(error => {
            if (this.disposed) return;
            // Display actions may supersede results, but never an access denial.
            if (error?.status === 403) this.publish({ items: [] });
            if (!this.resetPending || resetVersion === this.resetVersion) this.publish({
                error: error instanceof Error ? error.message : String(error),
                resetting: false
            });
        }).finally(() => {
            this.flight = null;
            if (!this.disposed && this.listeners.size) {
                if (this.resetPending && resetVersion !== this.resetVersion) {
                    void this.poll();
                } else if (!this.snapshot.paused) {
                    this.timer = setTimeout(() => { void this.poll(); }, POLL_MS);
                }
            }
        });
        return this.flight;
    }
}

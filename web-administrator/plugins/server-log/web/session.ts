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
}

const POLL_MS = 5000;
const DEFAULT_LOG_SIZE = 100;
type FetchLogs = (size: number, lastId: number | null) => Promise<LogItem[]>;

function fingerprint(item: LogItem): string {
    return JSON.stringify([item.serverId, item.id, item.date, item.level, item.category, item.message]);
}

export class ServerLogSession {
    private snapshot: Snapshot = { items: [], paused: false, logSize: DEFAULT_LOG_SIZE, error: null };
    private listeners = new Set<() => void>();
    private lastItem: LogItem | null = null;
    private lastId: number | null = null;
    private clearVersion = 0;
    private baselinePending = false;
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
        this.clearVersion++;
        // An outstanding request belongs to the display the user just cleared.
        // Consume its cursor without displaying its rows. If it fails, retain
        // this intent until the next successful fetch establishes the baseline.
        this.baselinePending = this.baselinePending || this.lastId === null || this.flight !== null;
        this.publish({ items: [], error: null });
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
        this.publish({ items: [], error: null, paused: false, logSize: DEFAULT_LOG_SIZE });
    }

    private async receive(): Promise<void> {
        const version = this.clearVersion;
        let fresh = await this.fetchLogs(this.snapshot.logSize, this.lastId);
        if (this.disposed) return;
        let restarted = false;

        // Engine log IDs restart from 1. An empty incremental response alone
        // cannot distinguish an idle engine from a restarted one. Inspect just
        // the newest retained entry, and reload only if the cursor was reset.
        if (!fresh.length && this.lastId !== null) {
            const [head] = await this.fetchLogs(1, null);
            if (this.disposed) return;
            if (head && (Number(head.id) < this.lastId ||
                (Number(head.id) === this.lastId && this.lastItem && fingerprint(head) !== fingerprint(this.lastItem)))) {
                restarted = true;
                fresh = await this.fetchLogs(this.snapshot.logSize, null);
                if (this.disposed) return;
            }
        }

        const suppress = this.baselinePending || version !== this.clearVersion;
        // Pause freezes the display and cursor; resuming can fetch these rows
        // again. A clear baseline may still finish while paused.
        if (this.snapshot.paused && !suppress) return;
        // Commit the restart only after its reload succeeded. A failed reload
        // must not discard the old cursor or bypass a pending clear on retry.
        if (restarted) {
            this.lastId = null;
            this.lastItem = null;
        }
        fresh = fresh.filter(item => Number.isFinite(Number(item.id)))
            .sort((a, b) => Number(b.id) - Number(a.id));
        const newest = fresh[0];
        if (newest) {
            this.lastId = Number(newest.id);
            this.lastItem = newest;
        } else if (this.lastId === null) {
            this.lastId = 0;
        }
        this.baselinePending = false;
        // Defensive de-duplication also protects against repeated server rows.
        const byId = new Map<string, LogItem>();
        const previous = restarted ? [] : this.snapshot.items;
        for (const item of suppress ? previous : fresh.concat(previous)) {
            if (!byId.has(String(item.id))) byId.set(String(item.id), item);
        }
        this.publish({ items: [...byId.values()].slice(0, this.snapshot.logSize), error: null });
    }

    private poll(): Promise<void> {
        this.stopTimer();
        if (this.disposed || !this.listeners.size || this.snapshot.paused) return Promise.resolve();
        if (this.flight) return this.flight;
        // A single shared request survives remounts; it cannot race a resume or
        // another mount. Once hidden, it may finish but cannot schedule a poll.
        this.flight = this.receive().catch(error => {
            if (!this.disposed) this.publish({
                // Revoked log access must remove previously authorized content
                // from the session cache as well as expose the denial in the UI.
                ...(error?.status === 403 ? { items: [] } : {}),
                error: error instanceof Error ? error.message : String(error)
            });
        }).finally(() => {
            this.flight = null;
            if (!this.disposed && this.listeners.size && !this.snapshot.paused) {
                this.timer = setTimeout(() => { void this.poll(); }, POLL_MS);
            }
        });
        return this.flight;
    }
}

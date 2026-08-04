export interface Command {
    id: string;
    label: string;
    icon?: string;
    section?: string;
    order?: number;
    keywords?: string | string[];
    task?: string;
    rbac?: any;
    /** Navigation target; `run` is called instead when present. */
    path?: string;
    run?: () => void;
    /** Nav-item-shaped extras pass through untouched. */
    [extra: string]: any;
}
/** Register a palette command. Returns an unregister function. */
export declare function registerCommand(command: Command): () => void;
/** All registered commands, in section then order then label. */
export declare function allCommands(): Command[];
export declare function fuzzyMatch(text: string, needle: string): {
    score: number;
    hits: number[];
} | null;

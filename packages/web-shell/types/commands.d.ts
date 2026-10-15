import type { RouteTasks } from './route-tasks.js';
export interface Command {
    id: string;
    label: string;
    icon?: string;
    section?: string;
    order?: number;
    keywords?: string | string[];
    task?: string;
    rbac?: any;
    /** API 4.9: additional availability predicate, rechecked when the command runs. */
    visible?: () => boolean;
    /** Additional all-of prerequisites, checked alongside `task`/`rbac`. */
    permissions?: RouteTasks;
    /** Navigation target; `run` is called instead when present. */
    path?: string;
    run?: () => void;
    /** Nav-item-shaped extras pass through untouched. */
    [extra: string]: any;
}
/** Keep the legacy task gate when a command also declares route prerequisites. */
export declare function commandPermissions(command: Pick<Command, 'task' | 'rbac' | 'permissions'>): RouteTasks;
/** Register a palette command. Returns an unregister function. */
export declare function registerCommand(command: Command): () => void;
/** All registered commands, in section then order then label. */
export declare function allCommands(): Command[];
export declare function fuzzyMatch(text: string, needle: string): {
    score: number;
    hits: number[];
} | null;

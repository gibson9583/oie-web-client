/*
 * Command registry — the flat list of things the command palette can run.
 *
 * The left rail already has a registry (platform.navItems) and the task panes do
 * not: a view's tasks are JSX rendered inline, because most of them act on the
 * current selection and only make sense while that view is mounted. So this is
 * deliberately NOT "every task button". It is the subset that is meaningful from
 * anywhere — navigation, the create/import entry points, and session actions —
 * plus whatever views and plugins choose to add.
 *
 * A command is the same shape as a nav item, so the palette can treat both alike:
 *
 *   { id, label, icon?, section?, order?, keywords?, task?, rbac?, path?, run? }
 *
 * `path` navigates; `run` is called instead when present. `task` + `rbac` are the
 * authorization pair the task panes and popup menus already use — the palette
 * filters through the SAME checkTask(), so it can never surface an action the
 * rail would have hidden.
 */

const commands = [];

/** Register a palette command. Returns an unregister function. */
export function registerCommand(command) {
    commands.push(command);
    return () => {
        const i = commands.indexOf(command);
        if (i !== -1) commands.splice(i, 1);
    };
}

/** All registered commands, in section then order then label. */
export function allCommands() {
    return commands.slice().sort((a, b) =>
        String(a.section || '').localeCompare(String(b.section || ''))
        || (a.order ?? 100) - (b.order ?? 100)
        || String(a.label).localeCompare(String(b.label)));
}

/* ---- matching ---------------------------------------------------------------
 * Subsequence, not substring: "vsc" finds "Validate Script". Scoring favours
 * consecutive hits and word starts, so a tight match on a short name beats a
 * scattered one on a long name. Returns null when the needle doesn't match at
 * all, or { score, hits } where `hits` are the matched character indices — the
 * palette highlights them, so the ranking shows its working.
 */
export function fuzzyMatch(text, needle) {
    if (!needle) return { score: 0, hits: [] };
    const haystack = String(text).toLowerCase();
    const want = needle.toLowerCase();
    const hits = [];
    let score = 0;
    let from = 0;
    for (let i = 0; i < want.length; i++) {
        const at = haystack.indexOf(want[i], from);
        if (at === -1) return null;
        if (i > 0 && at === hits[hits.length - 1] + 1) score -= 6;          // consecutive run
        if (at === 0 || /[\s\-_:/.]/.test(haystack[at - 1])) score -= 4;    // start of a word
        score += at - from;                                                 // gaps cost
        hits.push(at);
        from = at + 1;
    }
    return { score, hits };
}

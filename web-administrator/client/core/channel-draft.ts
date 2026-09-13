/* Older versions saved complete channel configurations (including credentials)
   in localStorage. Remove those copies for every engine/user before sign-in.
   Unsaved channel edits now live only in memory for the active session. */
export function purgeChannelDrafts(): void {
    try {
        // Storage key order can change after a removal; snapshot before deleting.
        const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
        for (const key of keys) {
            if (key === 'webadmin.channel-draft' || key?.startsWith('webadmin.channel-draft:')) {
                localStorage.removeItem(key);
            }
        }
    } catch { /* storage may be unavailable */ }
}

/** Shared by the Settings tabs and their command-palette entry points. */
export const BUILTIN_SETTINGS_LABELS = [
    'Server', 'Administrator', 'Tags', 'Configuration Map', 'Database Tasks', 'Resources'
];

export function settingsTabId(label: string): string {
    return label.trim().toLowerCase().replace(/\s+/g, '');
}

export function canViewSettingsTab(platform: { checkTask(group: string, task: string): boolean }, label: string): boolean {
    const group = `settings_${label}`;
    return platform.checkTask(group, 'doRefresh') || platform.checkTask(group, 'doSave');
}

/*
 * Display preferences and tag rendering shared by the Dashboard and Channels
 * boards. Swing keeps ONE set of these user preferences for both panels
 * (channelGroupViewEnabled, showTags, tagTextMode), so a choice made on one
 * board carries to the other. The localStorage keys keep their original
 * `oie-dash-` names so choices saved before the Channels board had the toggles
 * survive.
 */

import { iconPath } from '../../core/icons.js';

export type ViewMode = 'group' | 'channel';
export type TagMode = 'names' | 'icons' | 'off';

export function lsGet(key: string, fallback: string) {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}

export function lsSet(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

/* Groups / Channels row arrangement — Swing's table-mode toggle buttons. */
export function loadViewMode(): ViewMode {
    return lsGet('oie-dash-view', 'group') === 'channel' ? 'channel' : 'group';
}

export function saveViewMode(mode: ViewMode) {
    lsSet('oie-dash-view', mode);
}

export const VIEW_MODE_OPTIONS = [
    { value: 'group', icon: 'folder', title: 'Group view' },
    { value: 'channel', icon: 'channels', title: 'Channel view' }
];

/* Tags as names / icons / hidden — Swing's two tag-mode toggle buttons, where
   deselecting the active one hides the tags. */
export function loadTagMode(): TagMode {
    const saved = lsGet('oie-dash-tagmode', 'names');
    return saved === 'icons' || saved === 'off' ? saved : 'names';
}

export function saveTagMode(mode: TagMode) {
    lsSet('oie-dash-tagmode', mode);
}

export const TAG_MODE_OPTIONS = [
    { value: 'names', label: 'Names', title: 'Show tags as names' },
    { value: 'icons', label: 'Icons', title: 'Show tags as icons' },
    { value: 'off', label: 'Off', title: 'Hide tags' }
];

/* ChannelTag backgroundColor arrives as {red, green, blue, alpha}. */
export function tagRgb(tag: any, alpha?: number) {
    const c = tag?.backgroundColor;
    if (c && typeof c === 'object' && c.red !== undefined && c.green !== undefined && c.blue !== undefined) {
        return alpha !== undefined ? `rgba(${c.red}, ${c.green}, ${c.blue}, ${alpha})` : `rgb(${c.red}, ${c.green}, ${c.blue})`;
    }
    return null;
}

/* Per-tag color applied like the .tag.<color> variants (tint fill, colored
   border), with text mixed toward the theme foreground so arbitrary/pale tag
   colors stay readable in both themes. */
export function tagPillStyle(tag: any) {
    const c = tagRgb(tag);
    if (!c) return undefined;
    return {
        background: `color-mix(in srgb, ${c} 26%, transparent)`,
        borderColor: `color-mix(in srgb, ${c} 40%, transparent)`,
        color: `color-mix(in srgb, ${c} 72%, var(--text))`
    };
}

/* Icons mode: the actual tag glyph filled with the tag's color, stroked a
   slightly darker shade so the shape still reads against any row. */
export function tagIcon(tag: any, key: any) {
    const color = tagRgb(tag) || 'var(--text-dim)';
    return (
        <span key={key} title={tag.name} className="inline-flex flex-none">
            <svg viewBox="0 0 24 24" width={12} height={12} fill={color}
                stroke={`color-mix(in srgb, ${color} 75%, black)`}
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={iconPath('tag')} />
            </svg>
        </span>
    );
}

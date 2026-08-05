/**
 * Register a plugin glyph: `pathData` is SVG path data drawn on a 24x24 grid,
 * rendered stroke-only (1.7px, currentColor) like every built-in. Unknown
 * names still fall back to the `info` glyph, so plugins running on shells
 * without their icons degrade instead of breaking. Re-registering a plugin
 * name overwrites (same rule as the other name-keyed registries); built-in
 * names are protected.
 */
export declare function registerIcon(name: string, pathData: string): void;
export declare function icon(name: string, size?: number): SVGElement;
export declare function iconPath(name: string): string;

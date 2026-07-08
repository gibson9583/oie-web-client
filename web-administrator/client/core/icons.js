/*
 * Inline SVG icon set (24px grid, stroke-based). Dependency-free so the app
 * works in air-gapped environments. icon(name, size?) returns an SVGElement.
 */

const P = {
    dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 9h8V3h-8z',
    channels: 'M2 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0M7.7 10.7l8.6-4.4M7.7 13.3l8.6 4.4',
    messages: 'M21 8l-9 5-9-5M3 5h18v14H3z',
    events: 'M12 8v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
    alerts: 'M12 3l9 16H3zM12 10v4M12 17.5v.5',
    wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h.01M17.8 6.2 19 5M12.2 6.2 11 5M4 20l7-7',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.07-.4.1-.8.1-1.2z',
    extensions: 'M8 2v6M16 2v6M5 8h14v4a7 7 0 0 1-14 0V8zM12 19v3',
    code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M13 4l-2 16',
    scripts: 'M7 3h10l4 4v14H7zM17 3v4h4M10 12h6M10 16h6',
    play: 'M7 4l13 8-13 8z',
    stop: 'M6 6h12v12H6z',
    pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
    halt: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM5.5 5.5l13 13',
    deploy: 'M12 21V8M6 14l6-6 6 6M4 3h16',
    undeploy: 'M12 3v13M6 10l6 6 6-6M4 21h16',
    refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 3v5h-5',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    x: 'M6 6l12 12M18 6L6 18',
    check: 'M4 13l5 5L20 7',
    save: 'M5 4h11l3 3v13H5zM9 4v4h5V4M8 20v-7h8v7',
    edit: 'M4 20l4-1L20 7l-3-3L5 16zM14 6l3 3',
    trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    export: 'M12 15V3M8 7l4-4 4 4M5 21h14v-7',
    import: 'M12 3v12M8 11l4 4 4-4M5 21h14v-7',
    send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    filter: 'M3 5h18l-7 8v6l-4-2v-4z',
    transform: 'M4 7h12M12 3l4 4-4 4M20 17H8M12 13l-4 4 4 4',
    chevL: 'M15 6l-6 6 6 6',
    chevR: 'M9 6l6 6-6 6',
    chevD: 'M6 9l6 6 6-6',
    arrowUp: 'M12 19V5M6 11l6-6 6 6',
    arrowDown: 'M12 5v14M6 13l6 6 6-6',
    clear: 'M5 12a7 7 0 1 1 2 5M3 21l4-4M9 9l6 6M15 9l-6 6',
    server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
    logout: 'M15 12H4M8 8l-4 4 4 4M12 3h8v18h-8',
    sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
    moon: 'M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z',
    grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
    tag: 'M3 11V3h8l10 10-8 8zM8 8h.01',
    db: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    folder: 'M3 6h6l2 2h10v12H3z',
    file: 'M6 2h9l5 5v15H6zM14 2v6h6',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    warning: 'M12 3l9 16H3zM12 10v4M12 17.5v.5',
    bug: 'm8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.8 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.2 3.8 1.9 3.8 4',
    info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8v.5',
    clock: 'M12 8v5l3 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
    puzzle: 'M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 4 5.6 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.6-4-9s1.5-6.5 4-9z',
    key: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4zM16.5 7.5h.01',
    mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
    menu: 'M4 6h16M4 12h16M4 18h16',
    maximize: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
    minimize: 'M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3',
    popout: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
    store: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0'
};

export function icon(name, size = 16) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.7');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', P[name] || P.info);
    svg.appendChild(path);
    return svg;
}

// Raw path data for renderers that build their own <svg> (e.g. the React <Icon>
// component) instead of using icon()'s DOM SVGElement. Mirrors icon()'s fallback.
export function iconPath(name) { return P[name] || P.info; }

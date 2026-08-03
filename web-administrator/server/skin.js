'use strict';
/*
 * Skin — the deployment's branding override (THEMING.md is the token contract).
 *
 * config.skin names a directory whose skin.css re-declares design tokens for
 * BOTH theme modes. It does not add Theme choices: the dropdown stays Light /
 * Dark, and the skin restyles what those mean. The directory serves at the
 * FIXED path /webadmin/skin/ (so a skin's absolute asset urls are portable
 * across skins), and the shell routes link its skin.css AFTER the app
 * stylesheet — the skin's token re-declarations win on source order alone.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

/** The configured skin directory when usable (skin.css present), else null. */
function activeSkinDir(config) {
    if (!config.skin) return null;
    if (!fs.existsSync(path.join(config.skin, 'skin.css'))) {
        console.warn(`  [skin] ${config.skin}/skin.css not found — skin disabled`);
        return null;
    }
    return config.skin;
}

/** Mount /webadmin/skin/ when configured. Returns the active dir (or null). */
function install(app, config) {
    const dir = activeSkinDir(config);
    // dotfiles:'deny' + no index, matching the plugin asset mounts: the skin dir
    // is operator-supplied but still shouldn't leak dotfiles or listings.
    if (dir) app.use('/webadmin/skin', express.static(dir, { dotfiles: 'deny', index: false }));
    return dir;
}

/** Add the skin stylesheet link to served shell HTML. Inserted at </head> so it
    lands after the app's own stylesheet — load order is the override mechanism. */
function injectLink(html) {
    return html.replace('</head>', '  <link rel="stylesheet" href="/webadmin/skin/skin.css">\n</head>');
}

module.exports = { install, injectLink };

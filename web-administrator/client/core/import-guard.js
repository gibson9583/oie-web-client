/*
 * Import version guard — a faithful port of Swing's Frame.promptObjectMigration
 * (client/src/.../Frame.java) via MigrationUtil. Three branches on the export's
 * version vs the connected server's version:
 *
 *   same    -> import silently
 *   newer   -> BLOCK (alertInformation, title "Information")
 *   older / unknown -> CONFIRM the automatic conversion (title "Select an Option")
 *
 * Parity details that matter:
 *   - Version source is the ROOT element's `version` attribute
 *     (MigrationUtil.getSerializedObjectVersion / XStream VERSION_ATTRIBUTE_NAME).
 *   - Compare normalizes BOTH versions to exactly 3 components
 *     (MigrationUtil.compareVersions(v1, v2, 3)) — so 4.6.0.x == 4.6.0.
 *   - Message strings are verbatim from Frame.promptObjectMigration with the
 *     product name "Open Integration Engine" (BrandingConstants.PRODUCT_NAME).
 *
 * Swing guards channels, channel groups, and server configuration with this — NOT
 * alerts or code templates (their import paths rely on the serializer's forward
 * migration). Match that coverage at the call sites.
 */

import * as store from './store.js';

const PRODUCT = 'Open Integration Engine';

// MigrationUtil.compareVersions(v1, v2, 3): pad/truncate both to 3 components.
function compareVersions(v1, v2) {
    const norm = (v) => {
        const parts = String(v).split('.');
        while (parts.length < 3) parts.push('0');
        return parts.slice(0, 3).map((n) => parseInt(n, 10) || 0);
    };
    const a = norm(v1);
    const b = norm(v2);
    for (let i = 0; i < 3; i++) {
        if (a[i] < b[i]) return -1;
        if (a[i] > b[i]) return 1;
    }
    return 0;
}

/**
 * Verdict for importing an export stamped `exportVersion` (Swing objectName, e.g.
 * "channel", "channel or group", "server configuration"):
 *   { action: 'ok' }
 *   { action: 'block',   message }   — newer than the server
 *   { action: 'confirm', message }   — older/unknown; ask before converting
 */
export function checkImportVersion(exportVersion, objectName = 'file') {
    const server = store.getState('serverVersion');
    if (!server) return { action: 'ok' };   // server version unknown: engine stays the authority

    if (exportVersion) {
        const comparison = compareVersions(exportVersion, server);
        if (comparison === 0) return { action: 'ok' };
        if (comparison > 0) {
            return {
                action: 'block',
                message: `The ${objectName} being imported originated from ${PRODUCT} version ${exportVersion}.\n`
                    + `You are using ${PRODUCT} version ${server}.\n`
                    + `The ${objectName} cannot be imported, because it originated from a newer version of ${PRODUCT}.`
            };
        }
        // older
        return {
            action: 'confirm',
            message: `The ${objectName} being imported originated from ${PRODUCT} version ${exportVersion}.\n`
                + `You are using ${PRODUCT} version ${server}.\n`
                + `Would you like to automatically convert the ${objectName} to the ${server} format?`
        };
    }

    // unknown version
    return {
        action: 'confirm',
        message: `The ${objectName} being imported is from an older or unknown version of ${PRODUCT}.\n`
            + `You are using ${PRODUCT} version ${server}.\n`
            + `Would you like to automatically convert the ${objectName} to the ${server} format?`
    };
}

/** Verdict from parsed export XML: the ROOT element's version attribute, Swing-style. */
export function checkImportVersionFromDoc(doc, objectName) {
    const version = doc && doc.documentElement && doc.documentElement.getAttribute('version');
    return checkImportVersion(version, objectName);
}

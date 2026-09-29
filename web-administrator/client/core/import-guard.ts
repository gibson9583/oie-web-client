import { t as translate } from "./i18n.js";
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
 * Swing guards channels, channel groups, and server configuration with this.
 * Alert imports also use it because issue #40 explicitly requires the same
 * forward-version protection alongside alert collision handling.
 */

import * as store from './store.js';

const PRODUCT = 'Open Integration Engine';

/** The guard's verdict: import silently, block, or confirm the conversion. */
export interface ImportVerdict {
    action: 'ok' | 'block' | 'confirm';
    message?: string;
}

// MigrationUtil.compareVersions(v1, v2, 3): pad/truncate both to 3 components.
function compareVersions(v1: string, v2: string): number {
    const norm = (v: string) => {
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
export function checkImportVersion(exportVersion: string | null | undefined, objectName: string = 'file'): ImportVerdict {
    const server = store.getState('serverVersion');
    if (!server) return { action: 'ok' };   // server version unknown: engine stays the authority

    if (exportVersion) {
        const comparison = compareVersions(exportVersion, server);
        if (comparison === 0) return { action: 'ok' };
        if (comparison > 0) {
            return {
                action: 'block',
                message: translate("The {value1} being imported originated from {value2} version {value3}.\nYou are using {value4} version {value5}.\nThe {value6} cannot be imported, because it originated from a newer version of {value7}.", { value1: String(objectName), value2: String(PRODUCT), value3: String(exportVersion), value4: String(PRODUCT), value5: String(server), value6: String(objectName), value7: String(PRODUCT) })
            };
        }
        // older
        return {
            action: 'confirm',
            message: translate("The {value1} being imported originated from {value2} version {value3}.\nYou are using {value4} version {value5}.\nWould you like to automatically convert the {value6} to the {value7} format?", { value1: String(objectName), value2: String(PRODUCT), value3: String(exportVersion), value4: String(PRODUCT), value5: String(server), value6: String(objectName), value7: String(server) })
        };
    }

    // unknown version
    return {
        action: 'confirm',
        message: translate("The {value1} being imported is from an older or unknown version of {value2}.\nYou are using {value3} version {value4}.\nWould you like to automatically convert the {value5} to the {value6} format?", { value1: String(objectName), value2: String(PRODUCT), value3: String(PRODUCT), value4: String(server), value5: String(objectName), value6: String(server) })
    };
}

/** Verdict from parsed export XML: the ROOT element's version attribute, Swing-style. */
export function checkImportVersionFromDoc(doc: Document | null | undefined, objectName?: string): ImportVerdict {
    const version = doc?.documentElement?.getAttribute('version');
    return checkImportVersion(version, objectName);
}

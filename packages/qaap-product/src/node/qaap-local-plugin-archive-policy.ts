// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Policy for blocking untrusted local plugin archives (VSIX / `.theia` via `local-file:`).
 *
 * GHSA-mp2f-45pm-3cg9 is mitigated by the central `@theia/qaap-archive` extractor.
 * This policy is defense-in-depth: deny tenant-uploaded / drag-drop archives unless the
 * operator explicitly opts in. Marketplace (`vscode-extension:`) and build-time
 * `download-plugins` are unaffected.
 *
 * Enabled by default. Set `QAAP_ALLOW_LOCAL_VSIX=1` (or true/on/yes) to allow local installs
 * for desktop/dev workflows that need sideloading.
 */
export const LOCAL_PLUGIN_FILE_SCHEME_PREFIX = 'local-file:';

export function isLocalPluginArchivePolicyEnabled(): boolean {
    const raw = process.env.QAAP_ALLOW_LOCAL_VSIX?.trim();
    if (!raw) {
        return true;
    }
    return !/^(1|true|yes|on)$/i.test(raw);
}

export function isLocalPluginArchiveInstallBlocked(pluginEntry: string): boolean {
    return isLocalPluginArchivePolicyEnabled()
        && pluginEntry.startsWith(LOCAL_PLUGIN_FILE_SCHEME_PREFIX);
}

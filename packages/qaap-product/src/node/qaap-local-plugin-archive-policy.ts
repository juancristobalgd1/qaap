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
 * for local desktop/dev workflows that need sideloading. Hosted/production deployments always
 * block local archives because a plugin executes in the shared Theia control-plane process.
 */
import { isQaapHostedEnvironment } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';

export const LOCAL_PLUGIN_FILE_SCHEME_PREFIX = 'local-file:';

export function isLocalPluginArchivePolicyEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    if (isQaapHostedEnvironment(env)) {
        return true;
    }
    const raw = env.QAAP_ALLOW_LOCAL_VSIX?.trim();
    if (!raw) {
        return true;
    }
    return !/^(1|true|yes|on)$/i.test(raw);
}

export function isLocalPluginArchiveInstallBlocked(pluginEntry: string, env: NodeJS.ProcessEnv = process.env): boolean {
    return isLocalPluginArchivePolicyEnabled(env)
        && pluginEntry.startsWith(LOCAL_PLUGIN_FILE_SCHEME_PREFIX);
}

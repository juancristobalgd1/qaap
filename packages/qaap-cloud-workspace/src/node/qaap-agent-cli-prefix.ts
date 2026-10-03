// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as path from 'path';
import { QaapTenantAgentStorageEnv } from './qaap-tenant-agent-storage-env';

/** Directory name of the per-user npm prefix inside the tenant agent storage data directory. */
export const QAAP_AGENT_CLI_STORAGE_DIRNAME = 'qaap-cli';

export function resolveAgentCliPrefix(home: string): string {
    return path.join(home, '.qaap', 'cli');
}

/**
 * The npm prefix that receives harness CLIs installed from the Harness settings.
 *
 * A tenant backend container has a read-only rootfs and a tmpfs HOME, so `$HOME/.qaap/cli` would be
 * either unwritable or lost on restart; there the prefix lives on the disk-backed, tenant-private
 * agent storage mount (the agent uid already has rwx there). Everywhere else it is `<home>/.qaap/cli`.
 */
export function resolveAgentCliPrefixForEnv(env: NodeJS.ProcessEnv, home: string): string {
    if (/^(1|true)$/i.test(env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '')) {
        const storageRoot = QaapTenantAgentStorageEnv.resolveRoot(env, QaapTenantAgentStorageEnv.defaultTenantBackendRoot(env));
        if (storageRoot) {
            return path.posix.join(QaapTenantAgentStorageEnv.dataDir(storageRoot), QAAP_AGENT_CLI_STORAGE_DIRNAME);
        }
    }
    return resolveAgentCliPrefix(home);
}

export function resolveAgentCliPrefixBinDirectory(prefix: string, platform: NodeJS.Platform = process.platform): string {
    return platform === 'win32' ? prefix : path.join(prefix, 'bin');
}

export function resolveAgentCliBinDirectory(home: string, platform: NodeJS.Platform = process.platform): string {
    return resolveAgentCliPrefixBinDirectory(resolveAgentCliPrefix(home), platform);
}

/** Put the tenant's installed harnesses (npm `prefix`) before image-baked binaries, without duplicating the entry. */
export function prependAgentCliBinToPath(
    env: NodeJS.ProcessEnv,
    prefix: string,
    platform: NodeJS.Platform = process.platform,
): void {
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
    const binDirectory = resolveAgentCliPrefixBinDirectory(prefix, platform);
    const sameEntry = (entry: string): boolean => platform === 'win32'
        ? entry.toLowerCase() === binDirectory.toLowerCase()
        : entry === binDirectory;
    const isQaapCliBin = (entry: string): boolean =>
        /(?:^|[\\/])(?:\.qaap[\\/]cli|qaap-cli)(?:[\\/]bin)?$/i.test(entry);
    const entries = (env[pathKey] ?? '').split(path.delimiter)
        .filter(entry => entry && !sameEntry(entry) && !isQaapCliBin(entry));
    env[pathKey] = [binDirectory, ...entries].join(path.delimiter);
    for (const key of Object.keys(env)) {
        if (key !== pathKey && key.toLowerCase() === 'path') {
            delete env[key];
        }
    }
}

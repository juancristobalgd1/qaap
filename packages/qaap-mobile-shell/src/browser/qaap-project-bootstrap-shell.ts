// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { OS } from '@theia/core/lib/common/os';
import URI from '@theia/core/lib/common/uri';

export interface QaapManagedShellInvocation {
    readonly shellPath: string;
    readonly shellArgs: string[];
}

/**
 * Filesystem path of a workspace URI on the **backend** OS.
 *
 * Do not use `FileUri.fsPath` for managed preview spawns: that helper follows the browser OS, so a
 * Windows client talking to a Linux workspace host would spawn with `\home\ubuntu\...` and `cmd.exe`.
 */
export function resolveWorkspaceHostFsPath(cwd: URI): string {
    return cwd.path.fsPath();
}

function defaultManagedShellPlatform(): string {
    return OS.backend.isWindows ? 'Win32' : 'Linux';
}

/** Builds a managed shell command whose project cwd survives terminal widget restoration. */
export function buildQaapManagedShellInvocation(
    command: string,
    cwd: string,
    platform: string = defaultManagedShellPlatform(),
): QaapManagedShellInvocation {
    if (/^win/i.test(platform)) {
        const quotedCwd = `"${cwd.replace(/"/g, '""')}"`;
        return { shellPath: 'cmd.exe', shellArgs: ['/d', '/s', '/c', `cd /d ${quotedCwd} && ${command}`] };
    }
    const quotedCwd = `'${cwd.replace(/'/g, "'\"'\"'")}'`;
    return { shellPath: '/bin/bash', shellArgs: ['-l', '-c', `cd -- ${quotedCwd} && ${command}`] };
}

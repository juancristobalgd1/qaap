// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { OS } from '@theia/core/lib/common/os';
import { Path } from '@theia/core/lib/common/path';
import URI from '@theia/core/lib/common/uri';
import { normalizeIsolationPath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

export interface QaapManagedShellInvocation {
    readonly shellPath: string;
    readonly shellArgs: string[];
}

/**
 * Filesystem path of a workspace URI on the **backend** OS (Linux, macOS, or Windows).
 *
 * Do not use `FileUri.fsPath` for managed preview/terminal cwds: that helper follows the browser OS,
 * so a Windows client talking to a Linux/macOS workspace host would spawn with `\home\ubuntu\...`.
 * Format + normalize for {@link OS.backend} so the string matches what the server expects.
 */
export function resolveWorkspaceHostFsPath(cwd: URI): string {
    const backendWindows = OS.backend.isWindows === true;
    const format = backendWindows ? Path.Format.Windows : Path.Format.Posix;
    const raw = cwd.path.fsPath(format);
    try {
        return normalizeIsolationPath(raw, backendWindows ? 'win32' : 'posix');
    } catch {
        // Browser bundles may omit path.posix/win32; never block Files/Terminal on normalize.
        return raw;
    }
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

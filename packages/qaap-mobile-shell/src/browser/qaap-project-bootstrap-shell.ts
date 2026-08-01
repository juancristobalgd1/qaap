// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface QaapManagedShellInvocation {
    readonly shellPath: string;
    readonly shellArgs: string[];
}

/** Builds a managed shell command whose project cwd survives terminal widget restoration. */
export function buildQaapManagedShellInvocation(
    command: string,
    cwd: string,
    platform: string = typeof navigator === 'undefined' ? '' : navigator.platform,
): QaapManagedShellInvocation {
    if (/^win/i.test(platform)) {
        const quotedCwd = `"${cwd.replace(/"/g, '""')}"`;
        return { shellPath: 'cmd.exe', shellArgs: ['/d', '/s', '/c', `cd /d ${quotedCwd} && ${command}`] };
    }
    const quotedCwd = `'${cwd.replace(/'/g, "'\"'\"'")}'`;
    return { shellPath: '/bin/bash', shellArgs: ['-l', '-c', `cd -- ${quotedCwd} && ${command}`] };
}

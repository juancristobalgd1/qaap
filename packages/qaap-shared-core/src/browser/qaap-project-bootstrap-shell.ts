// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { OS } from '@theia/core/lib/common/os';
import { Path } from '@theia/core/lib/common/path';
import URI from '@theia/core/lib/common/uri';
import { normalizeIsolationPath } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { isQaapStaticBootstrapCommand } from '../common/qaap-project-bootstrap-static';

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

/** Builds a managed shell command for the workspace host's shell and cwd. */
export function buildQaapManagedShellInvocation(
    command: string,
    cwd: string,
    platform: string = defaultManagedShellPlatform(),
): QaapManagedShellInvocation {
    if (/^win/i.test(platform)) {
        const staticCommand = tokenizeWindowsStaticBootstrapCommand(command);
        if (staticCommand) {
            // node-pty joins cmd.exe arguments itself. Passing the complete /c expression as one
            // argument makes cmd.exe lose the nested quotes around `node -e "…"`, which exits
            // before the static server starts. Keep each shell token separate; node-pty then
            // reconstructs a valid command line while preserving the workspace cwd.
            return {
                shellPath: 'cmd.exe',
                shellArgs: ['/d', '/s', '/c', 'cd', '/d', cwd, '&&', ...staticCommand],
            };
        }
        // TerminalService passes cwd to node-pty. Do not repeat it as `cd /d "..."` in the
        // /c command: node-pty joins cmd.exe arguments and /s then misparses the nested quotes,
        // exiting before npm/Next starts (even when the path itself has no spaces).
        return { shellPath: 'cmd.exe', shellArgs: ['/d', '/s', '/c', command] };
    }
    const quotedCwd = `'${cwd.replace(/'/g, "'\"'\"'")}'`;
    return { shellPath: '/bin/bash', shellArgs: ['-l', '-c', `cd -- ${quotedCwd} && ${command}`] };
}

/**
 * Converts the generated static bootstrap into cmd.exe tokens. The payload itself contains no
 * whitespace or cmd metacharacters, so it is safe to pass as the `-e` value without quotes.
 */
function tokenizeWindowsStaticBootstrapCommand(command: string): string[] | undefined {
    if (!isQaapStaticBootstrapCommand(command)) {
        return undefined;
    }
    const trimmed = command.trim();
    const nodeIndex = trimmed.lastIndexOf('node -e "');
    if (nodeIndex < 0 || !trimmed.endsWith('"')) {
        return undefined;
    }
    const payload = trimmed.slice(nodeIndex + 'node -e "'.length, -1);
    if (!payload || /\s|[&|<>]/.test(payload)) {
        return undefined;
    }
    const prefix = trimmed.slice(0, nodeIndex).trim();
    const tokens: string[] = [];
    let cursor = 0;
    const setPattern = /set\s+"([^"]+)"\s*&&\s*/g;
    let match: RegExpExecArray | null;
    while ((match = setPattern.exec(prefix))) {
        if (match.index !== cursor && prefix.slice(cursor, match.index).trim()) {
            return undefined;
        }
        tokens.push('set', match[1], '&&');
        cursor = setPattern.lastIndex;
    }
    if (prefix.slice(cursor).trim()) {
        return undefined;
    }
    return [...tokens, 'node', '-e', payload];
}

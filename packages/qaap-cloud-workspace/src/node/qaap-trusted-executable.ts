// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

/**
 * Root-owned system directories that may provide privileged helpers (`setpriv`, `systemd-run`).
 * The backend PATH is never consulted for those helpers: a tenant-writable PATH entry would let
 * tenant code replace the very binary that drops privileges.
 */
export const QAAP_TRUSTED_SYSTEM_BIN_DIRECTORIES: readonly string[] = [
    '/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin',
];

const STICKY_BIT = 0o1000;
const GROUP_OR_WORLD_WRITABLE = 0o022;

export function currentProcessUid(): number | undefined {
    return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

/** The PATH value of `env`, whatever the key casing (`Path` on Windows). */
export function readEnvPath(env: NodeJS.ProcessEnv): string {
    const key = Object.keys(env).find(candidate => candidate.toLowerCase() === 'path');
    return key ? env[key] ?? '' : '';
}

/**
 * Whether `uid` may execute files from `directory`: every component of its real path must be owned
 * by root or by `uid` and must not be group/world-writable (a sticky ancestor such as `/tmp` is
 * tolerated, since other users cannot rename entries they do not own). POSIX ownership does not
 * exist on Windows or without `process.getuid`, so there the answer is always true.
 */
export function isDirectoryTrustedForUid(directory: string, uid: number | undefined = currentProcessUid()): boolean {
    if (uid === undefined || process.platform === 'win32') {
        return true;
    }
    if (!path.isAbsolute(directory)) {
        return false;
    }
    let current: string;
    try {
        current = fs.realpathSync(directory);
    } catch {
        return false;
    }
    let leaf = true;
    for (;;) {
        let stat: fs.Stats;
        try {
            stat = fs.statSync(current);
        } catch {
            return false;
        }
        if (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== uid)) {
            return false;
        }
        if ((stat.mode & GROUP_OR_WORLD_WRITABLE) !== 0 && (leaf || (stat.mode & STICKY_BIT) === 0)) {
            return false;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return true;
        }
        current = parent;
        leaf = false;
    }
}

/** Whether `file` (after following symlinks) is a regular file `uid` may execute without trusting another user. */
export function isExecutableFileTrustedForUid(file: string, uid: number | undefined = currentProcessUid()): boolean {
    if (uid === undefined || process.platform === 'win32') {
        return isExecutableFile(file);
    }
    if (!path.isAbsolute(file) || !isDirectoryTrustedForUid(path.dirname(file), uid)) {
        return false;
    }
    try {
        const real = fs.realpathSync(file);
        const stat = fs.statSync(real);
        return stat.isFile()
            && (stat.uid === 0 || stat.uid === uid)
            && (stat.mode & GROUP_OR_WORLD_WRITABLE) === 0
            && isDirectoryTrustedForUid(path.dirname(real), uid)
            && isExecutableFile(real);
    } catch {
        return false;
    }
}

function isExecutableFile(candidate: string): boolean {
    try {
        if (!fs.statSync(candidate).isFile()) {
            return false;
        }
        if (process.platform !== 'win32') {
            fs.accessSync(candidate, fs.constants.X_OK);
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * In-process PATH lookup, like `which`/`where` but without spawning anything: detection must never
 * execute a binary that a tenant could have planted in a PATH entry.
 */
export function findExecutableOnPath(
    bin: string,
    pathValue: string,
    platform: NodeJS.Platform = process.platform,
    pathExt: string = process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
): string | undefined {
    if (!bin) {
        return undefined;
    }
    if (path.isAbsolute(bin)) {
        return isExecutableFile(bin) ? bin : undefined;
    }
    if (bin.includes('/') || bin.includes('\\')) {
        return undefined;
    }
    // Windows: PATHEXT variants first (spawnable), then the bare name `where` also reports.
    const extensions = platform === 'win32' && !path.extname(bin)
        ? [...pathExt.split(';').map(extension => extension.trim()).filter(Boolean), '']
        : [''];
    for (const directory of pathValue.split(path.delimiter)) {
        const entry = directory.trim().replace(/^"+|"+$/g, '');
        if (!entry || !path.isAbsolute(entry)) {
            continue;
        }
        for (const extension of extensions) {
            const candidate = path.join(entry, `${bin}${extension}`);
            if (isExecutableFile(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

/** PATH entries that `uid` may execute from (see {@link isDirectoryTrustedForUid}). */
export function filterTrustedPath(pathValue: string, uid: number | undefined = currentProcessUid()): string {
    return pathValue.split(path.delimiter)
        .filter(entry => !!entry && isDirectoryTrustedForUid(entry, uid))
        .join(path.delimiter);
}

/**
 * Absolute path of `bin` resolved only from PATH entries `uid` trusts, or `undefined`. Use before a
 * process running as `uid` (typically the root backend) executes a CLI by name.
 */
export function resolveTrustedExecutable(
    bin: string,
    env: NodeJS.ProcessEnv = process.env,
    uid: number | undefined = currentProcessUid(),
): string | undefined {
    const found = findExecutableOnPath(bin, filterTrustedPath(readEnvPath(env), uid));
    return found && isExecutableFileTrustedForUid(found, uid) ? found : undefined;
}

/** Absolute path of a privileged system helper from {@link QAAP_TRUSTED_SYSTEM_BIN_DIRECTORIES}, or `undefined`. */
export function resolveTrustedSystemExecutable(bin: string, uid: number | undefined = currentProcessUid()): string | undefined {
    if (process.platform === 'win32') {
        return undefined;
    }
    return resolveTrustedExecutable(bin, { PATH: QAAP_TRUSTED_SYSTEM_BIN_DIRECTORIES.join(path.delimiter) }, uid);
}

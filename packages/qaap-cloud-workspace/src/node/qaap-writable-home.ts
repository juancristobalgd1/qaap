// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

/** Directory (next to the CLI prefix) that replaces a read-only HOME for npm and harness state. */
export const QAAP_WRITABLE_HOME_DIRNAME = 'home';

/**
 * True when `directory` exists and cannot be written: a read-only rootfs (`EROFS`) or a HOME
 * owned by someone else. A missing directory is not "read-only": its owner creates it later.
 */
export function isQaapExistingDirectoryReadOnly(directory: string): boolean {
    try {
        if (!fs.statSync(directory).isDirectory()) {
            return false;
        }
    } catch {
        return false;
    }
    try {
        fs.accessSync(directory, fs.constants.W_OK);
        return false;
    } catch {
        return true;
    }
}

/**
 * HOME for processes that must write under it (npm cache and logs, `~/.agents`). In the rootless
 * production backend `/home/theia` is read-only and only its `.qaap` / `.theia` mounts persist, so a
 * read-only HOME is swapped for `<writableRoot>/home`, where `writableRoot` is on such a mount.
 */
export function resolveQaapWritableHome(home: string, writableRoot: string): string {
    return isQaapExistingDirectoryReadOnly(home) ? path.join(writableRoot, QAAP_WRITABLE_HOME_DIRNAME) : home;
}

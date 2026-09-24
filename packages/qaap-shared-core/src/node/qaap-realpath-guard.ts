// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve a path's real location on disk, following symlinks, WITHOUT failing when the leaf does not
 * exist yet (e.g. a file about to be written). It realpath-resolves the deepest existing ancestor
 * and re-appends the not-yet-existing remainder. This is the substrate for symlink-safe ownership
 * checks: a lexical `path.resolve` leaves `/root/alice/link -> /root/bob` looking like it is under
 * alice, but the realpath reveals it lands in bob's tree.
 */
export function resolveRealPathWithinExisting(targetPath: string): string {
    let current = path.resolve(targetPath);
    const tail: string[] = [];
    while (!fs.existsSync(current)) {
        const parent = path.dirname(current);
        if (parent === current) {
            // Reached the filesystem root without finding an existing component.
            return path.join(current, ...tail);
        }
        tail.unshift(path.basename(current));
        current = parent;
    }
    let real: string;
    try {
        real = fs.realpathSync(current);
    } catch {
        real = current;
    }
    return tail.length ? path.join(real, ...tail) : real;
}

/**
 * Symlink-safe containment: true only when `targetPath`'s REAL location (symlinks followed) is at or
 * under `rootPath`'s real location. Use as a defense-in-depth layer on top of the lexical
 * `isPathUnderUserWorkspace` check so a symlink planted inside a user's own workspace cannot redirect
 * an agent/file operation into another tenant's tree or into the server's secret files.
 */
export function isRealPathUnder(targetPath: string, rootPath: string): boolean {
    let realRoot: string;
    try {
        realRoot = fs.realpathSync(path.resolve(rootPath));
    } catch {
        // Root does not exist yet — fall back to its lexical form.
        realRoot = path.resolve(rootPath);
    }
    const realTarget = resolveRealPathWithinExisting(targetPath);
    const relative = path.relative(realRoot, realTarget);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

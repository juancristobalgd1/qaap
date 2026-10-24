// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

/**
 * An OpenCode file-snapshot git lock older than this is treated as left behind by a killed run.
 * Git holds `index.lock` for milliseconds to seconds, so ten minutes cannot belong to a live write.
 */
export const OPENCODE_SNAPSHOT_LOCK_STALE_MS = 10 * 60_000;

/** Directory levels searched below `<XDG_DATA_HOME>/opencode/snapshot` (project hash, then `.git`). */
const SNAPSHOT_SEARCH_DEPTH = 4;

/**
 * Removes `index.lock` files left under OpenCode's snapshot store by a run that was killed while
 * writing a snapshot. The store lives in the tenant's persistent `XDG_DATA_HOME`, so one stale lock
 * makes every later run fail with `Unable to create '.../index.lock': File exists`.
 *
 * Only regular files older than `staleMs` are removed; symbolic links are never followed. Best
 * effort: errors are swallowed and the lock is simply left in place. Returns the removed paths.
 */
export async function removeStaleOpencodeSnapshotLocks(
    dataHome: string | undefined,
    nowMs: number = Date.now(),
    staleMs: number = OPENCODE_SNAPSHOT_LOCK_STALE_MS
): Promise<string[]> {
    if (!dataHome?.trim()) {
        return [];
    }
    const removed: string[] = [];
    const snapshotRoot = path.join(dataHome, 'opencode', 'snapshot');
    const visit = async (directory: string, depth: number): Promise<void> => {
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(directory, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory() && depth < SNAPSHOT_SEARCH_DEPTH) {
                await visit(entryPath, depth + 1);
            } else if (entry.name === 'index.lock' && entry.isFile()) {
                try {
                    const stat = await fs.promises.lstat(entryPath);
                    if (nowMs - stat.mtimeMs >= staleMs) {
                        await fs.promises.rm(entryPath, { force: true });
                        removed.push(entryPath);
                    }
                } catch {
                    // Vanished or not removable: nothing else to do.
                }
            }
        }
    };
    await visit(snapshotRoot, 0);
    return removed;
}

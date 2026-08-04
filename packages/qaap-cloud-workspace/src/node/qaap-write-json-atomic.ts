// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * Atomic JSON persistence for the multi-tenant state stores.
 *
 * Each store serializes ALL tenants' rows into one file on every `persist()`. Writing that file
 * in place means a crash (OOM, SIGKILL, full disk) mid-write leaves it truncated, and on the next
 * boot the parse fails and the whole file — every tenant's conversations / tasks / sessions — is
 * silently discarded. Writing to a sibling temp file and `rename()`-ing over the destination fixes
 * this: `rename` is atomic within a filesystem, so a reader always sees either the intact old file
 * or the fully-written new one, never a half. (See SEC/REL-1; mirrors qaap-tenant-uid-registry.)
 */
export interface WriteJsonAtomicOptions {
    /** JSON.stringify indent. Default 2. */
    readonly space?: number;
    /** File mode for the destination (e.g. 0o600 for token/secret files). */
    readonly mode?: number;
    /** Append a trailing newline (some legacy settings files expect one). */
    readonly trailingNewline?: boolean;
}

let atomicWriteCounter = 0;

/** pid + a per-process counter so two concurrent writes to the same file never collide on the temp name. */
function tempPathFor(filePath: string): string {
    atomicWriteCounter = (atomicWriteCounter + 1) % 1_000_000;
    return `${filePath}.${process.pid}.${atomicWriteCounter}.tmp`;
}

function serialize(value: unknown, options?: WriteJsonAtomicOptions): string {
    const json = JSON.stringify(value, undefined, options?.space ?? 2);
    return options?.trailingNewline ? `${json}\n` : json;
}

export async function writeJsonAtomic(filePath: string, value: unknown, options?: WriteJsonAtomicOptions): Promise<void> {
    const tmp = tempPathFor(filePath);
    try {
        await fsp.writeFile(tmp, serialize(value, options), options?.mode !== undefined
            ? { encoding: 'utf8', mode: options.mode }
            : { encoding: 'utf8' });
        await fsp.rename(tmp, filePath);
        if (options?.mode !== undefined) {
            // rename preserves the temp mode, but umask may have loosened it on create — re-tighten.
            await fsp.chmod(filePath, options.mode).catch(() => undefined);
        }
    } catch (error) {
        await fsp.rm(tmp, { force: true }).catch(() => undefined);
        throw error;
    }
}

/**
 * Best-effort sweep of orphaned temp files left by previous (now-dead) processes.
 *
 * `writeJsonAtomic` writes to `{filePath}.{pid}.{counter}.tmp` then `rename()`s over the
 * destination. If the process is killed (SIGKILL, OOM, crash) between `writeFile` and `rename`,
 * the temp file is never cleaned up — the `catch` block never runs. Over many backend restarts
 * these orphans accumulate unboundedly (observed: 90 GB across 1600+ files in ~/.qaap).
 *
 * This function scans the destination's directory for temp files belonging to *other* PIDs and
 * deletes them. Temp files from the current PID are left alone (a concurrent write may be in
 * flight). Safe to call on startup before the first read.
 */
export async function sweepOrphanedTempFiles(filePath: string): Promise<void> {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const prefix = `${base}.`;
    const suffix = '.tmp';
    let entries: string[];
    try {
        entries = await fsp.readdir(dir);
    } catch {
        return; // directory doesn't exist yet — nothing to sweep
    }
    const myPid = `${process.pid}`;
    await Promise.all(entries.map(async entry => {
        if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) {
            return;
        }
        // entry pattern: {base}.{pid}.{counter}.tmp
        const middle = entry.slice(prefix.length, -suffix.length);
        const pid = middle.split('.')[0];
        if (pid === myPid) {
            return; // could be an in-flight write from this process
        }
        try {
            await fsp.unlink(path.join(dir, entry));
        } catch {
            // best-effort — race with another sweeper or a concurrent writer
        }
    }));
}

/**
 * Synchronous variant of {@link sweepOrphanedTempFiles} for use in `@postConstruct` init paths
 * that run before the first async tick.
 */
export function sweepOrphanedTempFilesSync(filePath: string): void {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath);
    const prefix = `${base}.`;
    const suffix = '.tmp';
    let entries: string[];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return;
    }
    const myPid = `${process.pid}`;
    for (const entry of entries) {
        if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) {
            continue;
        }
        const middle = entry.slice(prefix.length, -suffix.length);
        const pid = middle.split('.')[0];
        if (pid === myPid) {
            continue;
        }
        try {
            fs.unlinkSync(path.join(dir, entry));
        } catch {
            // best-effort
        }
    }
}

export function writeJsonAtomicSync(filePath: string, value: unknown, options?: WriteJsonAtomicOptions): void {
    const tmp = tempPathFor(filePath);
    try {
        fs.writeFileSync(tmp, serialize(value, options), options?.mode !== undefined
            ? { encoding: 'utf8', mode: options.mode }
            : { encoding: 'utf8' });
        fs.renameSync(tmp, filePath);
        if (options?.mode !== undefined) {
            try {
                fs.chmodSync(filePath, options.mode);
            } catch {
                /* best-effort tighten; the write above already set the mode on create */
            }
        }
    } catch (error) {
        try {
            fs.rmSync(tmp, { force: true });
        } catch {
            /* temp may not exist */
        }
        throw error;
    }
}

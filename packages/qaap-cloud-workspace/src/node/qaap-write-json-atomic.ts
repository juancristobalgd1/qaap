// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as crypto from 'crypto';
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

/** Exclusive-create attempts before a temp-name collision is reported to the caller. */
const MAX_TEMP_NAME_ATTEMPTS = 3;

/** Grace period so a temp file written just before this process started is not mistaken for a live one. */
const PROCESS_START_MARGIN_MS = 1000;

let atomicWriteCounter = 0;

/**
 * pid + a per-process counter + a random suffix. The counter restarts at 0 on every boot, and a
 * container restarts with the same pid (often 7), so the random part keeps a leftover temp from an
 * earlier boot from ever colliding with a new write.
 */
function tempPathFor(filePath: string): string {
    atomicWriteCounter = (atomicWriteCounter + 1) % 1_000_000;
    return `${filePath}.${process.pid}.${atomicWriteCounter}.${crypto.randomBytes(4).toString('hex')}.tmp`;
}

/** Opens a fresh temp file exclusively, choosing another name when the chosen one already exists. */
async function openTempFile(filePath: string, mode: number | undefined): Promise<{ readonly tmp: string; readonly handle: fsp.FileHandle }> {
    for (let attempt = 1; ; attempt++) {
        const tmp = tempPathFor(filePath);
        try {
            return { tmp, handle: await fsp.open(tmp, 'wx', mode) };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= MAX_TEMP_NAME_ATTEMPTS) {
                throw error;
            }
        }
    }
}

/** Synchronous counterpart of {@link openTempFile}. */
function openTempFileSync(filePath: string, mode: number | undefined): { readonly tmp: string; readonly fd: number } {
    for (let attempt = 1; ; attempt++) {
        const tmp = tempPathFor(filePath);
        try {
            return { tmp, fd: fs.openSync(tmp, 'wx', mode) };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt >= MAX_TEMP_NAME_ATTEMPTS) {
                throw error;
            }
        }
    }
}

/**
 * Parses the pid out of a temp-file middle segment: `{pid}.{counter}` (format before the random
 * suffix) or `{pid}.{counter}.{hex}`. Returns undefined for anything else.
 */
function tempFilePid(middle: string): number | undefined {
    const match = /^([1-9]\d*)\.\d+(?:\.[0-9a-f]{8})?$/.exec(middle);
    if (!match) {
        return undefined;
    }
    const pid = Number(match[1]);
    return Number.isSafeInteger(pid) && pid <= 0x7fffffff ? pid : undefined;
}

/** Wall-clock time at which this process started. */
function processStartedAtMs(): number {
    return Date.now() - process.uptime() * 1000;
}

function serialize(value: unknown, options?: WriteJsonAtomicOptions): string {
    const json = JSON.stringify(value, undefined, options?.space ?? 2);
    return options?.trailingNewline ? `${json}\n` : json;
}

export async function writeJsonAtomic(filePath: string, value: unknown, options?: WriteJsonAtomicOptions): Promise<void> {
    let tmp = '';
    let created = false;
    try {
        const content = serialize(value, options);
        const opened = await openTempFile(filePath, options?.mode);
        tmp = opened.tmp;
        const handle = opened.handle;
        created = true;
        try {
            await handle.writeFile(content, 'utf8');
            if (options?.mode !== undefined) {
                await handle.chmod(options.mode);
            }
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fsp.rename(tmp, filePath);
        // Linux requires syncing the directory to persist the replacement name as well.
        // Windows does not support opening directories this way.
        if (process.platform !== 'win32') {
            const directory = await fsp.open(path.dirname(filePath), 'r');
            try {
                await directory.sync();
            } finally {
                await directory.close();
            }
        }
    } catch (error) {
        if (created) {
            await fsp.rm(tmp, { force: true }).catch(() => undefined);
        }
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
 * Only files with the exact generated name and a confirmed dead PID are removed.
 * Live processes and permission/inspection failures are left alone.
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
    await Promise.all(entries.map(async entry => {
        if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) {
            return;
        }
        // entry pattern: {base}.{pid}.{counter}[.{hex}].tmp
        const middle = entry.slice(prefix.length, -suffix.length);
        const pid = tempFilePid(middle);
        if (pid === undefined) {
            return;
        }
        try {
            const { mtimeMs } = await fsp.stat(path.join(dir, entry));
            if (!isConfirmedOrphan(pid, mtimeMs)) {
                return;
            }
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
    for (const entry of entries) {
        if (!entry.startsWith(prefix) || !entry.endsWith(suffix)) {
            continue;
        }
        const middle = entry.slice(prefix.length, -suffix.length);
        const pid = tempFilePid(middle);
        if (pid === undefined) {
            continue;
        }
        try {
            const { mtimeMs } = fs.statSync(path.join(dir, entry));
            if (!isConfirmedOrphan(pid, mtimeMs)) {
                continue;
            }
            fs.unlinkSync(path.join(dir, entry));
        } catch {
            // best-effort
        }
    }
}

/**
 * Decides whether a temp file belongs to a dead writer. A temp file of a live other pid is kept.
 * A temp file carrying this process's own pid is kept too, unless it predates this process's start:
 * then an earlier boot with the same pid (a restarted container) wrote it and it can never be renamed.
 * Signal zero checks existence without terminating or signalling the writer.
 */
function isConfirmedOrphan(pid: number, mtimeMs: number): boolean {
    if (pid === process.pid) {
        return mtimeMs < processStartedAtMs() - PROCESS_START_MARGIN_MS;
    }
    try {
        process.kill(pid, 0);
        return false;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
}

export function writeJsonAtomicSync(filePath: string, value: unknown, options?: WriteJsonAtomicOptions): void {
    let tmp = '';
    let created = false;
    try {
        const content = serialize(value, options);
        const opened = openTempFileSync(filePath, options?.mode);
        tmp = opened.tmp;
        const fd = opened.fd;
        created = true;
        try {
            fs.writeFileSync(fd, content, 'utf8');
            if (options?.mode !== undefined) {
                fs.fchmodSync(fd, options.mode);
            }
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        fs.renameSync(tmp, filePath);
        if (process.platform !== 'win32') {
            const directory = fs.openSync(path.dirname(filePath), 'r');
            try {
                fs.fsyncSync(directory);
            } finally {
                fs.closeSync(directory);
            }
        }
    } catch (error) {
        try {
            if (created) {
                fs.rmSync(tmp, { force: true });
            }
        } catch {
            /* temp may not exist */
        }
        throw error;
    }
}

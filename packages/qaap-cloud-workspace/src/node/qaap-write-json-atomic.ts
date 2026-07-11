// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as fsp from 'fs/promises';

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

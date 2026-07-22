// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const DEFAULT_TTL_MS = 30_000;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 5 * 60_000;
const DEFAULT_TIMEOUT_MS = 5_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_MS = 20;
const OWNER_ID = `${process.pid}:${randomUUID()}`;
const HELD_LOCKS = new AsyncLocalStorage<ReadonlySet<string>>();

interface PersistedManagementLock {
    readonly version: 1;
    readonly ownerId: string;
    readonly lockId: string;
    readonly expiresAt: number;
}

interface AcquiredManagementLock {
    readonly lock: PersistedManagementLock;
    readonly contenderPath: string;
}

export interface QaapJobLoopManagementLockOptions {
    readonly ttlMs?: number;
    readonly timeoutMs?: number;
    readonly retryMs?: number;
}

export class QaapJobLoopManagementLockTimeoutError extends Error {
    constructor() {
        super('Timed out waiting for the shared job loop management lock.');
        this.name = 'QaapJobLoopManagementLockTimeoutError';
    }
}

/** Serializes one JSON-index transaction across backend replicas on a shared POSIX volume. */
export async function withQaapJobLoopManagementLock<T>(
    lockPath: string,
    operation: () => Promise<T>,
    options: QaapJobLoopManagementLockOptions = {},
): Promise<T> {
    const normalizedPath = path.resolve(lockPath);
    const heldLocks = HELD_LOCKS.getStore();
    if (heldLocks?.has(normalizedPath)) {
        return operation();
    }
    const acquired = await acquire(normalizedPath, options);
    try {
        const nestedLocks = new Set(heldLocks);
        nestedLocks.add(normalizedPath);
        return await HELD_LOCKS.run(nestedLocks, operation);
    } finally {
        try {
            await release(normalizedPath, acquired.lock);
        } finally {
            await removeContender(acquired.contenderPath);
        }
    }
}

/** One coordinator is injected into endpoints that need cross-index referential transactions. */
@injectable()
export class QaapJobLoopManagementLock {
    runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        return withQaapJobLoopManagementLock(defaultQaapJobLoopManagementLockPath(), operation);
    }
}

async function acquire(lockPath: string, options: QaapJobLoopManagementLockOptions): Promise<AcquiredManagementLock> {
    const ttlMs = options.ttlMs ?? managementLockTtlMs();
    const timeoutMs = options.timeoutMs ?? managementLockTimeoutMs();
    const retryMs = Math.max(1, options.retryMs ?? DEFAULT_RETRY_MS);
    const deadline = Date.now() + timeoutMs;
    await fsp.mkdir(path.dirname(lockPath), { recursive: true, mode: DIRECTORY_MODE });
    await fsp.chmod(path.dirname(lockPath), DIRECTORY_MODE).catch(() => undefined);
    const contenderPath = await createContender(lockPath);
    try {
        while (true) {
            await touchContender(contenderPath);
            const lock: PersistedManagementLock = {
                version: 1,
                ownerId: OWNER_ID,
                lockId: randomUUID(),
                expiresAt: Date.now() + ttlMs,
            };
            try {
                await writeExclusive(lockPath, lock);
                return { lock, contenderPath };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                    throw error;
                }
            }
            if (await isElectedReclaimer(lockPath, contenderPath, ttlMs) && await reclaimExpired(lockPath, ttlMs)) {
                continue;
            }
            if (Date.now() >= deadline) {
                throw new QaapJobLoopManagementLockTimeoutError();
            }
            await delay(Math.min(retryMs, Math.max(1, deadline - Date.now())));
        }
    } catch (error) {
        await removeContender(contenderPath);
        throw error;
    }
}

async function createContender(lockPath: string): Promise<string> {
    const directory = `${lockPath}.contenders`;
    await fsp.mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
    await fsp.chmod(directory, DIRECTORY_MODE).catch(() => undefined);
    const contenderPath = path.join(directory, `${randomUUID()}.contender`);
    const handle = await fsp.open(contenderPath, 'wx', FILE_MODE);
    try {
        await handle.writeFile(OWNER_ID, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
    return contenderPath;
}

async function touchContender(contenderPath: string): Promise<void> {
    const now = new Date();
    await fsp.utimes(contenderPath, now, now);
}

/**
 * Only one live contender may reclaim an expired lock. Unique contender paths
 * make stale cleanup safe because a deleted path is never reused by a new owner.
 */
async function isElectedReclaimer(lockPath: string, contenderPath: string, ttlMs: number): Promise<boolean> {
    const directory = `${lockPath}.contenders`;
    const ownName = path.basename(contenderPath);
    const names = await fsp.readdir(directory);
    const live: string[] = [];
    const now = Date.now();
    for (const name of names) {
        if (!name.endsWith('.contender')) {
            continue;
        }
        const candidatePath = path.join(directory, name);
        try {
            const stat = await fsp.stat(candidatePath);
            if (stat.mtimeMs + ttlMs <= now) {
                await fsp.unlink(candidatePath).catch(() => undefined);
            } else {
                live.push(name);
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
    }
    live.sort();
    return live[0] === ownName;
}

async function removeContender(contenderPath: string): Promise<void> {
    await fsp.unlink(contenderPath).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('[qaap-job-loop-management] failed to remove lock contender:', error);
        }
    });
}

async function writeExclusive(lockPath: string, lock: PersistedManagementLock): Promise<void> {
    const handle = await fsp.open(lockPath, 'wx', FILE_MODE);
    try {
        await handle.writeFile(JSON.stringify(lock), 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function reclaimExpired(lockPath: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const current = await readLock(lockPath);
    if (current && current.expiresAt > now) {
        return false;
    }
    if (!current) {
        try {
            const stat = await fsp.stat(lockPath);
            if (stat.mtimeMs + ttlMs > now) {
                return false;
            }
        } catch (error) {
            return (error as NodeJS.ErrnoException).code === 'ENOENT';
        }
    }
    const reclaimedPath = `${lockPath}.${OWNER_ID.replace(/:/g, '-')}.${randomUUID()}.expired`;
    try {
        await fsp.rename(lockPath, reclaimedPath);
        await fsp.rm(reclaimedPath, { force: true }).catch(() => undefined);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return true;
        }
        return false;
    }
}

async function release(lockPath: string, expected: PersistedManagementLock): Promise<void> {
    if (expected.expiresAt <= Date.now()) {
        return;
    }
    try {
        const current = await readLock(lockPath);
        if (current?.ownerId === expected.ownerId && current.lockId === expected.lockId) {
            await fsp.unlink(lockPath);
        }
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.warn('[qaap-job-loop-management] failed to release shared state lock:', error);
        }
    }
}

async function readLock(lockPath: string): Promise<PersistedManagementLock | undefined> {
    try {
        const parsed = JSON.parse(await fsp.readFile(lockPath, 'utf8')) as Partial<PersistedManagementLock>;
        return parsed.version === 1 && typeof parsed.ownerId === 'string' && typeof parsed.lockId === 'string'
            && Number.isSafeInteger(parsed.expiresAt) ? parsed as PersistedManagementLock : undefined;
    } catch {
        return undefined;
    }
}

function managementLockTtlMs(): number {
    return boundedInteger(process.env.QAAP_JOB_LOOP_MANAGEMENT_LOCK_TTL_MS, DEFAULT_TTL_MS, MIN_TTL_MS, MAX_TTL_MS);
}

function managementLockTimeoutMs(): number {
    return boundedInteger(process.env.QAAP_JOB_LOOP_MANAGEMENT_LOCK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function defaultQaapJobLoopManagementLockPath(): string {
    const directory = process.env.QAAP_JOB_LOOP_MANAGEMENT_LOCK_DIR?.trim()
        || process.env.QAAP_JOB_LOOP_TRIGGER_STATE_DIR?.trim()
        || path.join(os.homedir(), '.qaap', 'job-loop-triggers');
    return path.join(directory, 'management.lock');
}

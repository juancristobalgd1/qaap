// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const DEFAULT_LEASE_TTL_MS = 10 * 60_000;
const MIN_LEASE_TTL_MS = 2 * 60_000;
const MAX_LEASE_TTL_MS = 24 * 60 * 60_000;
const CLEANUP_INTERVAL_MS = 60_000;

interface PersistedLease {
    readonly version: 1;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly expiresAt: number;
}

/** A lease acquired for one trigger invocation slot. */
export interface QaapJobLoopTriggerLease {
    readonly expiresAt: number;
    release(): void;
}

/**
 * A small filesystem-backed distributed lease for trigger slots.
 *
 * The lock file is deliberately separate from trigger state: multiple backend replicas can
 * coordinate through a shared lease directory without making the state store a lock protocol.
 */
@injectable()
export class QaapJobLoopTriggerLeaseManager {

    protected readonly ownerId = randomUUID();
    protected readonly ttlMs = leaseTtlMs();
    protected lastCleanupAt = 0;

    acquire(triggerId: string, slot: string): QaapJobLoopTriggerLease | undefined {
        const leasePath = this.leasePath(triggerId, slot);
        const leaseId = randomUUID();
        try {
            fs.mkdirSync(this.directory(), { recursive: true, mode: DIRECTORY_MODE });
            fs.chmodSync(this.directory(), DIRECTORY_MODE);
            this.cleanupExpired();
            for (let attempt = 0; attempt < 3; attempt++) {
                const lease: PersistedLease = {
                    version: 1,
                    ownerId: this.ownerId,
                    leaseId,
                    expiresAt: Date.now() + this.ttlMs,
                };
                try {
                    this.writeExclusive(leasePath, lease);
                    return { expiresAt: lease.expiresAt, release: () => this.release(leasePath, lease) };
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !this.reclaimExpired(leasePath)) {
                        return undefined;
                    }
                }
            }
        } catch (error) {
            console.warn('[qaap-job-loop-triggers] failed to acquire trigger lease:', error);
        }
        return undefined;
    }

    /** The configured directory is shared by replicas; the default stays beside trigger state. */
    protected directory(): string {
        const stateDirectory = process.env.QAAP_JOB_LOOP_TRIGGER_STATE_DIR?.trim()
            || path.join(os.homedir(), '.qaap', 'job-loop-triggers');
        return process.env.QAAP_JOB_LOOP_TRIGGER_LEASE_DIR?.trim() || path.join(stateDirectory, 'leases');
    }

    protected leasePath(triggerId: string, slot: string): string {
        const digest = createHash('sha256').update(`${triggerId}\u0000${slot}`).digest('hex');
        return path.join(this.directory(), `${digest}.lease`);
    }

    protected writeExclusive(leasePath: string, lease: PersistedLease): void {
        const descriptor = fs.openSync(leasePath, 'wx', FILE_MODE);
        try {
            fs.writeFileSync(descriptor, JSON.stringify(lease), 'utf8');
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
    }

    /**
     * Renaming an expired path gives exactly one contender the chance to remove it; contenders
     * subsequently still use exclusive creation, so a recovered lease cannot be double-owned.
     */
    protected reclaimExpired(leasePath: string): boolean {
        const existing = this.readLease(leasePath);
        if (existing && existing.expiresAt > Date.now()) { return false; }
        if (!existing) {
            try {
                // An exclusive creator may still be writing its JSON. Treat a malformed recent
                // file as owned until its full TTL instead of stealing a partially-written lease.
                if (fs.statSync(leasePath).mtimeMs + this.ttlMs > Date.now()) { return false; }
            } catch (error) {
                return (error as NodeJS.ErrnoException).code === 'ENOENT';
            }
        }
        const reclaimedPath = `${leasePath}.${this.ownerId}.${randomUUID()}.expired`;
        try {
            fs.renameSync(leasePath, reclaimedPath);
            try { fs.unlinkSync(reclaimedPath); } catch { /* A later cleanup is harmless. */ }
            return true;
        } catch (error) {
            return (error as NodeJS.ErrnoException).code === 'ENOENT';
        }
    }

    /** Expired slots have unique names, so opportunistic cleanup bounds the shared directory. */
    protected cleanupExpired(): void {
        const now = Date.now();
        if (now - this.lastCleanupAt < CLEANUP_INTERVAL_MS) { return; }
        this.lastCleanupAt = now;
        let entries: string[];
        try {
            entries = fs.readdirSync(this.directory()).filter(entry => entry.endsWith('.lease'));
        } catch {
            return;
        }
        for (const entry of entries) {
            const leasePath = path.join(this.directory(), entry);
            const lease = this.readLease(leasePath);
            if (!lease || lease.expiresAt <= now) {
                this.reclaimExpired(leasePath);
            }
        }
    }

    /** Only the lease record's original owner and token may remove it. */
    protected release(leasePath: string, expected: PersistedLease): void {
        if (expected.expiresAt <= Date.now()) {
            // Another replica may already have reclaimed and replaced the expired path.
            return;
        }
        try {
            const current = this.readLease(leasePath);
            if (current?.ownerId === expected.ownerId && current.leaseId === expected.leaseId) {
                fs.unlinkSync(leasePath);
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('[qaap-job-loop-triggers] failed to release trigger lease:', error);
            }
        }
    }

    protected readLease(leasePath: string): PersistedLease | undefined {
        try {
            const parsed = JSON.parse(fs.readFileSync(leasePath, 'utf8')) as Partial<PersistedLease>;
            return parsed.version === 1 && typeof parsed.ownerId === 'string' && typeof parsed.leaseId === 'string'
                && typeof parsed.expiresAt === 'number' ? parsed as PersistedLease : undefined;
        } catch {
            return undefined;
        }
    }
}

function leaseTtlMs(): number {
    const configured = Number(process.env.QAAP_JOB_LOOP_TRIGGER_LEASE_TTL_MS);
    if (!Number.isSafeInteger(configured)) { return DEFAULT_LEASE_TTL_MS; }
    return Math.max(MIN_LEASE_TTL_MS, Math.min(MAX_LEASE_TTL_MS, configured));
}

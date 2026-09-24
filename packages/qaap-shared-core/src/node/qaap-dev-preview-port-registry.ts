// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    isQaapProcessPreviewIdentity,
    type QaapResolvedPreviewIdentity,
} from '../common/qaap-preview-identity';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type QaapDevPreviewRegistration = QaapResolvedPreviewIdentity & {
    readonly ownerLogin: string;
    readonly root: string;
    readonly port: number;
    readonly osProcessId?: number;
};

export type QaapDevPreviewRecord = QaapDevPreviewRegistration & {
    readonly claimedAt: number;
    readonly touchedAt: number;
    /** Per-preview capability used only on an isolated preview hostname. Never sent to other users. */
    readonly accessToken: string;
};

export interface QaapDevPreviewRegisterOptions {
    /**
     * Allows replacing expired, conflicting records. Callers must first verify that every port
     * returned by {@link QaapDevPreviewPortRegistry.expiredRegistrationConflicts} is no longer accepting connections.
     */
    readonly replaceExpired?: boolean;
}

interface PersistedQaapDevPreviewRegistry {
    readonly version: 1;
    readonly previews: readonly QaapDevPreviewRecord[];
}

const PERSIST_DEBOUNCE_MS = 100;
const STORE_FILE_MODE = 0o600;
const STORE_DIR_MODE = 0o700;

function resolvePreviewRegistryPath(): string {
    const configured = process.env.QAAP_PREVIEW_REGISTRY_PATH?.trim();
    if (configured) {
        return configured;
    }
    return process.env.NODE_ENV === 'production'
        ? '/workspace/.qaap/dev-previews.json'
        : path.join(os.homedir(), '.qaap', 'dev-previews.json');
}

/**
 * Maps a dev-preview port to the login that claimed it (having proven workspace ownership), so the
 * `/qaap-dev/:port` proxy can deny a signed-in user reaching another tenant's dev server on the
 * shared host. Claims are the only authoritative owner signal for frontend-started dev servers,
 * which never reach the backend restart path. A claim is refreshed each time the owner re-opens the
 * preview and expires after {@link CLAIM_TTL_MS} so a port later reused by a different user is not
 * blocked by a stale legacy entry. Process-scoped records are durable and the endpoint reaps them
 * only after confirming that the registered listener has stopped.
 */
@injectable()
export class QaapDevPreviewPortRegistry {

    protected static readonly CLAIM_TTL_MS = 30 * 60_000;

    protected readonly claims = new Map<number, { readonly ownerLogin: string; at: number }>();
    protected readonly previews = new Map<string, QaapDevPreviewRecord>();
    protected readonly previewIdByPort = new Map<number, string>();
    protected readonly storePath = resolvePreviewRegistryPath();
    protected persistTimer: NodeJS.Timeout | undefined;
    protected persistenceEnabled = false;

    @postConstruct()
    protected init(): void {
        this.loadFromDisk();
        this.persistenceEnabled = true;
    }

    /**
     * Registers immutable execution coordinates and reserves the port for that preview. Neither a
     * second execution nor a second tenant may overwrite a live mapping.
     */
    register(
        registration: QaapDevPreviewRegistration,
        options: QaapDevPreviewRegisterOptions = {},
    ): QaapDevPreviewRecord | undefined {
        const now = Date.now();
        const livePortOwner = this.ownerOf(registration.port);
        if (livePortOwner !== undefined && livePortOwner !== registration.ownerLogin) {
            return undefined;
        }
        const stalePortOwner = this.staleOwnerOf(registration.port);
        if (stalePortOwner !== undefined && stalePortOwner !== registration.ownerLogin && !options.replaceExpired) {
            return undefined;
        }

        const existing = this.previews.get(registration.previewId);
        if (existing) {
            const expired = this.isRecordExpired(existing);
            if (!this.sameRegistration(existing, registration)) {
                if (!expired || !options.replaceExpired) {
                    return undefined;
                }
                this.removeExpiredRecord(existing);
            } else {
                const refreshed = {
                    ...existing,
                    osProcessId: registration.osProcessId ?? existing.osProcessId,
                    claimedAt: expired ? now : existing.claimedAt,
                    touchedAt: now,
                    accessToken: expired ? randomBytes(24).toString('base64url') : existing.accessToken,
                };
                this.previews.set(registration.previewId, refreshed);
                this.claims.set(registration.port, { ownerLogin: registration.ownerLogin, at: now });
                this.schedulePersist();
                return refreshed;
            }
        }

        const occupiedBy = this.previewIdByPort.get(registration.port);
        if (occupiedBy && occupiedBy !== registration.previewId) {
            const occupied = this.previews.get(occupiedBy);
            if (occupied) {
                if (!this.isRecordExpired(occupied) || !options.replaceExpired) {
                    return undefined;
                }
                this.removeExpiredRecord(occupied);
            } else {
                this.previewIdByPort.delete(registration.port);
            }
        }

        if (options.replaceExpired && this.staleOwnerOf(registration.port) !== undefined) {
            this.claims.delete(registration.port);
        }

        const record: QaapDevPreviewRecord = {
            ...registration,
            claimedAt: now,
            touchedAt: now,
            accessToken: randomBytes(24).toString('base64url'),
        };
        this.previews.set(registration.previewId, record);
        this.previewIdByPort.set(registration.port, registration.previewId);
        this.claims.set(registration.port, { ownerLogin: registration.ownerLogin, at: now });
        this.schedulePersist();
        return record;
    }

    /**
     * Returns expired records that a changed registration would replace by preview identity or
     * port. Live conflicts are intentionally omitted: they can never be replaced.
     */
    expiredRegistrationConflicts(registration: QaapDevPreviewRegistration): QaapDevPreviewRecord[] {
        const conflicts = new Map<string, QaapDevPreviewRecord>();
        const existing = this.previews.get(registration.previewId);
        if (existing && this.isRecordExpired(existing) && !this.sameRegistration(existing, registration)) {
            conflicts.set(existing.previewId, existing);
        }
        const occupiedBy = this.previewIdByPort.get(registration.port);
        if (occupiedBy && occupiedBy !== registration.previewId) {
            const occupied = this.previews.get(occupiedBy);
            if (occupied && this.isRecordExpired(occupied)) {
                conflicts.set(occupied.previewId, occupied);
            }
        }
        return [...conflicts.values()];
    }

    protected removeExpiredRecord(record: QaapDevPreviewRecord): void {
        if (this.previews.get(record.previewId) !== record || !this.isRecordExpired(record)) {
            return;
        }
        this.previews.delete(record.previewId);
        if (this.previewIdByPort.get(record.port) === record.previewId) {
            this.previewIdByPort.delete(record.port);
        }
        if (this.staleOwnerOf(record.port) === record.ownerLogin) {
            this.claims.delete(record.port);
        }
        this.schedulePersist();
    }

    get(previewId: string): QaapDevPreviewRecord | undefined {
        const record = this.previews.get(previewId);
        return record && !this.isRecordExpired(record) ? record : undefined;
    }

    getForOwner(previewId: string, ownerLogin: string): QaapDevPreviewRecord | undefined {
        const record = this.get(previewId);
        return record?.ownerLogin === ownerLogin ? record : undefined;
    }

    touchPreview(previewId: string, ownerLogin: string): void {
        const record = this.getForOwner(previewId, ownerLogin);
        if (!record) {
            return;
        }
        const now = Date.now();
        this.previews.set(previewId, { ...record, touchedAt: now });
        this.claims.set(record.port, { ownerLogin, at: now });
        this.schedulePersist();
    }

    attachProcess(previewId: string, ownerLogin: string, osProcessId: number | undefined): boolean {
        const record = this.getForOwner(previewId, ownerLogin);
        if (!record) {
            return false;
        }
        this.previews.set(previewId, { ...record, osProcessId, touchedAt: Date.now() });
        this.schedulePersist();
        return true;
    }

    /**
     * Claims the port for `ownerLogin`, or refreshes the claim when the login already owns it.
     * Returns false — and leaves the registry untouched — when a DIFFERENT login holds a live
     * claim: an unconditional overwrite would let any signed-in tenant steal another tenant's
     * running preview (which would hollow out the H1 fail-closed proxy gate).
     */
    claim(port: number, ownerLogin: string): boolean {
        const current = this.ownerOf(port);
        if (current !== undefined && current !== ownerLogin) {
            return false;
        }
        this.claims.set(port, { ownerLogin, at: Date.now() });
        this.schedulePersist();
        return true;
    }

    /** Refreshes the claim TTL while the owner is actively using the preview. No-op for others. */
    touch(port: number, ownerLogin: string): void {
        if (this.ownerOf(port) === ownerLogin) {
            this.claims.set(port, { ownerLogin, at: Date.now() });
            this.schedulePersist();
        }
    }

    release(port: number): void {
        const previewId = this.previewIdByPort.get(port);
        if (previewId) {
            this.previews.delete(previewId);
            this.previewIdByPort.delete(port);
        }
        this.claims.delete(port);
        this.schedulePersist();
    }

    releasePreview(previewId: string, ownerLogin: string): boolean {
        const record = this.getForOwner(previewId, ownerLogin);
        if (!record) {
            return false;
        }
        this.previews.delete(previewId);
        if (this.previewIdByPort.get(record.port) === previewId) {
            this.previewIdByPort.delete(record.port);
        }
        if (this.claims.get(record.port)?.ownerLogin === ownerLogin) {
            this.claims.delete(record.port);
        }
        this.schedulePersist();
        return true;
    }

    /**
     * Moves a live claim to a different port when the reserved listener never appeared (or died)
     * and the owner's process bound elsewhere. Refuses to steal another preview's live port.
     */
    rebindPort(previewId: string, ownerLogin: string, nextPort: number): QaapDevPreviewRecord | undefined {
        const existing = this.getForOwner(previewId, ownerLogin);
        if (!existing || !Number.isInteger(nextPort) || nextPort <= 0 || nextPort > 65535) {
            return undefined;
        }
        if (existing.port === nextPort) {
            const touched = { ...existing, touchedAt: Date.now() };
            this.previews.set(previewId, touched);
            this.claims.set(nextPort, { ownerLogin, at: Date.now() });
            this.schedulePersist();
            return touched;
        }
        const occupiedBy = this.previewIdByPort.get(nextPort);
        if (occupiedBy !== undefined && occupiedBy !== previewId) {
            return undefined;
        }
        const livePortOwner = this.ownerOf(nextPort);
        if (livePortOwner !== undefined && livePortOwner !== ownerLogin) {
            return undefined;
        }
        if (this.previewIdByPort.get(existing.port) === previewId) {
            this.previewIdByPort.delete(existing.port);
        }
        if (this.claims.get(existing.port)?.ownerLogin === ownerLogin) {
            this.claims.delete(existing.port);
        }
        const now = Date.now();
        const rebound: QaapDevPreviewRecord = {
            ...existing,
            port: nextPort,
            touchedAt: now,
        };
        this.previews.set(previewId, rebound);
        this.previewIdByPort.set(nextPort, previewId);
        this.claims.set(nextPort, { ownerLogin, at: now });
        this.schedulePersist();
        return rebound;
    }

    getByPort(port: number): QaapDevPreviewRecord | undefined {
        const previewId = this.previewIdByPort.get(port);
        return previewId ? this.get(previewId) : undefined;
    }

    records(): readonly QaapDevPreviewRecord[] {
        return [...this.previews.values()].filter(record => !this.isRecordExpired(record));
    }

    /** Live preview claims owned by `ownerLogin` whose workspace root is `root` or a child of it. */
    listForOwnerUnderRoot(ownerLogin: string, root: string): QaapDevPreviewRecord[] {
        const resolvedRoot = path.resolve(root);
        const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
        return this.records().filter(record => {
            if (record.ownerLogin !== ownerLogin) {
                return false;
            }
            const recordRoot = path.resolve(record.root);
            return recordRoot === resolvedRoot || recordRoot.startsWith(prefix);
        });
    }

    /** The login that owns this port, or undefined if unclaimed or the claim has expired. */
    ownerOf(port: number): string | undefined {
        const entry = this.claims.get(port);
        if (!entry) {
            return undefined;
        }
        if (Date.now() - entry.at > QaapDevPreviewPortRegistry.CLAIM_TTL_MS) {
            // Expiry revokes PROXYING but keeps the stale record: reassignment to a different
            // tenant additionally requires the port to be free (see the claim endpoint), so an
            // idle-but-still-running server cannot be silently taken over after the TTL.
            return undefined;
        }
        return entry.ownerLogin;
    }

    /** The login of an EXPIRED claim, or undefined when unclaimed or the claim is still live. */
    staleOwnerOf(port: number): string | undefined {
        const entry = this.claims.get(port);
        if (!entry || Date.now() - entry.at <= QaapDevPreviewPortRegistry.CLAIM_TTL_MS) {
            return undefined;
        }
        return entry.ownerLogin;
    }

    protected isRecordExpired(record: QaapDevPreviewRecord): boolean {
        // Process-scoped registrations are durable. They are reaped only after the endpoint has
        // confirmed that their listener is gone, so reloads/backend restarts cannot invalidate a
        // still-running preview merely because no browser touched it for thirty minutes.
        if (isQaapProcessPreviewIdentity(record)) {
            return false;
        }
        return Date.now() - record.touchedAt > QaapDevPreviewPortRegistry.CLAIM_TTL_MS;
    }

    protected sameRegistration(left: QaapDevPreviewRecord, right: QaapDevPreviewRegistration): boolean {
        return left.previewId === right.previewId
            && left.ownerLogin === right.ownerLogin
            && left.root === right.root
            && left.port === right.port;
    }

    protected loadFromDisk(): void {
        try {
            const parsed = JSON.parse(fs.readFileSync(this.storePath, 'utf8')) as Partial<PersistedQaapDevPreviewRegistry>;
            if (parsed.version !== 1 || !Array.isArray(parsed.previews)) {
                return;
            }
            for (const candidate of parsed.previews) {
                if (!candidate || typeof candidate.previewId !== 'string'
                    || typeof candidate.ownerLogin !== 'string'
                    || typeof candidate.root !== 'string'
                    || !Number.isInteger(candidate.port)
                    || typeof candidate.accessToken !== 'string') {
                    continue;
                }
                // Persist only the process-scoped format. Legacy port/turn claims intentionally
                // retain their old TTL semantics and disappear across backend restarts.
                if (!isQaapProcessPreviewIdentity(candidate)) {
                    continue;
                }
                this.previews.set(candidate.previewId, candidate);
                this.previewIdByPort.set(candidate.port, candidate.previewId);
                this.claims.set(candidate.port, { ownerLogin: candidate.ownerLogin, at: Date.now() });
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.warn('[qaap-preview] Could not read the preview registry:', error);
            }
        }
    }

    protected schedulePersist(): void {
        if (!this.persistenceEnabled || this.persistTimer !== undefined) {
            return;
        }
        this.persistTimer = setTimeout(() => {
            this.persistTimer = undefined;
            this.persistNow();
        }, PERSIST_DEBOUNCE_MS);
        this.persistTimer.unref?.();
    }

    protected persistNow(): void {
        const previews = [...this.previews.values()].filter(record => isQaapProcessPreviewIdentity(record));
        const dir = path.dirname(this.storePath);
        const temp = `${this.storePath}.${process.pid}.tmp`;
        try {
            fs.mkdirSync(dir, { recursive: true, mode: STORE_DIR_MODE });
            fs.writeFileSync(temp, JSON.stringify({ version: 1, previews } satisfies PersistedQaapDevPreviewRegistry), { mode: STORE_FILE_MODE });
            fs.renameSync(temp, this.storePath);
            try { fs.chmodSync(this.storePath, STORE_FILE_MODE); } catch { /* best effort */ }
        } catch (error) {
            console.warn('[qaap-preview] Could not persist the preview registry:', error);
            try { fs.unlinkSync(temp); } catch { /* ignore */ }
        }
    }
}

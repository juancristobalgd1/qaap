// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { QaapResolvedPreviewIdentity } from '../common/qaap-preview-identity';
import { randomBytes } from 'crypto';

export interface QaapDevPreviewRegistration extends QaapResolvedPreviewIdentity {
    readonly ownerLogin: string;
    readonly root: string;
    readonly port: number;
    readonly processId?: number;
}

export interface QaapDevPreviewRecord extends QaapDevPreviewRegistration {
    readonly claimedAt: number;
    readonly touchedAt: number;
    /** Per-preview capability used only on an isolated preview hostname. Never sent to other users. */
    readonly accessToken: string;
}

/**
 * Maps a dev-preview port to the login that claimed it (having proven workspace ownership), so the
 * `/qaap-dev/:port` proxy can deny a signed-in user reaching another tenant's dev server on the
 * shared host. Claims are the only authoritative owner signal for frontend-started dev servers,
 * which never reach the backend restart path. A claim is refreshed each time the owner re-opens the
 * preview and expires after {@link CLAIM_TTL_MS} so a port later reused by a different user is not
 * blocked by a stale entry. Unclaimed ports fall back to the endpoint's `requireAuth` gate.
 */
@injectable()
export class QaapDevPreviewPortRegistry {

    protected static readonly CLAIM_TTL_MS = 30 * 60_000;

    protected readonly claims = new Map<number, { readonly ownerLogin: string; at: number }>();
    protected readonly previews = new Map<string, QaapDevPreviewRecord>();
    protected readonly previewIdByPort = new Map<number, string>();

    /**
     * Registers immutable execution coordinates and reserves the port for that preview. Neither a
     * second execution nor a second tenant may overwrite a live mapping.
     */
    register(registration: QaapDevPreviewRegistration): QaapDevPreviewRecord | undefined {
        const now = Date.now();
        const existing = this.previews.get(registration.previewId);
        if (existing && !this.isRecordExpired(existing)) {
            if (!this.sameRegistration(existing, registration)) {
                return undefined;
            }
            const refreshed = { ...existing, processId: registration.processId ?? existing.processId, touchedAt: now };
            this.previews.set(registration.previewId, refreshed);
            this.claims.set(registration.port, { ownerLogin: registration.ownerLogin, at: now });
            return refreshed;
        }

        const occupiedBy = this.previewIdByPort.get(registration.port);
        if (occupiedBy && occupiedBy !== registration.previewId) {
            const occupied = this.previews.get(occupiedBy);
            if (occupied && !this.isRecordExpired(occupied)) {
                return undefined;
            }
            this.previews.delete(occupiedBy);
        }

        const record: QaapDevPreviewRecord = {
            ...registration,
            claimedAt: existing?.claimedAt ?? now,
            touchedAt: now,
            accessToken: existing?.accessToken ?? randomBytes(24).toString('base64url'),
        };
        this.previews.set(registration.previewId, record);
        this.previewIdByPort.set(registration.port, registration.previewId);
        this.claims.set(registration.port, { ownerLogin: registration.ownerLogin, at: now });
        return record;
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
    }

    attachProcess(previewId: string, ownerLogin: string, processId: number | undefined): boolean {
        const record = this.getForOwner(previewId, ownerLogin);
        if (!record) {
            return false;
        }
        this.previews.set(previewId, { ...record, processId, touchedAt: Date.now() });
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
        return true;
    }

    /** Refreshes the claim TTL while the owner is actively using the preview. No-op for others. */
    touch(port: number, ownerLogin: string): void {
        if (this.ownerOf(port) === ownerLogin) {
            this.claims.set(port, { ownerLogin, at: Date.now() });
        }
    }

    release(port: number): void {
        const previewId = this.previewIdByPort.get(port);
        if (previewId) {
            this.previews.delete(previewId);
            this.previewIdByPort.delete(port);
        }
        this.claims.delete(port);
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
        return Date.now() - record.touchedAt > QaapDevPreviewPortRegistry.CLAIM_TTL_MS;
    }

    protected sameRegistration(left: QaapDevPreviewRecord, right: QaapDevPreviewRegistration): boolean {
        return left.ownerLogin === right.ownerLogin
            && left.projectId === right.projectId
            && left.conversationId === right.conversationId
            && left.runId === right.runId
            && left.root === right.root
            && left.port === right.port;
    }
}

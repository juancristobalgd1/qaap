// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';

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

    claim(port: number, ownerLogin: string): void {
        this.claims.set(port, { ownerLogin, at: Date.now() });
    }

    release(port: number): void {
        this.claims.delete(port);
    }

    /** The login that owns this port, or undefined if unclaimed or the claim has expired. */
    ownerOf(port: number): string | undefined {
        const entry = this.claims.get(port);
        if (!entry) {
            return undefined;
        }
        if (Date.now() - entry.at > QaapDevPreviewPortRegistry.CLAIM_TTL_MS) {
            this.claims.delete(port);
            return undefined;
        }
        return entry.ownerLogin;
    }
}

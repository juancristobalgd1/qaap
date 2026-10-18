// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';

interface QaapCachedOwnerToken {
    readonly token: string;
    readonly seenAt: number;
}

/**
 * In-memory GitHub token of each owner, for request-less backend work (task pull requests) in a
 * per-tenant backend (`QAAP_TENANT_BACKEND_MODE`). Such a backend has no shared session store: the
 * control-plane proxy hands it the owner's token per request inside the short-lived HMAC tenant
 * assertion (`x-qaap-tenant-assertion`, see `QaapGithubAuthGuard.authenticateTenantBackend`). The
 * guard records that token here on every verified assertion.
 *
 * Never written to disk and never handed to an agent process (doc/qaap-github-token-boundary.md):
 * it lives only in this backend's heap, like the per-request copy it comes from. It is dropped after
 * {@link maxAgeMs} without a fresh request and on a GitHub 401.
 */
@injectable()
export class QaapGithubOwnerTokenCache {

    protected readonly tokens = new Map<string, QaapCachedOwnerToken>();

    /** Default 12 h: a tenant that saw no authenticated request for that long has to sign in again. */
    protected readonly maxAgeMs = 12 * 60 * 60 * 1000;

    remember(login: string | undefined, token: string | undefined, now: number = Date.now()): void {
        const key = this.key(login);
        if (!key || !token) {
            return;
        }
        this.tokens.set(key, { token, seenAt: now });
    }

    get(login: string | undefined, now: number = Date.now()): string | undefined {
        const key = this.key(login);
        const entry = key ? this.tokens.get(key) : undefined;
        if (!entry || !key) {
            return undefined;
        }
        if (now - entry.seenAt > this.maxAgeMs) {
            this.tokens.delete(key);
            return undefined;
        }
        return entry.token;
    }

    /** Drops the token after GitHub rejected it (401), so the owner is asked to sign in again. */
    forget(login: string | undefined, token?: string): void {
        const key = this.key(login);
        if (key && (!token || this.tokens.get(key)?.token === token)) {
            this.tokens.delete(key);
        }
    }

    protected key(login: string | undefined): string | undefined {
        return login?.trim().toLowerCase() || undefined;
    }
}

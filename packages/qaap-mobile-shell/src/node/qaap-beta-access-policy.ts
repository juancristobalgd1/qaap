// *****************************************************************************
// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isQaapHostedProductionRuntime } from './qaap-production-auth-readiness';

/** Server-owned beta admission policy. Never use client-supplied login claims. */
export class QaapBetaAccessPolicy {

    constructor(protected readonly env: NodeJS.ProcessEnv = process.env) { }

    isRequired(): boolean {
        return isQaapHostedProductionRuntime(this.env) || this.env.QAAP_BETA_ALLOWED_LOGINS !== undefined;
    }

    isConfigured(): boolean {
        return this.allowedLogins().size > 0;
    }

    allows(login: string): boolean {
        return !this.isRequired() || this.allowedLogins().has(login.toLowerCase());
    }

    protected allowedLogins(): Set<string> {
        const entries = (this.env.QAAP_BETA_ALLOWED_LOGINS ?? '').split(',').map(value => value.trim().toLowerCase());
        // Reject the whole configuration if any entry is invalid: no wildcard or
        // partial list should silently open a beta. GitHub logins are <=39 chars.
        const valid = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
        if (entries.some(value => !valid.test(value) || value.includes('--'))) {
            return new Set();
        }
        return new Set(entries);
    }
}

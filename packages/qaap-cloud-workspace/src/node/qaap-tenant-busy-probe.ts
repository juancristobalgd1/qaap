// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as crypto from 'crypto';

/**
 * Header the control plane sends when it asks a tenant backend whether agent turns are in flight.
 * The probe carries no user identity: it only proves the caller knows the tenant-scoped secret.
 */
export const QAAP_TENANT_BUSY_PROBE_HEADER = 'x-qaap-busy-probe';

const PROBE_MAX_AGE_MS = 60_000;
const MIN_SECRET_LENGTH = 32;

/** Answer of `GET {QAAP_TENANT_RUNTIME_API_PATH}/busy` and `/drain-status`. */
export interface QaapTenantBusyStatus {
    readonly busy: boolean;
    readonly runningTasks: number;
    readonly draining?: boolean;
}

export namespace QaapTenantBusyProbe {

    function sign(tenantLogin: string, issuedAt: number, secret: string): string {
        return crypto.createHmac('sha256', secret)
            .update(`busy-probe\u0000${tenantLogin.trim().toLowerCase()}\u0000${issuedAt}`)
            .digest('base64url');
    }

    export function create(tenantLogin: string, secret: string, now = Date.now()): string {
        if (!secret || secret.trim().length < MIN_SECRET_LENGTH) {
            throw new Error('Tenant busy probes require a secret of at least 32 characters.');
        }
        return `${now}.${sign(tenantLogin, now, secret)}`;
    }

    /** Verify a probe without throwing on hostile input. */
    export function verify(token: string | undefined, secret: string | undefined, tenantLogin: string | undefined, now = Date.now()): boolean {
        if (!token || !tenantLogin?.trim() || !secret || secret.trim().length < MIN_SECRET_LENGTH) {
            return false;
        }
        const separator = token.indexOf('.');
        if (separator <= 0) {
            return false;
        }
        const issuedAt = Number(token.slice(0, separator));
        if (!Number.isSafeInteger(issuedAt) || Math.abs(now - issuedAt) > PROBE_MAX_AGE_MS) {
            return false;
        }
        const expected = Buffer.from(sign(tenantLogin, issuedAt, secret));
        const actual = Buffer.from(token.slice(separator + 1));
        return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    }

    export function parseStatus(value: unknown): QaapTenantBusyStatus | undefined {
        if (!value || typeof value !== 'object') {
            return undefined;
        }
        const candidate = value as Partial<QaapTenantBusyStatus>;
        if (typeof candidate.busy !== 'boolean' || typeof candidate.runningTasks !== 'number') {
            return undefined;
        }
        return { busy: candidate.busy, runningTasks: candidate.runningTasks, draining: candidate.draining === true };
    }
}

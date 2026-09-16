// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as crypto from 'crypto';
import type { QaapAuthSessionUser } from './qaap-github-api-types';

/** Header added only by the authenticated control-plane → tenant-backend proxy. */
export const QAAP_TENANT_BACKEND_ASSERTION_HEADER = 'x-qaap-tenant-assertion';
export const QAAP_TENANT_BACKEND_MODE_ENV = 'QAAP_TENANT_BACKEND_MODE';
export const QAAP_TENANT_BACKEND_SECRET_ENV = 'QAAP_TENANT_BACKEND_SECRET';
export const QAAP_TENANT_LOGIN_ENV = 'QAAP_TENANT_LOGIN';

const ASSERTION_VERSION = 1;
const DEFAULT_TTL_MS = 30_000;
const MAX_CLOCK_SKEW_MS = 5_000;

export interface QaapTenantBackendAssertionPayload {
    readonly version: 1;
    readonly tenantLogin: string;
    readonly issuedAt: number;
    readonly expiresAt: number;
    readonly user: QaapAuthSessionUser;
    /** Forwarded only over the private loopback proxy; never emitted to browser responses. */
    readonly githubAccessToken: string;
}
function encode(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string | undefined {
    try {
        return Buffer.from(value, 'base64url').toString('utf8');
    } catch {
        return undefined;
    }
}

function signature(input: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(input).digest('base64url');
}

function hasUsableSecret(secret: string | undefined): secret is string {
    return !!secret && secret.trim().length >= 32;
}

/** Create a short-lived, audience-bound assertion for one tenant backend. */
export function createQaapTenantBackendAssertion(
    payload: Omit<QaapTenantBackendAssertionPayload, 'version' | 'issuedAt' | 'expiresAt'>,
    secret: string,
    now = Date.now(),
    ttlMs = DEFAULT_TTL_MS,
): string {
    if (!hasUsableSecret(secret)) {
        throw new Error('Tenant backend assertions require a secret of at least 32 characters.');
    }
    const issuedAt = now;
    const expiresAt = now + Math.min(Math.max(ttlMs, 1_000), DEFAULT_TTL_MS);
    const body: QaapTenantBackendAssertionPayload = {
        version: ASSERTION_VERSION,
        tenantLogin: payload.tenantLogin.trim(),
        issuedAt,
        expiresAt,
        user: payload.user,
        githubAccessToken: payload.githubAccessToken,
    };
    const encoded = encode(JSON.stringify(body));
    return `${encoded}.${signature(encoded, secret)}`;
}

/** Verify an assertion without throwing on hostile input. */
export function verifyQaapTenantBackendAssertion(
    token: string | undefined,
    secret: string | undefined,
    expectedTenantLogin?: string,
    now = Date.now(),
): QaapTenantBackendAssertionPayload | undefined {
    if (!token || !hasUsableSecret(secret)) {
        return undefined;
    }
    const separator = token.lastIndexOf('.');
    if (separator <= 0 || separator === token.length - 1) {
        return undefined;
    }
    const encoded = token.slice(0, separator);
    const suppliedSignature = token.slice(separator + 1);
    const expectedSignature = signature(encoded, secret);
    const supplied = Buffer.from(suppliedSignature, 'utf8');
    const expected = Buffer.from(expectedSignature, 'utf8');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
        return undefined;
    }
    const decoded = decode(encoded);
    if (!decoded) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(decoded) as Partial<QaapTenantBackendAssertionPayload>;
        const tenantLogin = typeof parsed.tenantLogin === 'string' ? parsed.tenantLogin.trim() : '';
        const issuedAt = parsed.issuedAt;
        const expiresAt = parsed.expiresAt;
        const user = parsed.user;
        const githubAccessToken = parsed.githubAccessToken;
        if (parsed.version !== ASSERTION_VERSION
            || !tenantLogin
            || typeof issuedAt !== 'number'
            || typeof expiresAt !== 'number'
            || !Number.isFinite(issuedAt)
            || !Number.isFinite(expiresAt)
            || issuedAt > now + MAX_CLOCK_SKEW_MS
            || expiresAt <= now
            || expiresAt <= issuedAt
            || (expectedTenantLogin && tenantLogin.toLowerCase() !== expectedTenantLogin.trim().toLowerCase())
            || !user
            || typeof user.login !== 'string'
            || user.login.trim().toLowerCase() !== tenantLogin.toLowerCase()
            || typeof githubAccessToken !== 'string'
            || !githubAccessToken) {
            return undefined;
        }
        return {
            version: ASSERTION_VERSION,
            tenantLogin,
            issuedAt,
            expiresAt,
            user,
            githubAccessToken,
        };
    } catch {
        return undefined;
    }
}

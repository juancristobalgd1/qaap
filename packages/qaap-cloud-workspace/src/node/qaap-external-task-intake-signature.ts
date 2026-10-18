// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createHash, createHmac, timingSafeEqual } from 'crypto';

/** How long a control-plane → tenant intake signature is valid. */
export const QAAP_EXTERNAL_TASK_INTAKE_SIGNATURE_TTL_MS = 60_000;

/*
 * The intake call carries a normal tenant assertion (any proxied browser request has one too) AND this
 * signature, which only the control plane can mint: HMAC with the tenant's secret under its own domain
 * label, over login, delivery, issue time and the body's SHA-256. The proxy strips the header from browser
 * traffic (QaapTenantBackendProxyContribution.forwardHeaders).
 */

function signatureDigest(secret: string, login: string, deliveryId: string, issuedAt: number, body: string): string {
    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
    return createHmac('sha256', secret)
        .update(`external-task\0${login.toLowerCase()}|${deliveryId}|${issuedAt}|${bodyHash}`)
        .digest('hex');
}

/** `v1.<issuedAt>.<hex>`. */
export function signQaapExternalTaskIntake(secret: string, login: string, deliveryId: string, body: string, issuedAt: number = Date.now()): string {
    return `v1.${issuedAt}.${signatureDigest(secret, login, deliveryId, issuedAt, body)}`;
}

/** Constant-time check of {@link signQaapExternalTaskIntake}, refusing anything older (or newer) than the TTL. */
export function verifyQaapExternalTaskIntake(
    secret: string | undefined,
    header: string | undefined,
    login: string,
    deliveryId: string,
    body: string,
    now: number = Date.now(),
): boolean {
    if (!secret || !header || !login || !deliveryId) {
        return false;
    }
    const match = /^v1\.(\d{1,16})\.([0-9a-f]{64})$/.exec(header.trim());
    if (!match) {
        return false;
    }
    const issuedAt = Number(match[1]);
    if (!Number.isSafeInteger(issuedAt) || Math.abs(now - issuedAt) > QAAP_EXTERNAL_TASK_INTAKE_SIGNATURE_TTL_MS) {
        return false;
    }
    const expected = Buffer.from(signatureDigest(secret, login, deliveryId, issuedAt, body), 'hex');
    const received = Buffer.from(match[2], 'hex');
    return received.length === expected.length && timingSafeEqual(received, expected);
}

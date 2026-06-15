// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createHmac, timingSafeEqual } from 'crypto';

/** Verify GitHub `X-Hub-Signature-256` for a webhook POST body. */
export function verifyGithubWebhookSignature(
    payload: string,
    secret: string,
    signatureHeader: string | undefined,
): boolean {
    if (!secret.trim() || !signatureHeader?.startsWith('sha256=')) {
        return false;
    }
    const expected = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
    try {
        return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
    } catch {
        return false;
    }
}

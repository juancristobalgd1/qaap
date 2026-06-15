// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createHmac } from 'crypto';
import { expect } from 'chai';
import { verifyGithubWebhookSignature } from './qaap-github-webhook-signature';

describe('qaap-github-webhook-signature', () => {
    it('accepts a valid sha256 signature', () => {
        const secret = 'test-secret';
        const payload = '{"action":"created"}';
        const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
        expect(verifyGithubWebhookSignature(payload, secret, signature)).to.be.true;
    });

    it('rejects missing or invalid signatures', () => {
        const payload = '{}';
        expect(verifyGithubWebhookSignature(payload, 'secret', undefined)).to.be.false;
        expect(verifyGithubWebhookSignature(payload, 'secret', 'sha256=deadbeef')).to.be.false;
    });
});

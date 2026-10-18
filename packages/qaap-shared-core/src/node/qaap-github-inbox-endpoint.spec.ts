// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createHmac } from 'crypto';
import { QaapGithubInboxEndpoint } from './qaap-github-inbox-endpoint';

describe('QaapGithubInboxEndpoint.verifyWebhookSignature', () => {
    const secret = 'whsec';
    const endpoint = new QaapGithubInboxEndpoint();
    const sign = (raw: Buffer): string => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

    it('accepts a signature over the raw bytes', () => {
        const raw = Buffer.from('{ "a": 1 }\n');
        expect(endpoint.verifyWebhookSignature(sign(raw), raw, secret)).to.equal(true);
    });

    it('rejects a signature computed over re-serialized JSON', () => {
        const raw = Buffer.from('{ "a":   1 }\n');
        const reserialized = Buffer.from(JSON.stringify(JSON.parse(raw.toString('utf8'))));
        expect(endpoint.verifyWebhookSignature(sign(reserialized), raw, secret)).to.equal(false);
    });

    it('rejects a missing prefix, missing header, wrong secret and length mismatch', () => {
        const raw = Buffer.from('{}');
        expect(endpoint.verifyWebhookSignature(sign(raw).slice('sha256='.length), raw, secret)).to.equal(false);
        expect(endpoint.verifyWebhookSignature(undefined, raw, secret)).to.equal(false);
        expect(endpoint.verifyWebhookSignature(sign(raw), raw, 'other')).to.equal(false);
        expect(endpoint.verifyWebhookSignature('sha256=abcd', raw, secret)).to.equal(false);
    });
});

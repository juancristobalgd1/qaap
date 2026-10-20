// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import { QaapFrameCheckResult } from '@theia/qaap-adapters/lib/common/qaap-frame-check';
import { QaapFrameCheckEndpoint } from './qaap-frame-check-endpoint';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';

class TestQaapFrameCheckEndpoint extends QaapFrameCheckEndpoint {
    checked: string[] = [];
    next: () => Promise<QaapFrameCheckResult> = async () => ({ embeddable: false, reason: 'X-Frame-Options: deny' });

    constructor() {
        super();
        (this as unknown as { auth: Partial<QaapGithubAuthGuard> }).auth = {
            authenticate: () => ({ kind: 'skip', userLogin: 'tester' }),
        } as Partial<QaapGithubAuthGuard>;
    }

    async run(url: string): Promise<QaapFrameCheckResult> {
        let body: QaapFrameCheckResult | undefined;
        const res = {
            status: () => res,
            set: () => res,
            json: (value: QaapFrameCheckResult) => {
                body = value;
                return res;
            },
        };
        await this.handle({ query: { url }, headers: {} } as unknown as Request, res as unknown as Response);
        return body!;
    }

    protected override check(start: URL): Promise<QaapFrameCheckResult> {
        this.checked.push(start.href);
        return this.next();
    }
}

describe('QaapFrameCheckEndpoint', () => {

    const savedEnv = { ...process.env };

    beforeEach(() => {
        process.env.QAAP_OAUTH_PUBLIC_URL = 'https://qaap.example';
        process.env.QAAP_PREVIEW_BASE_DOMAIN = 'preview.qaap.example';
    });

    afterEach(() => {
        process.env = { ...savedEnv };
    });

    it('never fetches Qaap isolated preview hosts and reports them internal and embeddable', async () => {
        const endpoint = new TestQaapFrameCheckEndpoint();
        const result = await endpoint.run('https://0123456789abcdef0123456789abcdef.preview.qaap.example/');
        expect(endpoint.checked).to.deep.equal([]);
        expect(result).to.deep.equal({ embeddable: true, internal: true });
    });

    it('still checks external sites', async () => {
        const endpoint = new TestQaapFrameCheckEndpoint();
        const result = await endpoint.run('https://claude.ai/');
        expect(endpoint.checked).to.deep.equal(['https://claude.ai/']);
        expect(result.embeddable).to.equal(false);
    });

    it('answers unknown (not cached) when the check fails', async () => {
        const endpoint = new TestQaapFrameCheckEndpoint();
        endpoint.next = async () => {
            throw new Error('boom');
        };
        expect(await endpoint.run('https://down.example/')).to.deep.equal({ embeddable: true, unknown: true });
        endpoint.next = async () => ({ embeddable: false });
        expect((await endpoint.run('https://down.example/')).embeddable).to.equal(false);
        expect(endpoint.checked.length).to.equal(2);
    });
});

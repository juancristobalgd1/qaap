// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    navigateExplicitPreviewUrl,
    QaapPreviewPortClaimService,
} from './qaap-preview-port-claim-service';

describe('qaap-preview-port-claim-service', () => {

    const origin = 'http://localhost:3000';
    const proxied = `${origin}/qaap-dev/5173/`;

    it('awaits a successful claim before navigating a proxy URL', async () => {
        const events: string[] = [];
        const claims: number[] = [];
        const claimService: QaapPreviewPortClaimService = {
            claim: async port => {
                claims.push(port);
                events.push('claim');
                return { kind: 'claimed' };
            },
        };

        const result = await navigateExplicitPreviewUrl(proxied, claimService, location => {
            events.push(`navigate:${location}`);
        }, origin);

        expect(result).to.deep.equal({ kind: 'navigated' });
        expect(claims).to.deep.equal([5173]);
        expect(events).to.deep.equal(['claim', `navigate:${proxied}`]);
    });

    it('does not navigate when another workspace owns the port', async () => {
        let navigated = false;
        const claimService: QaapPreviewPortClaimService = {
            claim: async () => ({ kind: 'conflict' }),
        };

        const result = await navigateExplicitPreviewUrl(proxied, claimService, () => {
            navigated = true;
        }, origin);

        expect(result).to.deep.equal({ kind: 'conflict' });
        expect(navigated).to.equal(false);
    });

    it('does not navigate after a claim error', async () => {
        let navigated = false;
        const claimService: QaapPreviewPortClaimService = {
            claim: async () => ({ kind: 'error', status: 403 }),
        };

        const result = await navigateExplicitPreviewUrl(proxied, claimService, () => {
            navigated = true;
        }, origin);

        expect(result).to.deep.equal({ kind: 'error', status: 403 });
        expect(navigated).to.equal(false);
    });

    it('navigates external and file URLs without claiming', async () => {
        let claims = 0;
        const navigated: string[] = [];
        const claimService: QaapPreviewPortClaimService = {
            claim: async () => {
                claims++;
                return { kind: 'claimed' };
            },
        };

        await navigateExplicitPreviewUrl('https://example.com/', claimService, location => {
            navigated.push(location);
        }, origin);
        await navigateExplicitPreviewUrl('file:///tmp/index.html', claimService, location => {
            navigated.push(location);
        }, origin);

        expect(claims).to.equal(0);
        expect(navigated).to.deep.equal(['https://example.com/', 'file:///tmp/index.html']);
    });
});

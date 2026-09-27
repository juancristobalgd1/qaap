// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    createQaapTenantBackendAssertion,
    verifyQaapTenantBackendAssertion,
} from './qaap-tenant-backend-auth';

describe('Qaap tenant backend assertions', () => {
    const secret = 'tenant-backend-test-secret-012345678901234567890';
    const user = { provider: 'github' as const, login: 'alice', name: 'Alice' };

    it('binds the signed assertion to its tenant and expires it', () => {
        const token = createQaapTenantBackendAssertion({
            tenantLogin: 'alice',
            user,
            githubAccessToken: 'github-secret',
        }, secret, 10_000);
        expect(verifyQaapTenantBackendAssertion(token, secret, 'alice', 10_001)?.tenantLogin).to.equal('alice');
        expect(verifyQaapTenantBackendAssertion(token, secret, 'bob', 10_001)).to.equal(undefined);
        expect(verifyQaapTenantBackendAssertion(token, secret, 'alice', 40_001)).to.equal(undefined);
    });

    it('rejects tampering and unusable secrets', () => {
        const token = createQaapTenantBackendAssertion({
            tenantLogin: 'alice',
            user,
            githubAccessToken: 'github-secret',
        }, secret, 10_000);
        const [body, signature] = token.split('.');
        expect(verifyQaapTenantBackendAssertion(`${body}.${signature}x`, secret, 'alice', 10_001)).to.equal(undefined);
        expect(verifyQaapTenantBackendAssertion(token, 'short', 'alice', 10_001)).to.equal(undefined);
    });
});

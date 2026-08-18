// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { evaluateQaapProductionAuthReadiness, buildQaapLaunchHealthPayload } from './qaap-production-auth-readiness';

describe('evaluateQaapProductionAuthReadiness', () => {

    it('allows local dev without OAuth', () => {
        const result = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'development',
            QAAP_CLOUD_MODE: 'local',
        });
        expect(result.ready).to.equal(true);
        expect(result.productionRuntime).to.equal(false);
        expect(result.oauthConfigured).to.equal(false);
    });

    it('refuses production without OAuth and without skip-auth override', () => {
        const result = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_SKIP_AUTH: 'false',
        });
        expect(result.ready).to.equal(false);
        expect(result.fatalReason).to.match(/GitHub OAuth/i);
    });

    it('refuses NODE_ENV=production even when QAAP_CLOUD_MODE=local if OAuth is missing', () => {
        const result = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'local',
        });
        expect(result.productionRuntime).to.equal(true);
        expect(result.ready).to.equal(false);
    });

    it('allows production when OAuth is fully configured', () => {
        const result = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_GITHUB_CLIENT_ID: 'client',
            QAAP_GITHUB_CLIENT_SECRET: 'secret',
            QAAP_OAUTH_PUBLIC_URL: 'https://qaap.example',
        });
        expect(result.ready).to.equal(true);
        expect(result.oauthConfigured).to.equal(true);
    });

    it('rejects placeholder OAuth client ids', () => {
        const result = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_GITHUB_CLIENT_ID: 'your-dev-oauth-client-id',
            QAAP_GITHUB_CLIENT_SECRET: 'secret',
            QAAP_OAUTH_PUBLIC_URL: 'https://qaap.example',
        });
        expect(result.oauthConfigured).to.equal(false);
        expect(result.ready).to.equal(false);
    });

    it('honors skip-auth only with the production override', () => {
        const refused = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_SKIP_AUTH: 'true',
        });
        expect(refused.skipAuth).to.equal(false);
        expect(refused.ready).to.equal(false);

        const allowed = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_SKIP_AUTH: 'true',
            QAAP_ALLOW_SKIP_AUTH_IN_PRODUCTION: 'true',
        });
        expect(allowed.skipAuth).to.equal(true);
        expect(allowed.ready).to.equal(true);
    });

    it('allows the unconfigured-OAuth override for a private box', () => {
        const result = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_ALLOW_UNCONFIGURED_OAUTH_IN_PRODUCTION: '1',
        });
        expect(result.ready).to.equal(true);
    });
});

describe('buildQaapLaunchHealthPayload', () => {

    it('exposes liveness flags without secrets', () => {
        const readiness = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_GITHUB_CLIENT_ID: 'client',
            QAAP_GITHUB_CLIENT_SECRET: 'secret',
            QAAP_OAUTH_PUBLIC_URL: 'https://qaap.example',
        });
        const payload = buildQaapLaunchHealthPayload(readiness, {
            skipAuth: false,
            build: 'abc123def456',
        });
        expect(payload).to.deep.equal({
            ok: true,
            ready: true,
            productionRuntime: true,
            skipAuth: false,
            oauthConfigured: true,
            agentUidPerUser: true,
            build: 'abc123def456',
        });
        expect(JSON.stringify(payload)).to.not.match(/secret|client/i);
    });

    it('omits build when the image did not bake a SHA', () => {
        const readiness = evaluateQaapProductionAuthReadiness({ NODE_ENV: 'development' });
        const payload = buildQaapLaunchHealthPayload(readiness, { skipAuth: true, build: '  ' });
        expect(payload.build).to.equal(undefined);
        expect(payload.ok).to.equal(true);
        expect(payload.skipAuth).to.equal(true);
    });
});

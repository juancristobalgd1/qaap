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

    it('refuses production without OAuth', () => {
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
        expect(result.backendIsolationMode).to.equal('per-tenant');
        expect(result.backendIsolationReady).to.equal(true);
    });

    it('refuses an invited public tenant list while the backend is shared', () => {
        const result = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            QAAP_BETA_ALLOWED_LOGINS: 'alice,bob',
            QAAP_GITHUB_CLIENT_ID: 'client',
            QAAP_GITHUB_CLIENT_SECRET: 'secret',
            QAAP_OAUTH_PUBLIC_URL: 'https://qaap.example',
        });
        expect(result.ready).to.equal(false);
        expect(result.backendIsolationReady).to.equal(false);
        expect(result.fatalReason).to.match(/backend-per-tenant/i);
    });

    describe('isolated preview origins for invited tenants', () => {
        const publicBeta = {
            NODE_ENV: 'production',
            QAAP_CLOUD_MODE: 'docker',
            QAAP_BETA_ALLOWED_LOGINS: 'alice,bob',
            QAAP_BACKEND_PER_TENANT: '1',
            QAAP_TENANT_BACKEND_MASTER_SECRET: '0123456789abcdef0123456789abcdef',
            QAAP_GITHUB_CLIENT_ID: 'client',
            QAAP_GITHUB_CLIENT_SECRET: 'secret',
            QAAP_OAUTH_PUBLIC_URL: 'https://app.qaap.example',
        };

        it('refuses a public beta without QAAP_PREVIEW_BASE_DOMAIN', () => {
            const result = evaluateQaapProductionAuthReadiness(publicBeta);
            expect(result.ready).to.equal(false);
            expect(result.fatalReason).to.match(/isolated preview origins.*not set/i);
        });

        it('accepts a preview domain on a separate site', () => {
            for (const domain of ['qaap-previews.example', 'https://*.qaap-previews.example/', 'p.qaap-usercontent.example:8443']) {
                const result = evaluateQaapProductionAuthReadiness({ ...publicBeta, QAAP_PREVIEW_BASE_DOMAIN: domain });
                expect(result.ready, domain).to.equal(true);
            }
        });

        it('refuses a preview domain equal to, under, or above the IDE host', () => {
            for (const domain of ['app.qaap.example', 'previews.app.qaap.example', 'qaap.example']) {
                const result = evaluateQaapProductionAuthReadiness({ ...publicBeta, QAAP_PREVIEW_BASE_DOMAIN: domain });
                expect(result.ready, domain).to.equal(false);
                expect(result.fatalReason, domain).to.match(/overlaps/);
            }
        });

        it('refuses a same-site sibling unless explicitly acknowledged', () => {
            const sibling = { ...publicBeta, QAAP_PREVIEW_BASE_DOMAIN: 'previews.qaap.example' };
            const refused = evaluateQaapProductionAuthReadiness(sibling);
            expect(refused.ready).to.equal(false);
            expect(refused.fatalReason).to.match(/same-site/);
            expect(evaluateQaapProductionAuthReadiness({ ...sibling, QAAP_PREVIEW_ALLOW_SAME_SITE: '1' }).ready).to.equal(true);
        });

        it('refuses an invalid preview domain', () => {
            const result = evaluateQaapProductionAuthReadiness({ ...publicBeta, QAAP_PREVIEW_BASE_DOMAIN: 'evil.example/path' });
            expect(result.ready).to.equal(false);
            expect(result.fatalReason).to.match(/not a valid domain/);
        });

        it('does not require a preview domain without invited tenants', () => {
            expect(evaluateQaapProductionAuthReadiness({ ...publicBeta, QAAP_BETA_ALLOWED_LOGINS: '' }).ready).to.equal(true);
        });
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

    it('never enables skip-auth in production, even with legacy overrides', () => {
        const refused = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_SKIP_AUTH: 'true',
        });
        expect(refused.skipAuth).to.equal(false);
        expect(refused.ready).to.equal(false);

        const stillRefused = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_SKIP_AUTH: 'true',
            QAAP_ALLOW_SKIP_AUTH_IN_PRODUCTION: 'true',
        });
        expect(stillRefused.skipAuth).to.equal(false);
        expect(stillRefused.ready).to.equal(false);
    });

    it('ignores the legacy unconfigured-OAuth override', () => {
        const result = evaluateQaapProductionAuthReadiness({
            NODE_ENV: 'production',
            QAAP_ALLOW_UNCONFIGURED_OAUTH_IN_PRODUCTION: '1',
        });
        expect(result.ready).to.equal(false);
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
            backendIsolationMode: 'per-tenant',
            backendIsolationReady: true,
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

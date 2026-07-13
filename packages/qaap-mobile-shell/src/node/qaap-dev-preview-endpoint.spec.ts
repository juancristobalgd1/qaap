// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request } from '@theia/core/shared/express';
import { QaapDevPreviewEndpoint } from './qaap-dev-preview-endpoint';
import type { QaapGithubAuthContext, QaapGithubAuthGuard } from './qaap-github-auth-guard';
import type { QaapDevPreviewPortRegistry } from './qaap-dev-preview-port-registry';

class TestQaapDevPreviewEndpoint extends QaapDevPreviewEndpoint {
    exposeRewriteDevPreviewBody(body: string, targetPort: number): string {
        return this.rewriteDevPreviewBody(body, targetPort);
    }

    exposeRewriteDevPreviewLocation(location: string, targetPort: number): string {
        return this.rewriteDevPreviewLocation(location, targetPort);
    }

    exposeMayProxyPort(req: Request, port: number): boolean {
        return this.mayProxyPort(req, port);
    }

    async exposeHandleProbe(req: Request, res: unknown): Promise<void> {
        return this.handleProbe(req, res as never);
    }

    touchedPorts: number[] = [];

    setFakes(ctx: QaapGithubAuthContext, claimedOwner: string | undefined): void {
        const mutable = this as unknown as { auth: QaapGithubAuthGuard; portRegistry: QaapDevPreviewPortRegistry };
        mutable.auth = {
            authenticate: () => ctx,
            resolveUserLogin: (c: QaapGithubAuthContext) => (c.kind === 'authenticated' || c.kind === 'skip' ? c.userLogin : undefined),
        } as unknown as QaapGithubAuthGuard;
        mutable.portRegistry = {
            ownerOf: () => claimedOwner,
            touch: (port: number) => { this.touchedPorts.push(port); },
        } as unknown as QaapDevPreviewPortRegistry;
    }
}

describe('QaapDevPreviewEndpoint', () => {

    const endpoint = new TestQaapDevPreviewEndpoint();

    it('rewrites Vite absolute imports to the qaap-dev proxy prefix', () => {
        const body = [
            '<script type="module" src="/src/main.jsx"></script>',
            'import "/@vite/client";',
            'import React from "/node_modules/.vite/deps/react.js?v=123";',
            'export { value } from "/src/module.js";',
            'const worker = new URL("/src/worker.js", import.meta.url);',
            'const model = "/models/iphone16promax.glb";',
            '.hero { background: url(/assets/bg.png); }',
        ].join('\n');

        expect(endpoint.exposeRewriteDevPreviewBody(body, 5184)).to.equal([
            '<script type="module" src="/qaap-dev/5184/src/main.jsx"></script>',
            'import "/qaap-dev/5184/@vite/client";',
            'import React from "/qaap-dev/5184/node_modules/.vite/deps/react.js?v=123";',
            'export { value } from "/qaap-dev/5184/src/module.js";',
            'const worker = new URL("/qaap-dev/5184/src/worker.js", import.meta.url);',
            'const model = "/qaap-dev/5184/models/iphone16promax.glb";',
            '.hero { background: url(/qaap-dev/5184/assets/bg.png); }',
        ].join('\n'));
    });

    it('rewrites root-relative redirects through the qaap-dev proxy prefix', () => {
        expect(endpoint.exposeRewriteDevPreviewLocation('/login', 5184)).to.equal('/qaap-dev/5184/login');
        expect(endpoint.exposeRewriteDevPreviewLocation('/qaap-dev/5184/login', 5184)).to.equal('/qaap-dev/5184/login');
    });

    describe('mayProxyPort fails closed (H1)', () => {
        const req = {} as Request;
        const authed = (login: string): QaapGithubAuthContext =>
            ({ kind: 'authenticated', userLogin: login, session: {} as never, sessionId: 's' });

        it('allows skip-auth (single-user / local dev) regardless of claim', () => {
            const ep = new TestQaapDevPreviewEndpoint();
            ep.setFakes({ kind: 'skip', userLogin: '_dev' }, undefined);
            expect(ep.exposeMayProxyPort(req, 5173)).to.equal(true);
        });

        it('denies an unauthenticated caller', () => {
            const ep = new TestQaapDevPreviewEndpoint();
            ep.setFakes({ kind: 'unauthorized' }, 'alice');
            expect(ep.exposeMayProxyPort(req, 5173)).to.equal(false);
        });

        it('DENIES an authenticated user on an UNCLAIMED port (the H1 fix — no fail-open)', () => {
            const ep = new TestQaapDevPreviewEndpoint();
            ep.setFakes(authed('alice'), undefined);
            expect(ep.exposeMayProxyPort(req, 5173)).to.equal(false);
        });

        it('allows the user who claimed the port', () => {
            const ep = new TestQaapDevPreviewEndpoint();
            ep.setFakes(authed('alice'), 'alice');
            expect(ep.exposeMayProxyPort(req, 5173)).to.equal(true);
        });

        it('denies a user reaching a port claimed by another tenant', () => {
            const ep = new TestQaapDevPreviewEndpoint();
            ep.setFakes(authed('bob'), 'alice');
            expect(ep.exposeMayProxyPort(req, 5173)).to.equal(false);
        });

        it('refreshes the owner claim TTL on each authorized access (no mid-session expiry)', () => {
            const ep = new TestQaapDevPreviewEndpoint();
            ep.setFakes(authed('alice'), 'alice');
            expect(ep.exposeMayProxyPort(req, 5173)).to.equal(true);
            expect(ep.touchedPorts).to.deep.equal([5173]);
        });

        it('does not touch the claim on a denied access', () => {
            const ep = new TestQaapDevPreviewEndpoint();
            ep.setFakes(authed('bob'), 'alice');
            expect(ep.exposeMayProxyPort(req, 5173)).to.equal(false);
            expect(ep.touchedPorts).to.deep.equal([]);
        });
    });

    describe('port registry claim semantics (non-stealing)', () => {
        it('first claim wins and the same login can refresh it', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            expect(registry.claim(5173, 'alice')).to.equal(true);
            expect(registry.claim(5173, 'alice')).to.equal(true);
            expect(registry.ownerOf(5173)).to.equal('alice');
        });

        it('refuses a takeover of a live claim by a different login', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            expect(registry.claim(5173, 'alice')).to.equal(true);
            expect(registry.claim(5173, 'bob')).to.equal(false);
            expect(registry.ownerOf(5173)).to.equal('alice');
        });

        it('allows re-claiming after the previous claim expired', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            registry.claim(5173, 'alice');
            const claims = (registry as unknown as { claims: Map<number, { ownerLogin: string; at: number }> }).claims;
            claims.set(5173, { ownerLogin: 'alice', at: Date.now() - 31 * 60_000 });
            expect(registry.ownerOf(5173)).to.equal(undefined);
            expect(registry.claim(5173, 'bob')).to.equal(true);
        });

        it('keeps the stale record after expiry: no proxying, but the previous owner is known', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            registry.claim(4173, 'alice');
            const claims = (registry as unknown as { claims: Map<number, { ownerLogin: string; at: number }> }).claims;
            claims.set(4173, { ownerLogin: 'alice', at: Date.now() - 31 * 60_000 });
            expect(registry.ownerOf(4173)).to.equal(undefined);
            expect(registry.staleOwnerOf(4173)).to.equal('alice');
        });

        it('touch refreshes only the owner and never rebinds the port', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            registry.claim(5173, 'alice');
            const claims = (registry as unknown as { claims: Map<number, { ownerLogin: string; at: number }> }).claims;
            const staleAt = Date.now() - 20 * 60_000;
            claims.set(5173, { ownerLogin: 'alice', at: staleAt });
            registry.touch(5173, 'bob');
            expect(claims.get(5173)?.at).to.equal(staleAt);
            expect(registry.ownerOf(5173)).to.equal('alice');
            registry.touch(5173, 'alice');
            expect(claims.get(5173)!.at).to.be.greaterThan(staleAt);
        });
    });

    describe('claim endpoint takeover rules', () => {
        class ClaimTestEndpoint extends TestQaapDevPreviewEndpoint {
            listening = false;

            async exposeHandleClaim(req: unknown, res: unknown): Promise<void> {
                return this.handleClaim(req as never, res as never);
            }

            protected override probeLocalDevServer(): Promise<boolean> {
                return Promise.resolve(this.listening);
            }

            setClaimFakes(login: string, registry: unknown): void {
                const mutable = this as unknown as { auth: unknown; portRegistry: unknown };
                mutable.auth = {
                    authenticate: () => ({ kind: 'authenticated', userLogin: login, session: {}, sessionId: 's' }),
                    resolveUserLogin: () => login,
                    assertWorkspacePathOwned: () => true,
                };
                mutable.portRegistry = registry;
            }
        }

        const claimReq = (port: number): unknown => ({
            body: { port, root: 'file:///workspace/repos/users/bob/site' },
            headers: {},
        });

        const makeRes = (): { record: { code: number } } => {
            const record = { code: 0 };
            const res = {
                record,
                status(code: number): unknown { record.code = code; return res; },
                sendStatus(code: number): void { record.code = code; },
                type(): unknown { return res; },
                send(): void { /* body ignored */ },
            };
            return res;
        };

        it('refuses reassigning an EXPIRED claim while the previous tenant server still listens', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            registry.claim(4173, 'alice');
            const claims = (registry as unknown as { claims: Map<number, { ownerLogin: string; at: number }> }).claims;
            claims.set(4173, { ownerLogin: 'alice', at: Date.now() - 31 * 60_000 });

            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('bob', registry);
            ep.listening = true;
            const res = makeRes();
            await ep.exposeHandleClaim(claimReq(4173), res);

            expect(res.record.code).to.equal(409);
            expect(registry.ownerOf(4173)).to.equal(undefined);
            expect(registry.staleOwnerOf(4173)).to.equal('alice');
        });

        it('allows reassigning an expired claim once nothing listens on the port', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            registry.claim(4173, 'alice');
            const claims = (registry as unknown as { claims: Map<number, { ownerLogin: string; at: number }> }).claims;
            claims.set(4173, { ownerLogin: 'alice', at: Date.now() - 31 * 60_000 });

            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('bob', registry);
            ep.listening = false;
            const res = makeRes();
            await ep.exposeHandleClaim(claimReq(4173), res);

            expect(res.record.code).to.equal(204);
            expect(registry.ownerOf(4173)).to.equal('bob');
        });

        it('lets the SAME login refresh its own expired claim even while its server listens', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            registry.claim(4173, 'alice');
            const claims = (registry as unknown as { claims: Map<number, { ownerLogin: string; at: number }> }).claims;
            claims.set(4173, { ownerLogin: 'alice', at: Date.now() - 31 * 60_000 });

            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            ep.listening = true;
            const res = makeRes();
            await ep.exposeHandleClaim(claimReq(4173), res);

            expect(res.record.code).to.equal(204);
            expect(registry.ownerOf(4173)).to.equal('alice');
        });
    });

    describe('probe ownership (SEC-8)', () => {
        const probeReq = (port: string): Request => ({
            params: { port },
            headers: {},
            protocol: 'http',
            get: (name: string) => (name === 'host' ? 'localhost:4873' : undefined),
        }) as unknown as Request;

        it('403s an authenticated user on an unclaimed port — no liveness enumeration', async () => {
            const ep = new TestQaapDevPreviewEndpoint();
            ep.setFakes({ kind: 'authenticated', userLogin: 'alice', session: {} as never, sessionId: 's' }, undefined);
            let status = 0;
            const res = { status(code: number): unknown { status = code; return this; }, json(): unknown { return this; } };
            await ep.exposeHandleProbe(probeReq('5173'), res);
            expect(status).to.equal(403);
        });
    });
});

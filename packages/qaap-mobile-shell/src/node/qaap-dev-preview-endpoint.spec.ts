// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request } from '@theia/core/shared/express';
import { QaapDevPreviewEndpoint } from './qaap-dev-preview-endpoint';
import type { QaapGithubAuthContext, QaapGithubAuthGuard } from './qaap-github-auth-guard';
import type { QaapDevPreviewPortRegistry } from './qaap-dev-preview-port-registry';
import type { QaapDevPreviewRecord } from './qaap-dev-preview-port-registry';
import { resolveQaapPreviewIdentity } from '../common/qaap-preview-identity';

class TestQaapDevPreviewEndpoint extends QaapDevPreviewEndpoint {
    exposeRewriteDevPreviewBody(body: string, targetPort: number, publicPrefix?: string): string {
        return this.rewriteDevPreviewBody(body, targetPort, publicPrefix);
    }

    exposeRewriteDevPreviewLocation(location: string, targetPort: number): string {
        return this.rewriteDevPreviewLocation(location, targetPort);
    }

    exposeMayProxyPort(req: Request, port: number): boolean {
        return this.mayProxyPort(req, port);
    }

    exposeIdentityPreviewUrl(req: Request, record: QaapDevPreviewRecord): string {
        return this.buildIdentityPreviewUrl(req, record);
    }

    exposePreviewIdFromHost(req: Request): string | undefined {
        return this.previewIdFromHost(req);
    }

    exposeRewriteIsolatedPreviewCsp(raw: string | undefined, parentOrigin: string): string {
        return this.rewriteIsolatedPreviewCsp(raw, parentOrigin);
    }

    async exposeHandleProbe(req: Request, res: unknown): Promise<void> {
        return this.handleProbe(req, res as never);
    }

    exposeHandleWebSocketUpgrade(req: unknown, socket: unknown): void {
        this.handleWebSocketUpgrade(req as never, socket as never, Buffer.alloc(0));
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

    it('keeps Vite/HMR module paths inside an identity-scoped preview', () => {
        expect(endpoint.exposeRewriteDevPreviewBody(
            'import "/@vite/client"; const socketPath = "/hmr";',
            5184,
            '/qaap-preview/u-alice-w-site-p-site-x-run-abc1234',
        )).to.equal(
            'import "/qaap-preview/u-alice-w-site-p-site-x-run-abc1234/@vite/client"; '
            + 'const socketPath = "/qaap-preview/u-alice-w-site-p-site-x-run-abc1234/hmr";',
        );
    });

    describe('isolated preview origin', () => {
        const priorBaseDomain = process.env.QAAP_PREVIEW_BASE_DOMAIN;
        const priorPublicUrl = process.env.QAAP_OAUTH_PUBLIC_URL;

        afterEach(() => {
            if (priorBaseDomain === undefined) {
                delete process.env.QAAP_PREVIEW_BASE_DOMAIN;
            } else {
                process.env.QAAP_PREVIEW_BASE_DOMAIN = priorBaseDomain;
            }
            if (priorPublicUrl === undefined) {
                delete process.env.QAAP_OAUTH_PUBLIC_URL;
            } else {
                process.env.QAAP_OAUTH_PUBLIC_URL = priorPublicUrl;
            }
        });

        it('uses a per-preview hostname and capability only when the canonical parent is explicit', () => {
            process.env.QAAP_PREVIEW_BASE_DOMAIN = 'preview.qaap.example';
            process.env.QAAP_OAUTH_PUBLIC_URL = 'https://app.qaap.example';
            const previewId = 'p-project-c-conv-r-run-abc1234';
            const req = {
                headers: { 'x-forwarded-proto': 'https', host: 'app.qaap.example' },
                protocol: 'https',
                get: () => 'app.qaap.example',
            } as unknown as Request;
            const record = {
                previewId,
                accessToken: 'secret-token',
            } as QaapDevPreviewRecord;
            expect(endpoint.exposeIdentityPreviewUrl(req, record))
                .to.equal(`https://${previewId}.preview.qaap.example/?qaap_preview_token=secret-token`);
            expect(endpoint.exposePreviewIdFromHost({
                headers: { host: `${previewId}.preview.qaap.example` },
            } as unknown as Request)).to.equal(previewId);
        });

        it('rewrites frame policy for the Qaap parent and permits the injected loader', () => {
            expect(endpoint.exposeRewriteIsolatedPreviewCsp(
                "default-src 'self'; frame-ancestors 'none'",
                'https://app.qaap.example',
            )).to.equal(
                "default-src 'self'; frame-ancestors https://app.qaap.example; script-src 'self' 'unsafe-inline'",
            );
        });
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
        it('reserves one immutable port record per preview identity', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const first = registry.register({
                previewId: 'p-project-c-conv-r-run-abc1234',
                projectId: 'project',
                conversationId: 'conv',
                runId: 'run',
                ownerLogin: 'alice',
                root: '/workspace/alice/project',
                port: 5173,
            });
            expect(first?.port).to.equal(5173);
            expect(first?.accessToken).to.be.a('string').and.not.empty;
            expect(registry.getForOwner(first!.previewId, 'alice')?.root).to.equal('/workspace/alice/project');
            expect(registry.getForOwner(first!.previewId, 'bob')).to.equal(undefined);

            const collision = registry.register({
                previewId: 'p-project-c-other-r-run-def5678',
                projectId: 'project',
                conversationId: 'other',
                runId: 'run',
                ownerLogin: 'alice',
                root: '/workspace/alice/project',
                port: 5173,
            });
            expect(collision).to.equal(undefined);
            expect(registry.attachProcess(first!.previewId, 'alice', 4242)).to.equal(true);
            expect(registry.get(first!.previewId)?.osProcessId).to.equal(4242);
        });

        it('does not implicitly replace an expired preview with different execution coordinates', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const first = registry.register({
                previewId: 'p-project-c-conv-r-run-abc1234',
                projectId: 'project',
                conversationId: 'conv',
                runId: 'run',
                ownerLogin: 'alice',
                root: '/workspace/alice/project',
                port: 4173,
            })!;
            const previews = (registry as unknown as { previews: Map<string, QaapDevPreviewRecord> }).previews;
            const claims = (registry as unknown as { claims: Map<number, { ownerLogin: string; at: number }> }).claims;
            previews.set(first.previewId, { ...first, touchedAt: Date.now() - 31 * 60_000 });
            claims.set(first.port, { ownerLogin: 'alice', at: Date.now() - 31 * 60_000 });

            const changed = {
                ...first,
                ownerLogin: 'bob',
                root: '/workspace/bob/project',
                port: 5173,
            };
            expect(registry.expiredRegistrationConflicts(changed).map(conflict => conflict.port)).to.deep.equal([4173]);
            expect(registry.register(changed)).to.equal(undefined);
            expect(registry.staleOwnerOf(4173)).to.equal('alice');
        });

        it('rotates the isolated-host capability when the same registration is renewed after expiry', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const registration = {
                previewId: 'p-project-c-conv-r-run-abc1234',
                projectId: 'project',
                conversationId: 'conv',
                runId: 'run',
                ownerLogin: 'alice',
                root: '/workspace/alice/project',
                port: 4173,
            };
            const first = registry.register(registration)!;
            const previews = (registry as unknown as { previews: Map<string, QaapDevPreviewRecord> }).previews;
            const claims = (registry as unknown as { claims: Map<number, { ownerLogin: string; at: number }> }).claims;
            previews.set(first.previewId, { ...first, touchedAt: Date.now() - 31 * 60_000 });
            claims.set(first.port, { ownerLogin: 'alice', at: Date.now() - 31 * 60_000 });

            const renewed = registry.register(registration)!;
            expect(renewed.accessToken).not.to.equal(first.accessToken);
            expect(registry.ownerOf(4173)).to.equal('alice');
        });

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
            readonly listeningPorts = new Set<number>();
            readonly probedPorts: number[] = [];

            async exposeHandleClaim(req: unknown, res: unknown): Promise<void> {
                return this.handleClaim(req as never, res as never);
            }

            exposeHandleRelease(req: unknown, res: unknown): void {
                this.handleRelease(req as never, res as never);
            }

            async exposeReapStoppedPreviews(): Promise<void> {
                await this.reapStoppedPreviews();
            }

            protected override probeLocalDevServer(port: number): Promise<boolean> {
                this.probedPorts.push(port);
                return Promise.resolve(this.listeningPorts.size > 0 ? this.listeningPorts.has(port) : this.listening);
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

        const claimReq = (
            port: number,
            identity?: object,
            root = 'file:///workspace/repos/users/bob/site',
        ): unknown => ({
            body: { port, root, ...identity },
            headers: {},
            protocol: 'http',
            get: () => 'localhost:3000',
        });

        const makeRes = (): { record: { code: number; body?: unknown } } => {
            const record: { code: number; body?: unknown } = { code: 0 };
            const res = {
                record,
                status(code: number): unknown { record.code = code; return res; },
                sendStatus(code: number): void { record.code = code; },
                type(): unknown { return res; },
                send(): void { /* body ignored */ },
                json(body: unknown): void { record.body = body; },
            };
            return res;
        };

        const expirePreview = (registry: QaapDevPreviewPortRegistry, record: QaapDevPreviewRecord): void => {
            const previews = (registry as unknown as { previews: Map<string, QaapDevPreviewRecord> }).previews;
            const claims = (registry as unknown as { claims: Map<number, { ownerLogin: string; at: number }> }).claims;
            previews.set(record.previewId, { ...record, touchedAt: Date.now() - 31 * 60_000 });
            claims.set(record.port, { ownerLogin: record.ownerLogin, at: Date.now() - 31 * 60_000 });
        };

        it('refuses replacing an expired identity while its previous port still listens', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const identity = { projectId: 'project', conversationId: 'conv', runId: 'run' };
            const first = registry.register({
                ...resolveQaapPreviewIdentity(identity),
                ownerLogin: 'alice',
                root: '/workspace/repos/users/alice/site',
                port: 4173,
            })!;
            expirePreview(registry, first);

            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('bob', registry);
            ep.listening = true;
            const res = makeRes();
            await ep.exposeHandleClaim(claimReq(5173, identity), res);

            expect(res.record.code).to.equal(409);
            expect(ep.probedPorts).to.deep.equal([4173]);
            expect(registry.staleOwnerOf(4173)).to.equal('alice');
            expect(registry.ownerOf(5173)).to.equal(undefined);
        });

        it('replaces an expired identity only after its previous port is free and rotates its capability', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const identity = { projectId: 'project', conversationId: 'conv', runId: 'run' };
            const resolved = resolveQaapPreviewIdentity(identity);
            const first = registry.register({
                ...resolved,
                ownerLogin: 'alice',
                root: '/workspace/repos/users/alice/site',
                port: 4173,
            })!;
            expirePreview(registry, first);

            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('bob', registry);
            const res = makeRes();
            await ep.exposeHandleClaim(claimReq(5173, identity), res);

            expect(res.record.code).to.equal(200);
            expect(ep.probedPorts).to.deep.equal([4173]);
            const replacement = registry.getForOwner(resolved.previewId, 'bob')!;
            expect(replacement.port).to.equal(5173);
            expect(replacement.accessToken).not.to.equal(first.accessToken);
            expect(registry.ownerOf(4173)).to.equal(undefined);
        });

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

        it('allocates distinct ports atomically for two projects of the same user', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            const firstRes = makeRes();
            const secondRes = makeRes();

            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/project-a',
                projectId: 'project-a',
                processId: 'process-a',
            }, 'file:///workspace/alice/project-a'), firstRes);
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/project-b',
                projectId: 'project-b',
                processId: 'process-b',
            }, 'file:///workspace/alice/project-b'), secondRes);

            expect(firstRes.record.code).to.equal(200);
            expect((firstRes.record.body as { port: number }).port).to.equal(5173);
            expect(secondRes.record.code).to.equal(200);
            expect((secondRes.record.body as { port: number }).port).to.equal(5174);
        });

        it('keeps two users in distinct preview identities and ports', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            const aliceRes = makeRes();
            ep.setClaimFakes('alice', registry);
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/site',
                projectId: 'site',
                processId: 'process-a',
            }, 'file:///workspace/alice/site'), aliceRes);
            const bobRes = makeRes();
            ep.setClaimFakes('bob', registry);
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/bob/site',
                projectId: 'site',
                processId: 'process-b',
            }, 'file:///workspace/bob/site'), bobRes);

            const alice = aliceRes.record.body as { previewId: string; port: number };
            const bob = bobRes.record.body as { previewId: string; port: number };
            expect(bob.port).to.equal(5174);
            expect(bob.previewId).not.to.equal(alice.previewId);
            expect(registry.getForOwner(alice.previewId, 'bob')).to.equal(undefined);
            expect(registry.getForOwner(bob.previewId, 'alice')).to.equal(undefined);
        });

        it('returns one stable preview to two sections claiming the same process', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            const identity = {
                workspaceId: 'file:///workspace/alice/project-a',
                projectId: 'ws:file:///workspace/alice/project-a',
                processId: 'process-a',
            };
            const firstRes = makeRes();
            const secondRes = makeRes();
            const root = 'file:///workspace/alice/project-a';
            await ep.exposeHandleClaim(claimReq(5173, { ...identity, conversationId: 'conversation-a' }, root), firstRes);
            await ep.exposeHandleClaim(claimReq(5999, {
                ...identity,
                projectId: 'github:alice/project-a',
                conversationId: 'conversation-b',
            }, root), secondRes);

            expect(secondRes.record.body).to.deep.equal(firstRes.record.body);
            expect(registry.records()).to.have.length(1);
            expect(registry.records()[0].projectId).to.equal(root);
        });

        it('skips a previously occupied unregistered port instead of adopting another app', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            ep.listeningPorts.add(8080);
            const res = makeRes();
            await ep.exposeHandleClaim(claimReq(8080, {
                workspaceId: 'file:///workspace/alice/vamello',
                projectId: 'vamello',
                processId: 'process-vamello',
            }), res);

            expect(res.record.code).to.equal(200);
            expect((res.record.body as { port: number }).port).to.equal(8081);
            expect(ep.probedPorts).to.include(8080);
        });

        it('refuses to adopt an unregistered listener through the legacy claim path', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            ep.listeningPorts.add(8080);
            const res = makeRes();
            await ep.exposeHandleClaim(claimReq(8080), res);
            expect(res.record.code).to.equal(409);
            expect(registry.ownerOf(8080)).to.equal(undefined);
        });

        it('allows only the owner to release a process preview', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            const created = makeRes();
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/site',
                projectId: 'site',
                processId: 'process-a',
            }), created);
            const previewId = (created.record.body as { previewId: string }).previewId;

            ep.setClaimFakes('bob', registry);
            const denied = makeRes();
            ep.exposeHandleRelease({ body: { previewId } }, denied);
            expect(denied.record.code).to.equal(404);
            expect(registry.getForOwner(previewId, 'alice')).not.to.equal(undefined);

            ep.setClaimFakes('alice', registry);
            const released = makeRes();
            ep.exposeHandleRelease({ body: { previewId } }, released);
            expect(released.record.code).to.equal(204);
            expect(registry.get(previewId)).to.equal(undefined);
        });

        it('reaps a stopped durable process despite UI polling but retains a responding one', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            const stoppedRes = makeRes();
            const liveRes = makeRes();
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/stopped', projectId: 'stopped', processId: 'process-stopped',
            }, 'file:///workspace/alice/stopped'), stoppedRes);
            await ep.exposeHandleClaim(claimReq(5174, {
                workspaceId: 'file:///workspace/alice/live', projectId: 'live', processId: 'process-live',
            }, 'file:///workspace/alice/live'), liveRes);
            const stoppedId = (stoppedRes.record.body as { previewId: string }).previewId;
            const liveId = (liveRes.record.body as { previewId: string }).previewId;
            const previews = (registry as unknown as { previews: Map<string, QaapDevPreviewRecord> }).previews;
            const now = Date.now();
            previews.set(stoppedId, {
                ...previews.get(stoppedId)!,
                claimedAt: now - 6 * 60_000,
                touchedAt: now,
            });
            previews.set(liveId, {
                ...previews.get(liveId)!,
                claimedAt: now - 6 * 60_000,
                touchedAt: now,
            });
            ep.listeningPorts.add(5174);

            await ep.exposeReapStoppedPreviews();

            expect(registry.get(stoppedId)).to.equal(undefined);
            expect(registry.get(liveId)).not.to.equal(undefined);
        });

        it('supersedes the previous preview of the same project when its dev server is relaunched', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            const firstRes = makeRes();
            const secondRes = makeRes();

            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/vamello',
                projectId: 'vamello',
                processId: 'process-run-1',
            }, 'file:///workspace/alice/vamello'), firstRes);
            // Same project, new dev-server run (fresh processId) — must retire the old record
            // instead of leaking a second registration + held port (observed on the VPS: the same
            // project held ports 3000 AND 3001).
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/vamello',
                projectId: 'vamello',
                processId: 'process-run-2',
            }, 'file:///workspace/alice/vamello'), secondRes);

            const first = firstRes.record.body as { previewId: string };
            const second = secondRes.record.body as { previewId: string; port: number };
            expect(second.previewId).to.not.equal(first.previewId);
            expect(second.port).to.equal(5173);
            expect(registry.get(first.previewId)).to.equal(undefined);
            expect(registry.records()).to.have.length(1);
        });

        it('reattaches a restored section to the live project process instead of allocating an unused port', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            const firstRes = makeRes();
            const restoredSectionRes = makeRes();

            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/vamello',
                projectId: 'vamello',
                processId: 'process-run-original',
            }, 'file:///workspace/alice/vamello'), firstRes);
            ep.listeningPorts.add(5173);
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/vamello',
                projectId: 'vamello',
                processId: 'stale-restored-terminal-id',
            }, 'file:///workspace/alice/vamello'), restoredSectionRes);

            expect(restoredSectionRes.record.code).to.equal(200);
            expect(restoredSectionRes.record.body).to.deep.include({
                previewId: (firstRes.record.body as { previewId: string }).previewId,
                port: 5173,
            });
            expect(registry.records()).to.have.length(1);
        });

        it('does not supersede a different project of the same user', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/project-a',
                projectId: 'project-a',
                processId: 'process-a',
            }, 'file:///workspace/alice/project-a'), makeRes());
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/project-b',
                projectId: 'project-b',
                processId: 'process-b',
            }, 'file:///workspace/alice/project-b'), makeRes());
            expect(registry.records()).to.have.length(2);
        });

        it('reaps a record whose OS process is dead even while its port still answers', async () => {
            const { QaapDevPreviewPortRegistry: Registry } = await import('./qaap-dev-preview-port-registry');
            const { spawnSync } = await import('child_process');
            const registry = new Registry();
            const ep = new ClaimTestEndpoint();
            ep.setClaimFakes('alice', registry);
            const res = makeRes();
            await ep.exposeHandleClaim(claimReq(5173, {
                workspaceId: 'file:///workspace/alice/site', projectId: 'site', processId: 'process-a',
            }), res);
            const previewId = (res.record.body as { previewId: string }).previewId;
            // A pid that certainly exited: spawnSync completes before returning.
            const deadPid = spawnSync(process.execPath, ['-e', '0']).pid;
            registry.attachProcess(previewId, 'alice', deadPid);
            // Port still answers (recycled by another process) and the record is inside the grace
            // window — the dead pid must still trigger an immediate reap.
            ep.listeningPorts.add(5173);

            await ep.exposeReapStoppedPreviews();

            expect(registry.get(previewId)).to.equal(undefined);
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

    describe('identity WebSocket ownership', () => {
        const makeSocket = (): { writes: string[]; destroyed: boolean; write(value: string): void; destroy(): void } => ({
            writes: [],
            destroyed: false,
            write(value: string): void { this.writes.push(value); },
            destroy(): void { this.destroyed = true; },
        });

        it('rejects another authenticated user with an explicit 403 instead of hanging', () => {
            const ep = new TestQaapDevPreviewEndpoint();
            const mutable = ep as unknown as { auth: unknown; portRegistry: unknown };
            mutable.auth = {
                authenticate: () => ({ kind: 'authenticated', userLogin: 'bob', session: {}, sessionId: 's' }),
                resolveUserLogin: () => 'bob',
            };
            mutable.portRegistry = { getForOwner: () => undefined };
            const socket = makeSocket();
            ep.exposeHandleWebSocketUpgrade({
                url: '/qaap-preview/u-alice-w-site-p-site-x-run-abc1234/@vite/client',
                headers: {},
            }, socket);
            expect(socket.writes.join('')).to.contain('403 Forbidden');
            expect(socket.destroyed).to.equal(true);
        });

        it('rejects an anonymous identity WebSocket with 401', () => {
            const ep = new TestQaapDevPreviewEndpoint();
            ep.setFakes({ kind: 'unauthorized' }, undefined);
            const socket = makeSocket();
            ep.exposeHandleWebSocketUpgrade({
                url: '/qaap-preview/u-alice-w-site-p-site-x-run-abc1234/@vite/client',
                headers: {},
            }, socket);
            expect(socket.writes.join('')).to.contain('401 Unauthorized');
            expect(socket.destroyed).to.equal(true);
        });
    });
});

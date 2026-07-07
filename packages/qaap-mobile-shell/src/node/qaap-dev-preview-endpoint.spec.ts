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

    setFakes(ctx: QaapGithubAuthContext, claimedOwner: string | undefined): void {
        const mutable = this as unknown as { auth: QaapGithubAuthGuard; portRegistry: QaapDevPreviewPortRegistry };
        mutable.auth = {
            authenticate: () => ctx,
            resolveUserLogin: (c: QaapGithubAuthContext) => (c.kind === 'authenticated' || c.kind === 'skip' ? c.userLogin : undefined),
        } as unknown as QaapGithubAuthGuard;
        mutable.portRegistry = { ownerOf: () => claimedOwner } as unknown as QaapDevPreviewPortRegistry;
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
    });
});

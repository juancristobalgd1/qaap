// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapProjectBootstrapServiceContext } from './qaap-project-bootstrap-service-context';

/**
 * Another app already answers on the project's expected port (a second project on :3000). The
 * attach must neither adopt it nor claim it: the legacy claim makes the backend allocator adopt an
 * owner-claimed listener into this project's next reservation, which served the foreign app as this
 * preview and relaunched this project's own server in a loop.
 */
describe('QaapProjectBootstrapService attach to an existing server', () => {
    let disableJSDOM: (() => void) | undefined;
    let timeline: typeof import('./qaap-project-bootstrap-service-timeline');
    let fetchStub: sinon.SinonStub | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        const frameModule = require.resolve('@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame');
        require.cache[frameModule] = {
            id: frameModule,
            filename: frameModule,
            loaded: true,
            exports: { syncQaapMiniBrowserPreviewSuspension: () => undefined },
        } as NodeJS.Module;
        timeline = require('./qaap-project-bootstrap-service-timeline');
    });

    after(() => disableJSDOM?.());

    afterEach(() => {
        fetchStub?.restore();
        fetchStub = undefined;
    });

    /** Answers the probe endpoint with `bodies` in order (the last one repeats). */
    const stubProbe = (...bodies: object[]): sinon.SinonStub => {
        let call = 0;
        const target = globalThis as unknown as { fetch: typeof fetch };
        if (typeof target.fetch !== 'function') {
            target.fetch = (async () => { throw new Error('unstubbed'); }) as typeof fetch;
        }
        fetchStub = sinon.stub(target, 'fetch').callsFake(async () => {
            const body = bodies[Math.min(call++, bodies.length - 1)];
            return { ok: true, json: async () => body } as Response;
        });
        return fetchStub;
    };

    const makeCtx = (): { ctx: QaapProjectBootstrapServiceContext; claims: number[]; recorded: number[] } => {
        const claims: number[] = [];
        const recorded: number[] = [];
        const ctx = {
            _previewUrl: undefined,
            _portConflictPort: undefined,
            previewPortClaimService: { claim: async (port: number) => { claims.push(port); return { kind: 'claimed' }; } },
            probeBelongsToActiveProject: (projectId: string | undefined) => projectId === undefined || projectId === 'file:///workspace/app',
            adoptExistingPreviewIdentity: () => undefined,
            resolveDevPlan: () => undefined,
            recordForwardedPort: (port: number) => { recorded.push(port); },
        };
        return { ctx: ctx as unknown as QaapProjectBootstrapServiceContext, claims, recorded };
    };

    it('refuses a ready listener with no registered identity, and never claims it', async () => {
        stubProbe({ ready: true, previewUrl: '/qaap-dev/3000/' });
        const { ctx, claims, recorded } = makeCtx();
        expect(await timeline.tryAttachToExistingServerExtracted(ctx, [3000])).to.equal(false);
        expect(claims).to.deep.equal([]);
        expect(recorded).to.deep.equal([]);
    });

    it('refuses a listener registered to another project after refreshing the gate', async () => {
        stubProbe({ ready: true, previewUrl: '/qaap-preview/x/', previewId: 'x', projectId: 'file:///workspace/other' });
        const { ctx, claims, recorded } = makeCtx();
        expect(await timeline.tryAttachToExistingServerExtracted(ctx, [3000])).to.equal(false);
        expect(claims).to.deep.equal([3000]);
        expect(recorded).to.deep.equal([]);
    });

    it('adopts this project\'s own registered server without claiming first', async () => {
        stubProbe({ ready: true, previewUrl: '/qaap-preview/p/', previewId: 'p', projectId: 'file:///workspace/app' });
        const { ctx, claims, recorded } = makeCtx();
        expect(await timeline.tryAttachToExistingServerExtracted(ctx, [3001])).to.equal(true);
        expect(claims).to.deep.equal([]);
        expect(recorded).to.deep.equal([3001]);
    });

    it('re-claims an own server whose expired claim made the probe fail closed', async () => {
        stubProbe(
            { ready: false, previewUrl: '' },
            { ready: true, previewUrl: '/qaap-preview/p/', previewId: 'p', projectId: 'file:///workspace/app' },
        );
        const { ctx, claims, recorded } = makeCtx();
        expect(await timeline.tryAttachToExistingServerExtracted(ctx, [3001])).to.equal(true);
        expect(claims).to.deep.equal([3001]);
        expect(recorded).to.deep.equal([3001]);
    });

    it('skips the foreign expected port and attaches to the project\'s own port in the same sweep', async () => {
        const fetchCalls = stubProbe({});
        fetchCalls.callsFake(async (input: RequestInfo | URL) => {
            const port = String(input).split('/').pop();
            const body = port === '3000'
                ? { ready: true, previewUrl: '/qaap-dev/3000/' }
                : { ready: true, previewUrl: '/qaap-preview/p/', previewId: 'p', projectId: 'file:///workspace/app' };
            return { ok: true, json: async () => body } as Response;
        });
        const { ctx, claims, recorded } = makeCtx();
        expect(await timeline.tryAttachToExistingServerExtracted(ctx, [3000, 3001])).to.equal(true);
        expect(claims).to.deep.equal([]);
        expect(recorded).to.deep.equal([3001]);
    });
});

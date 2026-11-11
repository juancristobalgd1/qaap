// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { QaapProjectBootstrapServiceContext } from './qaap-project-bootstrap-service-context';

// A server that prints no recognisable URL and binds its port late (a Theia backend) must still be
// attached: the run used to stay `starting` forever after the two early attach attempts.
describe('QaapProjectBootstrapService dev preview fallback polling', () => {
    let disableJSDOM: (() => void) | undefined;
    let timeline: typeof import('./qaap-project-bootstrap-service-timeline');
    let clock: sinon.SinonFakeTimers;

    before(async () => {
        disableJSDOM = enableJSDOM();
        timeline = await import('./qaap-project-bootstrap-service-timeline');
    });
    after(() => disableJSDOM?.());
    beforeEach(() => {
        clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    });
    afterEach(() => clock.restore());

    const context = (listeningAfterAttempt: number): { ctx: QaapProjectBootstrapServiceContext; attempts: () => number } => {
        let attempts = 0;
        const state: Record<string, unknown> = {
            _phase: 'starting',
            _previewUrl: undefined,
            devRunGeneration: 7,
            _forwardedPorts: [],
            devPreviewFallbackTimers: [],
            tryAttachToExistingServer: async (): Promise<boolean> => {
                attempts++;
                if (attempts >= listeningAfterAttempt) {
                    state._previewUrl = 'http://localhost:3107/qaap-dev/3001/';
                    state._phase = 'running';
                    return true;
                }
                return false;
            },
        };
        return { ctx: state as unknown as QaapProjectBootstrapServiceContext, attempts: () => attempts };
    };

    it('keeps attaching while the run is starting until the late server answers', async () => {
        const { ctx, attempts } = context(6);
        timeline.scheduleDevPreviewFallbackExtracted(ctx, 7, 3001);
        await clock.tickAsync(60_000);
        expect(attempts()).to.equal(6);
        expect(ctx._phase).to.equal('running');
    });

    it('stops once the run is superseded', async () => {
        const { ctx, attempts } = context(Number.POSITIVE_INFINITY);
        timeline.scheduleDevPreviewFallbackExtracted(ctx, 7, 3001);
        await clock.tickAsync(9_000);
        const before = attempts();
        (ctx as unknown as { devRunGeneration: number }).devRunGeneration = 8;
        await clock.tickAsync(30_000);
        expect(before).to.be.greaterThan(2);
        expect(attempts()).to.equal(before);
    });

    it('gives up after the compile grace', async () => {
        const { ctx, attempts } = context(Number.POSITIVE_INFINITY);
        timeline.scheduleDevPreviewFallbackExtracted(ctx, 7, 3001);
        await clock.tickAsync(240_000 + 10_000);
        const atGrace = attempts();
        await clock.tickAsync(60_000);
        expect(attempts()).to.equal(atGrace);
    });
});

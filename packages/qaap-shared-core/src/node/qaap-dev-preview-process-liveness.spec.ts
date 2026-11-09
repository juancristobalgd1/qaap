// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
import {
    classifyQaapPreviewProbeState,
    probeQaapPreviewPidLiveness,
    releaseStoppedPreviewExtracted,
} from './qaap-dev-preview-process-liveness';
import { PREVIEW_RESERVATION_START_GRACE_MS } from './qaap-dev-preview-endpoint';
import { reapStoppedPreviewsExtracted } from './qaap-dev-preview-endpoint-streaming';
import type { QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';

function errnoError(code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(code), { code });
}

describe('probeQaapPreviewPidLiveness', () => {
    it('reports a pid that answers signal 0 as alive', () => {
        expect(probeQaapPreviewPidLiveness(4242, () => true)).to.equal('alive');
    });

    it('reports ESRCH as dead', () => {
        expect(probeQaapPreviewPidLiveness(4242, () => { throw errnoError('ESRCH'); })).to.equal('dead');
    });

    it('reports EPERM as alive: the process exists but is not ours to signal', () => {
        expect(probeQaapPreviewPidLiveness(4242, () => { throw errnoError('EPERM'); })).to.equal('alive');
    });

    it('reports any other failure as unknown, never as dead', () => {
        expect(probeQaapPreviewPidLiveness(4242, () => { throw errnoError('EINVAL'); })).to.equal('unknown');
    });
});

describe('classifyQaapPreviewProbeState', () => {
    it('is ready as soon as the server answers, whatever the process says', () => {
        expect(classifyQaapPreviewProbeState({ ready: true, withinStartGrace: false, liveness: 'dead' })).to.equal('ready');
    });

    it('classifies a dead pid as stopped at once, even inside the start grace (persisted record after a backend restart)', () => {
        expect(classifyQaapPreviewProbeState({ ready: false, withinStartGrace: true, liveness: 'dead' })).to.equal('stopped');
    });

    it('keeps a slow server with a live process booting after the start grace, never stopped', () => {
        expect(classifyQaapPreviewProbeState({ ready: false, withinStartGrace: false, liveness: 'alive' })).to.equal('booting');
    });

    it('falls back to the start grace when no pid describes the claim', () => {
        expect(classifyQaapPreviewProbeState({ ready: false, withinStartGrace: true, liveness: 'unknown' })).to.equal('booting');
        expect(classifyQaapPreviewProbeState({ ready: false, withinStartGrace: false, liveness: 'unknown' })).to.equal('stopped');
    });
});

describe('releaseStoppedPreviewExtracted', () => {
    const record = { previewId: 'p-1', ownerLogin: 'alice', osProcessId: 4242, port: 5173 };

    function ctxWith(liveness: 'alive' | 'dead' | 'unknown'): { ctx: Parameters<typeof releaseStoppedPreviewExtracted>[0]; releasePreview: sinon.SinonStub } {
        const releasePreview = sinon.stub().returns(true);
        return {
            ctx: { previewPidLiveness: () => liveness, portRegistry: { releasePreview } },
            releasePreview,
        };
    }

    it('keeps the registration and its port while the process is still alive', () => {
        const { ctx, releasePreview } = ctxWith('alive');
        const warn = sinon.stub(console, 'warn');
        try {
            expect(releaseStoppedPreviewExtracted(ctx, record)).to.equal(false);
            expect(releasePreview.called).to.equal(false);
        } finally {
            warn.restore();
        }
    });

    it('releases the registration once the process is confirmed dead', () => {
        const { ctx, releasePreview } = ctxWith('dead');
        expect(releaseStoppedPreviewExtracted(ctx, record, { keepAccessToken: true })).to.equal(true);
        expect(releasePreview.calledOnceWith('p-1', 'alice', { keepAccessToken: true })).to.equal(true);
    });

    it('releases a record that no pid describes', () => {
        const { ctx, releasePreview } = ctxWith('unknown');
        expect(releaseStoppedPreviewExtracted(ctx, { previewId: 'p-2', ownerLogin: 'bob' })).to.equal(true);
        expect(releasePreview.calledOnce).to.equal(true);
    });
});

describe('reapStoppedPreviewsExtracted', () => {
    const CLAIMED_LONG_AGO = Date.now() - PREVIEW_RESERVATION_START_GRACE_MS - 60_000;

    function reaperContext(
        records: Array<{ previewId: string; ownerLogin: string; port: number; claimedAt: number; osProcessId?: number }>,
        liveness: Record<string, 'alive' | 'dead' | 'unknown'>,
        probeState: 'down' | 'busy' | 'ready',
    ): { ctx: QaapDevPreviewEndpointContext; releasePreview: sinon.SinonStub } {
        const releasePreview = sinon.stub().returns(true);
        const ctx = {
            reaperRunning: false,
            portRegistry: {
                sweepExpiredClaims: (): number[] => [],
                records: () => records,
                releasePreview,
            },
            previewPidLiveness: (record: { previewId?: string }) => liveness[record.previewId!] ?? 'unknown',
            isPreviewProcessDead: (record: { previewId?: string }) => liveness[record.previewId!] === 'dead',
            probeLocalDevServerState: async (): Promise<string> => probeState,
        } as unknown as QaapDevPreviewEndpointContext;
        return { ctx, releasePreview };
    }

    it('never releases a live process whose port is silent past the start grace', async () => {
        const { ctx, releasePreview } = reaperContext(
            [{ previewId: 'live', ownerLogin: 'alice', port: 5173, claimedAt: CLAIMED_LONG_AGO, osProcessId: 4242 }],
            { live: 'alive' },
            'down',
        );

        await reapStoppedPreviewsExtracted(ctx);

        expect(releasePreview.called).to.equal(false);
    });

    it('releases a record whose process is dead', async () => {
        const { ctx, releasePreview } = reaperContext(
            [{ previewId: 'dead', ownerLogin: 'alice', port: 5174, claimedAt: Date.now(), osProcessId: 4343 }],
            { dead: 'dead' },
            'ready',
        );

        await reapStoppedPreviewsExtracted(ctx);

        expect(releasePreview.calledOnceWith('dead', 'alice')).to.equal(true);
    });

    it('releases a record with no pid whose port is silent past the start grace', async () => {
        const { ctx, releasePreview } = reaperContext(
            [{ previewId: 'legacy', ownerLogin: 'alice', port: 5175, claimedAt: CLAIMED_LONG_AGO }],
            {},
            'down',
        );

        await reapStoppedPreviewsExtracted(ctx);

        expect(releasePreview.calledOnceWith('legacy', 'alice')).to.equal(true);
    });
});

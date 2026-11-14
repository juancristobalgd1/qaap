// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import URI from '@theia/core/lib/common/uri';
import type { QaapProjectBootstrapServiceContext } from './qaap-project-bootstrap-service-context';

/** Poll ticks the transcript offer refresh fires while a preview is watched (~900 ms each). */
const POLL_TICKS = 10;

const ROOT = URI.fromFilePath('/workspace/app');
const OTHER_ROOT = URI.fromFilePath('/workspace/other');
const DESCRIPTOR = { name: 'app', rootUri: ROOT, nodeModulesPresent: true, apps: [], packageManager: 'npm' };

interface FakeClient {
    readonly ctx: QaapProjectBootstrapServiceContext;
    /** Session resets, i.e. `resetBootstrapSessionForWorkspace` calls (the `[qaap-bootstrap] release` log). A reset drops the local claim and disposes the root's dev terminal. */
    readonly resets: string[];
    /** Dev terminals disposed by a reset. */
    readonly disposedTerminals: string[];
    readonly phases: string[];
}

/** Bootstrap session with a live dev run for ROOT, wired to counters instead of real services. */
function fakeClient(phase: string, currentRoot: URI = ROOT): FakeClient {
    const resets: string[] = [];
    const disposedTerminals: string[] = [];
    const phases: string[] = [];
    const state: Record<string, unknown> & { devRunGeneration: number; installGeneration: number } = {
        _phase: phase,
        _descriptor: { ...DESCRIPTOR, rootUri: currentRoot },
        _error: undefined,
        _previewUrl: 'http://127.0.0.1:5173/',
        devRunGeneration: 1,
        installGeneration: 1,
        refreshGeneration: 0,
        deferredWorkspaceRefresh: undefined,
        deferredWorkspaceRefreshTimer: undefined,
        hubPinnedWorkspaceRoot: undefined,
        activeProjectId: undefined,
        activePreviewConversationId: 'conversation-1',
        activePreviewClaim: { previewId: 'preview-1' },
        devTerminalByConversationId: new Map([
            ['conversation-1', { terminal: { id: 'term-1' }, listener: { dispose: () => undefined }, rootKey: ROOT.toString() }],
        ]),
        previewClaimByConversation: new Map([['conversation-1', { previewId: 'preview-1' }]]),
        resetBootstrapSessionForWorkspace: (reason: string, rootKey?: string) => {
            resets.push(reason);
            if (rootKey === ROOT.toString()) {
                disposedTerminals.push('term-1');
                (state.devTerminalByConversationId as Map<string, unknown>).clear();
                state.activePreviewClaim = undefined;
                state.devRunGeneration++;
                state.installGeneration++;
            }
        },
        clearForwardedPorts: () => undefined,
        detector: { detect: async () => undefined },
        getMissingDescriptorHint: async () => 'No runnable app.',
        readPersisted: () => undefined,
        scheduleDevPreviewWarmup: () => undefined,
        startDevPreviewHealthMonitor: () => undefined,
        cancelDevPreviewHealthMonitor: () => undefined,
        stateEmitter: { fire: () => undefined },
        buildStateChange: () => ({}),
        syncHubSession: () => undefined,
        setPhase: (next: string) => {
            phases.push(next);
            state._phase = next;
        },
    };
    return {
        ctx: state as unknown as QaapProjectBootstrapServiceContext,
        resets,
        disposedTerminals,
        phases,
    };
}

describe('QaapProjectBootstrapService refresh churn', () => {
    let disableJSDOM: (() => void) | undefined;
    let streaming: typeof import('./qaap-project-bootstrap-service-streaming');

    before(() => {
        disableJSDOM = enableJSDOM();
        const frameModule = require.resolve('@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame');
        require.cache[frameModule] = {
            id: frameModule,
            filename: frameModule,
            loaded: true,
            exports: { syncQaapMiniBrowserPreviewSuspension: () => undefined },
        } as NodeJS.Module;
        streaming = require('./qaap-project-bootstrap-service-streaming');
    });

    after(() => disableJSDOM?.());

    it('never releases the claim of a live dev server when the same root is refreshed on every poll tick', async () => {
        const client = fakeClient('running');

        for (let tick = 0; tick < POLL_TICKS; tick++) {
            await streaming.refreshFromRootExtracted(client.ctx, ROOT);
        }

        expect(client.resets).to.deep.equal([]);
        expect(client.disposedTerminals).to.deep.equal([]);
        expect(client.phases).to.deep.equal([]);
        expect(client.ctx._phase).to.equal('running');
    });

    it('keeps a ready-to-run session whose dev terminal still belongs to the same root', async () => {
        const client = fakeClient('ready-to-run');

        for (let tick = 0; tick < POLL_TICKS; tick++) {
            await streaming.refreshFromRootExtracted(client.ctx, ROOT);
        }

        expect(client.resets).to.deep.equal([]);
        expect(client.disposedTerminals).to.deep.equal([]);
    });

    it('resets once for a real root change, then no-ops on repeats while that root runs', async () => {
        const client = fakeClient('running');

        // The real root change: one reset, detection settles to idle (no runnable app under OTHER_ROOT).
        await streaming.refreshFromRootExtracted(client.ctx, OTHER_ROOT);
        expect(client.resets).to.deep.equal(['refreshFromRoot']);

        // The dev run for OTHER_ROOT starts; the poll ticks then refresh the same root.
        client.ctx._descriptor = { ...DESCRIPTOR, rootUri: OTHER_ROOT } as unknown as QaapProjectBootstrapServiceContext['_descriptor'];
        client.ctx.setPhase('running');
        for (let tick = 0; tick < POLL_TICKS; tick++) {
            await streaming.refreshFromRootExtracted(client.ctx, OTHER_ROOT);
        }

        expect(client.resets).to.deep.equal(['refreshFromRoot']);
    });

    it('still re-detects a same-root session that has no live dev run', async () => {
        const client = fakeClient('idle');
        client.ctx._descriptor = undefined;

        await streaming.refreshFromRootExtracted(client.ctx, ROOT);

        expect(client.resets).to.deep.equal(['refreshFromRoot']);
        expect(client.phases).to.deep.equal(['idle']);
    });
});

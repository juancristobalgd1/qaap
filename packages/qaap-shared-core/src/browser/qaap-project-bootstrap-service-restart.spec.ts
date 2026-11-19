// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import URI from '@theia/core/lib/common/uri';
import type { QaapDevPreviewProbeResponse } from '../common/qaap-dev-preview';
import type { QaapProjectBootstrapServiceContext } from './qaap-project-bootstrap-service-context';

const PLAN = { command: 'npm run start', cwd: URI.fromFilePath('/ws/qa-e2e-todo'), expectedPort: 3001, kind: 'node' as const };

describe('restartManagedDevServerExtracted', () => {
    let disableJSDOM: (() => void) | undefined;
    let restart: typeof import('./qaap-project-bootstrap-service-restart').restartManagedDevServerExtracted;
    let timeline: typeof import('./qaap-project-bootstrap-service-timeline');

    before(() => {
        disableJSDOM = enableJSDOM();
        const frameModule = require.resolve('@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame');
        require.cache[frameModule] = {
            id: frameModule,
            filename: frameModule,
            loaded: true,
            exports: { syncQaapMiniBrowserPreviewSuspension: () => undefined },
        } as NodeJS.Module;
        ({ restartManagedDevServerExtracted: restart } = require('./qaap-project-bootstrap-service-restart'));
        timeline = require('./qaap-project-bootstrap-service-timeline');
    });

    after(() => disableJSDOM?.());

    function runningCtx(): QaapProjectBootstrapServiceContext & { calls: string[]; previewUrlAtStart?: string | null } {
        const calls: string[] = [];
        const ctx = {
            calls,
            _phase: 'running',
            _descriptor: { rootUri: PLAN.cwd, name: 'qa-e2e-todo' },
            _previewUrl: 'http://84224956.localhost:52136/',
            _previewReadiness: 'transport_ready',
            _previewWaitTimedOut: false,
            _lastPort: 3001,
            activePreviewClaim: { previewId: 'u-dev-x-todo', previewUrl: 'http://84224956.localhost:52136/', port: 3001 },
            devTerminal: { isDisposed: false },
            resolveDevPlan: () => PLAN,
            cancelDevPreviewHealthMonitor: () => { calls.push('cancelHealth'); },
            cleanupDevTerminal: () => { calls.push('cleanupTerminal'); ctx.devTerminal = undefined; },
            delay: async () => undefined,
            startDevServer: async () => {
                calls.push('startDevServer');
                ctx.previewUrlAtStart = ctx._previewUrl ?? null;
                // The real start first tries to attach; a remembered URL made it return at once.
                if (await timeline.tryAttachToExistingServerExtracted(ctx as unknown as QaapProjectBootstrapServiceContext, [])) {
                    calls.push('attachedWithoutSpawning');
                }
            },
        } as unknown as QaapProjectBootstrapServiceContext & { calls: string[]; previewUrlAtStart?: string | null; devTerminal: unknown; _previewUrl?: string };
        return ctx;
    }

    it('forgets the stopped server URL before starting again, so the start spawns instead of "attaching"', async () => {
        const ctx = runningCtx();
        const probes: number[] = [];
        const stopped = async (port: number): Promise<QaapDevPreviewProbeResponse> => {
            probes.push(port);
            return { ready: false } as QaapDevPreviewProbeResponse;
        };
        expect(await restart(ctx, stopped)).to.equal(true);
        expect(ctx.calls).to.deep.equal(['cancelHealth', 'cleanupTerminal', 'startDevServer']);
        expect(ctx.previewUrlAtStart).to.equal(null);
        expect(ctx._previewReadiness).to.equal(undefined);
        expect(probes).to.deep.equal([3001]);
    });

    it('waits until the old server released its port', async () => {
        const ctx = runningCtx();
        let answers = 3;
        const dying = async (): Promise<QaapDevPreviewProbeResponse> =>
            ({ ready: answers-- > 0 } as QaapDevPreviewProbeResponse);
        await restart(ctx, dying);
        expect(answers).to.equal(-1);
        expect(ctx.calls[ctx.calls.length - 1]).to.equal('startDevServer');
    });

    it('never touches a preview Qaap did not start', async () => {
        const patches: Record<string, unknown>[] = [{ _phase: 'starting' }, { devTerminal: undefined }, { devTerminal: { isDisposed: true } }, { resolveDevPlan: () => undefined }];
        for (const patch of patches) {
            const ctx = runningCtx();
            Object.assign(ctx, patch);
            expect(await restart(ctx, async () => ({ ready: false } as QaapDevPreviewProbeResponse))).to.equal(false);
            expect(ctx.calls).to.deep.equal([]);
            expect(ctx._previewUrl).to.equal('http://84224956.localhost:52136/');
        }
    });
});

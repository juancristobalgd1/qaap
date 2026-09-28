// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import URI from '@theia/core/lib/common/uri';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import type { QaapProjectBootstrapServiceContext } from './qaap-project-bootstrap-service-context';
import { QAAP_PREVIEW_TERMINAL_KIND } from './qaap-preview-terminal-lifecycle';

const PROJECT_CWD = '/workspace/app';
const PLAN = { command: 'npm run dev', cwd: URI.fromFilePath(PROJECT_CWD), expectedPort: 5173, kind: 'node-vite' as const };

interface FakeTerminal {
    readonly kind: string;
    readonly title: { label: string };
    readonly lastCwd: URI;
    isDisposed: boolean;
    readonly cwd: Promise<URI>;
    readonly processInfo: Promise<{ arguments: string[] }>;
}

function fakeTerminal(label: string, cwdResolved?: Promise<URI>): FakeTerminal {
    const cwd = URI.fromFilePath(PROJECT_CWD);
    return {
        kind: QAAP_PREVIEW_TERMINAL_KIND,
        title: { label },
        lastCwd: cwd,
        isDisposed: false,
        cwd: cwdResolved ?? Promise.resolve(cwd),
        processInfo: Promise.resolve({ arguments: [] }),
    };
}

describe('QaapProjectBootstrapService dev run guards', () => {
    let disableJSDOM: (() => void) | undefined;
    let activity: typeof import('./qaap-project-bootstrap-service-activity');

    before(() => {
        disableJSDOM = enableJSDOM();
        // The mini-browser preview frame pulls the whole mini-browser DI graph into a unit test;
        // these guards never reach it, so load the module against a stub.
        const frameModule = require.resolve('@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame');
        require.cache[frameModule] = {
            id: frameModule,
            filename: frameModule,
            loaded: true,
            exports: { syncQaapMiniBrowserPreviewSuspension: () => undefined },
        } as NodeJS.Module;
        activity = require('./qaap-project-bootstrap-service-activity');
    });

    after(() => disableJSDOM?.());

    describe('failDevRun', () => {
        function failingRunContext(overrides: object = {}): { ctx: QaapProjectBootstrapServiceContext; attachCalls: () => number } {
            let attachCalls = 0;
            const state = {
                devRunGeneration: 7,
                devRunCancelledByUser: false,
                failingDevRunId: undefined,
                _phase: 'starting',
                _previewUrl: undefined,
                devOutputTail: '',
                _portConflictDetected: false,
                _portConflictPort: undefined,
                activeDevPortHint: undefined,
                _descriptor: { name: 'app', nodeModulesPresent: true },
                previewAutoRetryAttempts: 0,
                previewAutoRetryTimer: undefined,
                collectProbePorts: () => [5173],
                tryAttachToExistingServer: async () => {
                    attachCalls++;
                    await new Promise(resolve => setTimeout(resolve, 5));
                    return false;
                },
                cleanupDevTerminal: () => undefined,
                releaseActivePreview: () => undefined,
                setPhase(phase: string): void {
                    this._phase = phase;
                },
                ...overrides,
            };
            return { ctx: state as unknown as QaapProjectBootstrapServiceContext, attachCalls: () => attachCalls };
        }

        it('handles process exit and widget close of one dying terminal as a single failure', async () => {
            const { ctx, attachCalls } = failingRunContext();
            // Theia disposes the terminal widget when its process exits: both listeners report.
            await Promise.all([
                activity.failDevRunExtracted(ctx, 'Dev server exited with code 1.', PLAN, 7),
                activity.failDevRunExtracted(ctx, 'Dev server tab closed.', PLAN, 7),
            ]);
            window.clearTimeout(ctx.previewAutoRetryTimer);

            expect(ctx.previewAutoRetryAttempts).to.equal(1);
            expect(attachCalls()).to.equal(1);
            expect(ctx.failingDevRunId).to.equal(undefined);
        });

        it('fails an OOM-killed run immediately instead of probing and auto-retrying it', async () => {
            const { ctx, attachCalls } = failingRunContext({
                devRunOomKillBaseline: Promise.resolve(3),
                readOomKillCount: async () => 4,
                appendDevOutput(this: { devOutputTail: string }, data: string): void {
                    this.devOutputTail += data;
                },
                enrichDevRunError: (message: string) => message,
                toUserFacingDevError: (message: string) => message,
            });
            // Next's parent exits quietly after the kernel kills its server child.
            await activity.failDevRunExtracted(ctx, 'The dev command finished before Qaap could confirm the preview was ready.', PLAN, 7);

            expect(ctx._phase).to.equal('run-failed');
            expect(ctx.previewAutoRetryAttempts).to.equal(0);
            expect(ctx.previewAutoRetryTimer).to.equal(undefined);
            expect(attachCalls()).to.equal(0);
            expect(ctx._error).to.contain('ran out of memory');
        });

        it('keeps auto-retrying a crash when the OOM counter did not move', async () => {
            const { ctx } = failingRunContext({
                devRunOomKillBaseline: Promise.resolve(3),
                readOomKillCount: async () => 3,
            });
            await activity.failDevRunExtracted(ctx, 'Dev server exited with code 1.', PLAN, 7);
            window.clearTimeout(ctx.previewAutoRetryTimer);

            expect(ctx.previewAutoRetryAttempts).to.equal(1);
        });

        it('handles a later failure of the same run once the first one settled', async () => {
            const { ctx } = failingRunContext();
            await activity.failDevRunExtracted(ctx, 'Dev server exited with code 1.', PLAN, 7);
            window.clearTimeout(ctx.previewAutoRetryTimer);
            // An adopted terminal keeps the run id and may die long after the first recovery.
            await activity.failDevRunExtracted(ctx, 'Dev server exited with code 1.', PLAN, 7);
            window.clearTimeout(ctx.previewAutoRetryTimer);

            expect(ctx.previewAutoRetryAttempts).to.equal(2);
        });
    });

    describe('restored preview terminal cleanup', () => {
        function cleanupContext(terminals: FakeTerminal[]): { ctx: QaapProjectBootstrapServiceContext; disposed: FakeTerminal[] } {
            const disposed: FakeTerminal[] = [];
            const state = {
                devTerminal: undefined as FakeTerminal | undefined,
                spawningPreviewTerminals: new Set<FakeTerminal>(),
                terminalService: { all: terminals },
                disposeBootstrapTerminal: (terminal: FakeTerminal) => {
                    terminal.isDisposed = true;
                    disposed.push(terminal);
                },
            };
            return { ctx: state as unknown as QaapProjectBootstrapServiceContext, disposed };
        }

        it('never disposes a preview terminal that is still being spawned', async () => {
            const spawning = fakeTerminal('Dev (app)');
            const orphan = fakeTerminal('Dev (app)');
            const { ctx, disposed } = cleanupContext([spawning, orphan]);
            ctx.spawningPreviewTerminals.add(spawning as unknown as TerminalWidget);

            await activity.disposeRestoredPreviewTerminalsExtracted(ctx, PLAN.cwd, 'Dev (app)');

            expect(disposed).to.deep.equal([orphan]);
        });

        it('re-checks ownership after awaiting the terminal cwd', async () => {
            let resolveCwd: (uri: URI) => void = () => undefined;
            const adopted = fakeTerminal('Dev (app)', new Promise<URI>(resolve => {
                resolveCwd = resolve;
            }));
            const { ctx, disposed } = cleanupContext([adopted]);

            const cleanup = activity.disposeRestoredPreviewTerminalsExtracted(ctx, PLAN.cwd, 'Dev (app)');
            // startDevServer adopts the terminal while the scan awaits its cwd.
            ctx.devTerminal = adopted as unknown as TerminalWidget;
            resolveCwd(URI.fromFilePath(PROJECT_CWD));
            await cleanup;

            expect(disposed).to.deep.equal([]);
        });
    });
});

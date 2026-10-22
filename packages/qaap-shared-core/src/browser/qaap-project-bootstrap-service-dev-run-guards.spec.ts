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
    let streaming: typeof import('./qaap-project-bootstrap-service-streaming');
    let describeDevProcessExit: typeof import('./qaap-project-bootstrap-dev-errors').describeDevProcessExit;

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
        streaming = require('./qaap-project-bootstrap-service-streaming');
        ({ describeDevProcessExit } = require('./qaap-project-bootstrap-dev-errors'));
    });

    after(() => disableJSDOM?.());

    describe('spawnCommand in mobile mode', () => {
        const runSpawn = async (mobile: boolean): Promise<{ started: boolean; opened: number }> => {
            const original = window.matchMedia;
            window.matchMedia = (() => ({ matches: mobile })) as unknown as typeof window.matchMedia;
            let started = false;
            let opened = 0;
            const terminal = { start: async () => { started = true; }, onOutput: () => ({ dispose: () => undefined }) };
            const ctx = {
                terminalService: {
                    newTerminal: async () => terminal,
                    open: () => { opened++; },
                },
                buildShellInvocation: () => ({ shellPath: '/bin/sh', shellArgs: ['-c', 'true'] }),
            };
            try {
                await activity.spawnCommandExtracted(ctx as unknown as QaapProjectBootstrapServiceContext, {
                    title: 'dev',
                    command: 'npm run dev',
                    cwd: URI.fromFilePath(PROJECT_CWD),
                });
            } finally {
                window.matchMedia = original;
            }
            return { started, opened };
        };

        it('runs the process but never calls terminalService.open', async () => {
            expect(await runSpawn(true)).to.deep.equal({ started: true, opened: 0 });
        });

        it('still reveals the terminal on desktop', async () => {
            expect(await runSpawn(false)).to.deep.equal({ started: true, opened: 1 });
        });
    });

    describe('preview claim conflict recovery', () => {
        it('restarts on the next available port when the backend rejects the initial claim', async () => {
            let restartedPlan: typeof PLAN | undefined;
            const state = {
                automaticPortRecoveryAttempts: 0,
                attemptedDevPorts: new Set([5173]),
                portRecoveryFrom: undefined,
                devPortOverride: undefined,
                _phase: 'starting',
                startDevServer: async (plan: typeof PLAN) => { restartedPlan = plan; },
            };
            const handled = await streaming.recoverPreviewPortClaimConflictExtracted(
                state as unknown as QaapProjectBootstrapServiceContext,
                PLAN,
                { name: 'app' } as unknown as import('./qaap-project-bootstrap-types').QaapProjectDescriptor,
                5173,
            );

            expect(handled).to.equal(true);
            expect(state.devPortOverride).to.equal(5174);
            expect(state.portRecoveryFrom).to.equal(5173);
            expect(state.automaticPortRecoveryAttempts).to.equal(1);
            expect(restartedPlan).to.deep.equal(PLAN);
        });

        it('does not exceed the bounded alternate-port recovery budget', async () => {
            const state = {
                automaticPortRecoveryAttempts: 8,
                attemptedDevPorts: new Set([5173]),
                portRecoveryFrom: undefined,
                devPortOverride: undefined,
                _phase: 'starting',
                startDevServer: async () => { throw new Error('must not start another run'); },
            };
            const handled = await streaming.recoverPreviewPortClaimConflictExtracted(
                state as unknown as QaapProjectBootstrapServiceContext,
                PLAN,
                { name: 'app' } as unknown as import('./qaap-project-bootstrap-types').QaapProjectDescriptor,
                5173,
            );
            expect(handled).to.equal(false);
        });
    });

    describe('startDevServer with a server already on the expected port', () => {
        const DESCRIPTOR = { name: 'app' } as unknown as import('./qaap-project-bootstrap-types').QaapProjectDescriptor;

        const makeCtx = (attachable: boolean, devTerminal?: { isDisposed: boolean }): {
            ctx: QaapProjectBootstrapServiceContext; attachCalls: number[][]; reserved: number[];
        } => {
            const attachCalls: number[][] = [];
            const reserved: number[] = [];
            const ctx = {
                _selectedApp: undefined,
                _error: undefined,
                devRunGeneration: 0,
                // Exhausted budget: the rejected reservation ends the run instead of retrying.
                automaticPortRecoveryAttempts: 99,
                devTerminal,
                attemptedDevPorts: new Set<number>(),
                previewClaimByConversation: new Map(),
                activePreviewConversationId: 'c1',
                beginDevRun: () => undefined,
                clearForwardedPorts: () => undefined,
                readOomKillCount: () => 0,
                setPhase: () => undefined,
                buildDevSpawnPlan: () => ({ command: 'npm run dev', targetPort: 5173 }),
                tryAttachToExistingServer: async (ports: number[]) => { attachCalls.push(ports); return attachable; },
                reconcileRestoredPreviewTerminals: async () => undefined,
                disposeRestoredPreviewTerminals: async () => undefined,
                ensurePreviewProcessIdForConversation: () => undefined,
                reserveActivePreview: async (port: number) => { reserved.push(port); return { kind: 'conflict' }; },
            };
            return { ctx: ctx as unknown as QaapProjectBootstrapServiceContext, attachCalls, reserved };
        };

        it('attaches to it instead of reserving a second port and spawning another server', async () => {
            const { ctx, attachCalls, reserved } = makeCtx(true);
            await streaming.startDevServerExtracted(ctx, PLAN, DESCRIPTOR);
            expect(attachCalls).to.deep.equal([[5173]]);
            expect(reserved).to.deep.equal([]);
        });

        it('falls through to the normal reservation when nothing attributable answers there', async () => {
            const { ctx, attachCalls, reserved } = makeCtx(false);
            await streaming.startDevServerExtracted(ctx, PLAN, DESCRIPTOR);
            expect(attachCalls).to.deep.equal([[5173]]);
            expect(reserved).to.deep.equal([5173]);
        });

        it('fails fast as build-required without spawning when the build output is certainly missing', async () => {
            const { ctx, attachCalls, reserved } = makeCtx(true);
            const phases: string[] = [];
            (ctx as unknown as { setPhase: (phase: string) => void }).setPhase = phase => { phases.push(phase); };
            (ctx as unknown as { detector: object }).detector = { pathExists: async () => false };
            const descriptor = {
                name: 'api', apps: [], buildRequired: true, buildOutputUri: { toString: () => 'file:///ws/apps/api/dist' },
            } as unknown as import('./qaap-project-bootstrap-types').QaapProjectDescriptor;
            await streaming.startDevServerExtracted(ctx, PLAN, descriptor);
            expect(phases).to.deep.equal(['run-failed']);
            // No Build and start command: neither the button nor the opt-in is named.
            expect(ctx._error).to.contain('Run its build yourself');
            expect(ctx._error).not.to.contain('Build and start');
            expect(ctx._error).not.to.contain('"build": "auto"');
            expect(attachCalls).to.deep.equal([]);
            expect(reserved).to.deep.equal([]);
        });

        it('names Build and start in the fail-fast message only when the action exists', async () => {
            const { ctx } = makeCtx(true);
            (ctx as unknown as { setPhase: (phase: string) => void }).setPhase = () => { };
            (ctx as unknown as { detector: object }).detector = { pathExists: async () => false };
            const descriptor = {
                name: 'api', apps: [], buildRequired: true, buildOutputUri: { toString: () => 'file:///ws/apps/api/dist' },
                buildAndStartCommand: 'npm run build && npm run start',
            } as unknown as import('./qaap-project-bootstrap-types').QaapProjectDescriptor;
            await streaming.startDevServerExtracted(ctx, PLAN, descriptor);
            expect(ctx._error).to.contain('Choose Build and start');
            expect(ctx._error).to.contain('"build": "auto"');
        });

        it('starts when the user chose Build and start, even with the output still missing', async () => {
            const { ctx, attachCalls } = makeCtx(true);
            (ctx as unknown as { detector: object }).detector = { pathExists: async () => false };
            const descriptor = {
                name: 'api', apps: [], buildRequired: true, buildOutputUri: { toString: () => 'file:///ws/apps/api/dist' },
                buildAndStartCommand: 'npm run build && npm run start',
            } as unknown as import('./qaap-project-bootstrap-types').QaapProjectDescriptor;
            await streaming.startDevServerExtracted(ctx, { ...PLAN, command: 'npm run build && npm run start' }, descriptor);
            expect(attachCalls).to.deep.equal([[5173]]);
        });

        it('starts normally once the user built the missing output by hand', async () => {
            const { ctx, attachCalls } = makeCtx(true);
            (ctx as unknown as { detector: object }).detector = { pathExists: async () => true };
            const descriptor = {
                name: 'api', apps: [], buildRequired: true, buildOutputUri: { toString: () => 'file:///ws/apps/api/dist' },
            } as unknown as import('./qaap-project-bootstrap-types').QaapProjectDescriptor;
            await streaming.startDevServerExtracted(ctx, PLAN, descriptor);
            expect(attachCalls).to.deep.equal([[5173]]);
        });

        it('does not adopt the old server of a restart while its managed terminal is still alive', async () => {
            const { ctx, attachCalls, reserved } = makeCtx(true, { isDisposed: false });
            await streaming.startDevServerExtracted(ctx, PLAN, DESCRIPTOR);
            expect(attachCalls).to.deep.equal([]);
            expect(reserved).to.deep.equal([5173]);
        });
    });

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

        it('reports a clean exit without a listener with its port and last output instead of retrying', async () => {
            const output = '2026-10-11T10:00:00.000Z root INFO Configuration directory URI: file:///root/.theia\n'
                + '2026-10-11T10:00:00.100Z root ERROR SQLite errcode 14 (non-fatal)\n';
            const { ctx, attachCalls } = failingRunContext({
                devOutputTail: output,
                enrichDevRunError: (message: string) => message,
                toUserFacingDevError: (message: string) => message,
            });
            const exit = describeDevProcessExit(0, output, 3001);

            await activity.failDevRunExtracted(ctx, exit.message, PLAN, 7, { exitedWithoutListening: exit.exitedWithoutListening });

            expect(ctx._phase).to.equal('run-failed');
            expect(ctx.previewAutoRetryAttempts).to.equal(0);
            expect(ctx.previewAutoRetryTimer).to.equal(undefined);
            // A daemonizing command may still have left a server behind: attach is tried first.
            expect(attachCalls()).to.equal(1);
            expect(ctx._error).to.contain('exited with code 0 without listening on port 3001');
            expect(ctx._error).to.contain('SQLite errcode 14 (non-fatal)');
        });

        it('never auto-retries a failed opted-in build chained before the server', async () => {
            const { ctx, attachCalls } = failingRunContext({
                _descriptor: { name: 'app', nodeModulesPresent: true, apps: [], buildScript: 'build' },
                devOutputTail: 'src/index.ts(3,7): error TS2322: Type \'string\' is not assignable to type \'number\'.\n'
                    + 'npm error Lifecycle script `build` failed with error:\nnpm error code 2\n',
                enrichDevRunError: (message: string) => message,
                toUserFacingDevError: (message: string) => message,
            });
            await activity.failDevRunExtracted(ctx, 'Dev server exited with code 2.', PLAN, 7);

            expect(ctx._phase).to.equal('run-failed');
            expect(ctx.previewAutoRetryAttempts).to.equal(0);
            expect(ctx.previewAutoRetryTimer).to.equal(undefined);
            expect(attachCalls()).to.equal(1);
            expect(ctx._error).to.contain('runs `build` first');
            expect(ctx._error).to.contain('does not retry builds');
            expect(ctx._error).to.contain('npm error code 2');
        });

        it('reports an out-of-memory opted-in build once, as a build failure, without retrying', async () => {
            const { ctx } = failingRunContext({
                _descriptor: { name: 'app', nodeModulesPresent: true, apps: [], buildScript: 'build' },
                devOutputTail: 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\n',
                enrichDevRunError: (message: string) => message,
                toUserFacingDevError: (message: string) => message,
            });
            await activity.failDevRunExtracted(ctx, 'Dev server exited with code 134.', PLAN, 7);

            expect(ctx._phase).to.equal('run-failed');
            expect(ctx.previewAutoRetryAttempts).to.equal(0);
            expect(ctx.previewAutoRetryTimer).to.equal(undefined);
            expect(ctx._error).to.contain('`build` step that runs before the preview ran out of memory');
        });

        it('recovers a port conflict of a chained build with the start command alone (no rebuild)', async () => {
            const started: string[] = [];
            const { ctx } = failingRunContext({
                _descriptor: {
                    name: 'app', nodeModulesPresent: true, apps: [], buildScript: 'build', previewStartCommand: 'npm run start',
                },
                _portConflictDetected: true,
                _portConflictPort: 5173,
                automaticPortRecoveryAttempts: 0,
                attemptedDevPorts: new Set<number>([5173]),
                startDevServer: async (plan: { command: string }) => { started.push(plan.command); },
            });
            await activity.failDevRunExtracted(ctx, 'Error: listen EADDRINUSE: address already in use :::5173',
                { ...PLAN, command: 'npm run build && npm run start' }, 7);

            expect(started).to.deep.equal(['npm run start']);
            expect(ctx.automaticPortRecoveryAttempts).to.equal(1);
            expect(ctx.previewAutoRetryAttempts).to.equal(0);
        });

        it('reports a port conflict of a chained build instead of relaunching it when the start command is unknown', async () => {
            const started: string[] = [];
            const { ctx } = failingRunContext({
                _descriptor: { name: 'app', nodeModulesPresent: true, apps: [], buildScript: 'build' },
                _portConflictDetected: true,
                _portConflictPort: 5173,
                automaticPortRecoveryAttempts: 0,
                attemptedDevPorts: new Set<number>([5173]),
                startDevServer: async (plan: { command: string }) => { started.push(plan.command); },
                enrichDevRunError: (message: string) => message,
                toUserFacingDevError: (message: string) => message,
            });
            await activity.failDevRunExtracted(ctx, 'Error: listen EADDRINUSE: address already in use :::5173',
                { ...PLAN, command: 'npm run build && npm run start' }, 7);

            expect(started).to.deep.equal([]);
            expect(ctx._phase).to.equal('run-failed');
            expect(ctx._error).to.contain('does not relaunch a preview that builds first');
        });

        it('reports a failed Build and start once, without retrying the build', async () => {
            const started: string[] = [];
            const { ctx } = failingRunContext({
                _descriptor: {
                    name: 'app', nodeModulesPresent: true, apps: [],
                    buildAndStartCommand: 'npm run build && npm run start', previewStartCommand: 'npm run start',
                },
                devOutputTail: 'src/index.ts(1,1): error TS1005: ; expected.\nnpm error code 2\n',
                startDevServer: async (plan: { command: string }) => { started.push(plan.command); },
                enrichDevRunError: (message: string) => message,
                toUserFacingDevError: (message: string) => message,
            });
            await activity.failDevRunExtracted(ctx, 'Dev server exited with code 2.',
                { ...PLAN, command: 'npm run build && npm run start' }, 7);

            expect(started).to.deep.equal([]);
            expect(ctx._phase).to.equal('run-failed');
            expect(ctx.previewAutoRetryAttempts).to.equal(0);
            expect(ctx.previewAutoRetryTimer).to.equal(undefined);
            expect(ctx._error).to.contain('does not retry builds');
            expect(ctx._error).to.contain('started by Build and start failed');
            expect(ctx._error).not.to.contain('.qaap/preview.json');
        });

        it('names Build and start for a runtime build-required failure only when the action exists', async () => {
            const output = "Error: Cannot find module '/ws/dev-packages/cli/lib/theia'\n";
            const withAction = failingRunContext({
                _descriptor: { name: 'app', nodeModulesPresent: true, apps: [], buildAndStartCommand: 'npm run build && npm run start' },
                devOutputTail: output,
                enrichDevRunError: (message: string) => message,
                toUserFacingDevError: (message: string) => message,
            }).ctx;
            await activity.failDevRunExtracted(withAction, 'Dev server exited with code 1.', PLAN, 7);
            expect(withAction._error).to.contain('Choose Build and start');

            const single = failingRunContext({
                _descriptor: { name: 'app', nodeModulesPresent: true, apps: [] },
                devOutputTail: output,
                enrichDevRunError: (message: string) => message,
                toUserFacingDevError: (message: string) => message,
            }).ctx;
            await activity.failDevRunExtracted(single, 'Dev server exited with code 1.', PLAN, 7);
            expect(single._error).to.contain('Run its build yourself');
            expect(single._error).not.to.contain('Build and start');
            expect(single.previewAutoRetryAttempts).to.equal(0);
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

    describe('workspace refresh racing a dev run', () => {
        const ROOT = URI.fromFilePath(PROJECT_CWD);
        const DESCRIPTOR = { name: 'app', rootUri: ROOT, nodeModulesPresent: true, apps: [] };

        const refreshContext = (detect: () => Promise<unknown>): {
            ctx: QaapProjectBootstrapServiceContext; phases: string[];
        } => {
            const phases: string[] = [];
            const state = {
                _phase: 'ready-to-run',
                _descriptor: DESCRIPTOR,
                devRunGeneration: 1,
                installGeneration: 1,
                resetBootstrapSessionForWorkspace: () => {
                    state.devRunGeneration++;
                    state.installGeneration++;
                },
                clearForwardedPorts: () => undefined,
                detector: { detect },
                readPersisted: () => undefined,
                scheduleDevPreviewWarmup: () => undefined,
                setPhase: (phase: string) => {
                    phases.push(phase);
                    state._phase = phase;
                },
            };
            return { ctx: state as unknown as QaapProjectBootstrapServiceContext, phases };
        };

        it('keeps a dev run that started while detection was in flight', async () => {
            let resolveDetect: (descriptor: unknown) => void = () => undefined;
            const { ctx, phases } = refreshContext(() => new Promise(resolve => {
                resolveDetect = resolve;
            }));

            const refresh = streaming.refreshFromRootExtracted(ctx, ROOT);
            // runDevServer → startDevServer bumps the run generation and enters `starting`.
            ctx.devRunGeneration++;
            ctx.setPhase('starting');
            resolveDetect({ ...DESCRIPTOR });
            await refresh;

            expect(phases).to.deep.equal(['starting']);
            expect(ctx._phase).to.equal('starting');
        });

        it('applies the detected descriptor when nothing started meanwhile', async () => {
            const { ctx, phases } = refreshContext(async () => ({ ...DESCRIPTOR }));

            await streaming.refreshFromRootExtracted(ctx, ROOT);

            expect(phases).to.deep.equal(['ready-to-run']);
        });
    });
});

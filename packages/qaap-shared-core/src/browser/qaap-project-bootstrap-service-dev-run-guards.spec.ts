// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as sinon from 'sinon';
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
    let toolPills: typeof import('./qaap-project-bootstrap-service-tool-pills');
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
        toolPills = require('./qaap-project-bootstrap-service-tool-pills');
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
        const OTHER_ROOT = URI.fromFilePath('/workspace/other');
        const DESCRIPTOR = { name: 'app', rootUri: ROOT, nodeModulesPresent: true, apps: [], packageManager: 'npm' };
        const OTHER_DESCRIPTOR = { name: 'other', rootUri: OTHER_ROOT, nodeModulesPresent: true, apps: [] };
        const REPLAY_DELAY_MS = 450;

        let clock: sinon.SinonFakeTimers;
        beforeEach(() => {
            clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        });
        afterEach(() => clock.restore());

        interface RefreshHarness {
            ctx: QaapProjectBootstrapServiceContext;
            phases: string[];
            /** `resetBootstrapSessionForWorkspace` calls, i.e. refreshes that went through. */
            resets(): number;
            workspaceRefreshes(): number;
            projectRootRefreshes: Array<[string, string]>;
            /** Resolves the oldest pending `detect` call for `root`. */
            resolveDetect(root: URI, descriptor: unknown): void;
        }

        /** Bootstrap session wired to the real `setPhase`, so deferred replays run as in the service. */
        const refreshContext = (immediate?: unknown, overrides: Record<string, unknown> = {}): RefreshHarness => {
            const phases: string[] = [];
            const pending = new Map<string, Array<(descriptor: unknown) => void>>();
            const projectRootRefreshes: Array<[string, string]> = [];
            let resets = 0;
            let workspaceRefreshes = 0;
            const state: Record<string, unknown> & { devRunGeneration: number; installGeneration: number } = {
                _phase: 'ready-to-run',
                _descriptor: DESCRIPTOR,
                _error: undefined,
                devRunGeneration: 1,
                installGeneration: 1,
                refreshGeneration: 0,
                deferredWorkspaceRefresh: undefined,
                deferredWorkspaceRefreshTimer: undefined,
                hubPinnedWorkspaceRoot: undefined,
                activeProjectId: undefined,
                activePreviewConversationId: 'conversation-1',
                resetBootstrapSessionForWorkspace: () => {
                    resets++;
                    state.devRunGeneration++;
                    state.installGeneration++;
                    state.activePreviewConversationId = 'default';
                },
                clearForwardedPorts: () => undefined,
                detector: {
                    detect: (root: URI) => immediate !== undefined ? Promise.resolve(immediate) : new Promise(resolve => {
                        const key = root.toString();
                        pending.set(key, [...(pending.get(key) ?? []), resolve]);
                    }),
                },
                readPersisted: () => undefined,
                scheduleDevPreviewWarmup: () => undefined,
                refreshFromCurrentWorkspace: async () => {
                    workspaceRefreshes++;
                },
                refreshFromProjectRoot: async (root: URI, projectId: string) => {
                    projectRootRefreshes.push([root.toString(), projectId]);
                },
                startDevPreviewHealthMonitor: () => undefined,
                cancelDevPreviewHealthMonitor: () => undefined,
                stateEmitter: { fire: () => undefined },
                buildStateChange: () => ({}),
                syncHubSession: () => undefined,
                setPhase: (phase: string) => {
                    phases.push(phase);
                    toolPills.setPhaseExtracted(ctx, phase as never);
                },
                ...overrides,
            };
            const ctx = state as unknown as QaapProjectBootstrapServiceContext;
            return {
                ctx,
                phases,
                resets: () => resets,
                workspaceRefreshes: () => workspaceRefreshes,
                projectRootRefreshes,
                resolveDetect: (root, descriptor) => pending.get(root.toString())!.shift()!(descriptor),
            };
        };

        /** What runDevServer → startDevServer does to the session. */
        const startRun = (ctx: QaapProjectBootstrapServiceContext): void => {
            ctx.devRunGeneration++;
            ctx.setPhase('starting');
        };

        it('keeps a dev run that started while detection was in flight', async () => {
            const { ctx, phases, resolveDetect } = refreshContext();

            const refresh = streaming.refreshFromRootExtracted(ctx, ROOT);
            startRun(ctx);
            resolveDetect(ROOT, { ...DESCRIPTOR });
            await refresh;

            expect(phases).to.deep.equal(['starting']);
            expect(ctx._phase).to.equal('starting');
        });

        it('applies the detected descriptor when nothing started meanwhile', async () => {
            const { ctx, phases } = refreshContext({ ...DESCRIPTOR });

            await streaming.refreshFromRootExtracted(ctx, ROOT);

            expect(phases).to.deep.equal(['ready-to-run']);
            expect(ctx.deferredWorkspaceRefresh).to.equal(undefined);
        });

        it('drops a slower refresh of another root once a newer refresh started', async () => {
            const { ctx, phases, resolveDetect } = refreshContext();
            ctx._descriptor = undefined;

            const older = streaming.refreshFromRootExtracted(ctx, OTHER_ROOT);
            const newer = streaming.refreshFromRootExtracted(ctx, ROOT);
            resolveDetect(ROOT, { ...DESCRIPTOR });
            await newer;
            resolveDetect(OTHER_ROOT, { ...OTHER_DESCRIPTOR });
            await older;

            expect((ctx._descriptor as { name: string } | undefined)?.name).to.equal('app');
            expect(phases).to.deep.equal(['ready-to-run']);
        });

        it('defers a snapshot dropped for a live run instead of applying it', async () => {
            const { ctx, resolveDetect, workspaceRefreshes } = refreshContext();
            const refresh = streaming.refreshFromRootExtracted(ctx, ROOT);
            startRun(ctx);
            resolveDetect(ROOT, { ...DESCRIPTOR, nodeModulesPresent: false });
            await refresh;
            clock.tick(REPLAY_DELAY_MS);

            expect(ctx.deferredWorkspaceRefresh?.root.toString()).to.equal(ROOT.toString());
            expect(workspaceRefreshes()).to.equal(0);
        });

        it('keeps the failure on screen when the run failed before detection resolved', async () => {
            const { ctx, phases, resolveDetect, workspaceRefreshes } = refreshContext();
            const refresh = streaming.refreshFromRootExtracted(ctx, ROOT);
            startRun(ctx);
            ctx._error = 'Build required before start.';
            ctx.setPhase('run-failed');
            resolveDetect(ROOT, { ...DESCRIPTOR });
            await refresh;
            clock.tick(REPLAY_DELAY_MS);

            expect(workspaceRefreshes()).to.equal(0);
            expect(ctx.deferredWorkspaceRefresh).to.not.equal(undefined);
            expect(ctx._error).to.equal('Build required before start.');
            expect(phases).to.deep.equal(['starting', 'run-failed']);
        });

        it('replays the dropped snapshot after the debounce when the run is already back at rest', async () => {
            const { ctx, resolveDetect, workspaceRefreshes } = refreshContext();
            const refresh = streaming.refreshFromRootExtracted(ctx, ROOT);
            startRun(ctx);
            // Stopped by the user while `detect` was still in flight.
            ctx.setPhase('ready-to-run');
            resolveDetect(ROOT, { ...DESCRIPTOR });
            await refresh;

            expect(workspaceRefreshes()).to.equal(0);
            clock.tick(REPLAY_DELAY_MS);
            expect(workspaceRefreshes()).to.equal(1);
            expect(ctx.deferredWorkspaceRefresh).to.equal(undefined);
        });

        it('defers a refresh of the same root that arrives while the run is starting', async () => {
            const { ctx, phases, resets } = refreshContext({ ...DESCRIPTOR });
            startRun(ctx);

            await streaming.refreshFromRootExtracted(ctx, ROOT);

            expect(phases).to.deep.equal(['starting']);
            expect(resets()).to.equal(0);
            expect(ctx.deferredWorkspaceRefresh?.root.toString()).to.equal(ROOT.toString());
        });

        it('drops a pending replay once a newer refresh goes through', async () => {
            const { ctx, workspaceRefreshes } = refreshContext({ ...OTHER_DESCRIPTOR });
            ctx.deferredWorkspaceRefresh = { root: ROOT };
            ctx.setPhase('run-failed');

            await streaming.refreshFromRootExtracted(ctx, OTHER_ROOT);
            clock.tick(REPLAY_DELAY_MS);

            expect(ctx.deferredWorkspaceRefresh).to.equal(undefined);
            expect(workspaceRefreshes()).to.equal(0);
        });

        it('replays a Work Hub pinned root through refreshFromProjectRoot, after the debounce', async () => {
            const { ctx, resolveDetect, workspaceRefreshes, projectRootRefreshes } = refreshContext();
            ctx.hubPinnedWorkspaceRoot = ROOT;
            ctx.activeProjectId = 'project-1';
            const refresh = streaming.refreshFromRootExtracted(ctx, ROOT);
            startRun(ctx);
            ctx.setPhase('ready-to-run');
            resolveDetect(ROOT, { ...DESCRIPTOR });
            await refresh;

            expect(projectRootRefreshes).to.deep.equal([]);
            clock.tick(REPLAY_DELAY_MS);
            // A plain workspace refresh would be ignored by the hub pin and lose the update.
            expect(workspaceRefreshes()).to.equal(0);
            expect(projectRootRefreshes).to.deep.equal([[ROOT.toString(), 'project-1']]);
        });

        it('does not reset the session between a successful install and its chained dev run', async () => {
            const devRuns: unknown[] = [];
            const harness = refreshContext({ ...DESCRIPTOR }, {
                _descriptor: { ...DESCRIPTOR, nodeModulesPresent: false },
                _needsInstall: false,
                resolveInstallPlan: () => ({ command: 'npm install', cwd: ROOT }),
                spawnCommandWithRetry: async () => ({ isDisposed: false }),
                waitForExit: async () => 0,
                refreshDescriptorAfterInstall: async () => undefined,
                persistPhase: () => undefined,
                resolveDevPlan: () => PLAN,
            });
            const { ctx, phases, resets, workspaceRefreshes, projectRootRefreshes } = harness;
            ctx.hubPinnedWorkspaceRoot = ROOT;
            ctx.activeProjectId = 'project-1';
            (ctx as unknown as { runDevServer(): Promise<void> }).runDevServer = async () => {
                devRuns.push({ conversation: ctx.activePreviewConversationId, resets: resets() });
                startRun(ctx);
            };

            const install = streaming.runInstallExtracted(ctx);
            // A Work Hub refresh of the same project lands while `npm install` runs.
            await streaming.refreshFromRootExtracted(ctx, ROOT);
            expect(ctx.deferredWorkspaceRefresh).to.not.equal(undefined);
            await install;
            clock.tick(REPLAY_DELAY_MS);

            expect(phases).to.deep.equal(['installing', 'ready-to-run', 'starting']);
            expect(devRuns).to.deep.equal([{ conversation: 'conversation-1', resets: 0 }]);
            expect(resets()).to.equal(0);
            expect(ctx.activePreviewConversationId).to.equal('conversation-1');
            expect(ctx.deferredWorkspaceRefresh).to.equal(undefined);
            expect(workspaceRefreshes()).to.equal(0);
            expect(projectRootRefreshes).to.deep.equal([]);
        });

        describe('setPhase replay of a deferred refresh', () => {
            const deferred = (): RefreshHarness => {
                const harness = refreshContext();
                harness.ctx._phase = 'starting';
                harness.ctx.deferredWorkspaceRefresh = { root: ROOT };
                return harness;
            };

            it('waits while the server is still up', () => {
                const { ctx, workspaceRefreshes } = deferred();

                ctx.setPhase('running');
                clock.tick(REPLAY_DELAY_MS);

                expect(workspaceRefreshes()).to.equal(0);
                expect(ctx.deferredWorkspaceRefresh).to.not.equal(undefined);
            });

            it('keeps the refresh pending through a failed run so its error stays visible', () => {
                const { ctx, workspaceRefreshes } = deferred();
                ctx._error = 'The dev server ran out of memory.';

                ctx.setPhase('run-failed');
                ctx.setPhase('install-failed');
                clock.tick(REPLAY_DELAY_MS);

                expect(workspaceRefreshes()).to.equal(0);
                expect(ctx.deferredWorkspaceRefresh).to.not.equal(undefined);
                expect(ctx._error).to.equal('The dev server ran out of memory.');
            });

            it('replays once, after the debounce, when the failed run goes back to ready-to-run', () => {
                const { ctx, workspaceRefreshes } = deferred();
                ctx.setPhase('run-failed');

                ctx.setPhase('ready-to-run');
                ctx.setPhase('ready-to-run');
                expect(workspaceRefreshes()).to.equal(0);
                clock.tick(REPLAY_DELAY_MS);

                expect(workspaceRefreshes()).to.equal(1);
                expect(ctx.deferredWorkspaceRefresh).to.equal(undefined);
            });

            it('stays pending when a run starts again before the debounce fires', () => {
                const { ctx, workspaceRefreshes } = deferred();

                ctx.setPhase('ready-to-run');
                startRun(ctx);
                clock.tick(REPLAY_DELAY_MS);
                expect(workspaceRefreshes()).to.equal(0);
                expect(ctx.deferredWorkspaceRefresh).to.not.equal(undefined);

                ctx.setPhase('ready-to-run');
                clock.tick(REPLAY_DELAY_MS);
                expect(workspaceRefreshes()).to.equal(1);
            });
        });
    });

    describe('workspace reset scope', () => {
        const ROOT_A = URI.fromFilePath('/workspace/a').toString();
        const ROOT_B = URI.fromFilePath('/workspace/b').toString();

        let consoleInfo: sinon.SinonStub;
        beforeEach(() => {
            consoleInfo = sinon.stub(console, 'info');
        });
        afterEach(() => consoleInfo.restore());

        /** Session with one live dev terminal per project (A, B) and one without a known root. */
        const makeSession = (): { ctx: QaapProjectBootstrapServiceContext; disposed: string[]; listenersDisposed: string[]; state: Record<string, unknown> } => {
            const disposed: string[] = [];
            const listenersDisposed: string[] = [];
            const entry = (id: string, rootKey: string | undefined): { terminal: { id: string }; listener: { dispose(): void }; rootKey: string | undefined } => ({
                terminal: { id },
                listener: { dispose: () => { listenersDisposed.push(id); } },
                rootKey,
            });
            const terminalA = entry('term-a', ROOT_A);
            const state: Record<string, unknown> = {
                installGeneration: 0,
                devRunGeneration: 0,
                cancelDevPreviewFallbacks: () => undefined,
                cancelDevPreviewHealthMonitor: () => undefined,
                devTerminalListener: { dispose: () => undefined },
                devTerminal: terminalA.terminal,
                devTerminalConversationId: 'conv-a',
                activePreviewClaim: { previewId: 'p-a', port: 5173, previewUrl: 'http://localhost:5173' },
                activePreviewRunId: 'run-a',
                activePreviewConversationId: 'conv-a',
                devPortOverride: undefined,
                automaticPortRecoveryAttempts: 0,
                attemptedDevPorts: new Set<number>([5173]),
                portRecoveryFrom: undefined,
                activeDevPortHint: 5173,
                previewRunIdByConversation: new Map([['conv-a', 'run-a'], ['conv-b', 'run-b']]),
                previewClaimByConversation: new Map([['conv-a', { previewId: 'p-a', port: 5173 }], ['conv-b', { previewId: 'p-b', port: 5174 }]]),
                devTerminalByConversationId: new Map<string, unknown>([
                    ['conv-a', terminalA],
                    ['conv-b', entry('term-b', ROOT_B)],
                    ['conv-legacy', entry('term-legacy', undefined)],
                ]),
                disposeBootstrapTerminal: (terminal: { id: string } | undefined) => { if (terminal) { disposed.push(terminal.id); } },
                installTerminal: undefined,
            };
            return { ctx: state as unknown as QaapProjectBootstrapServiceContext, disposed, listenersDisposed, state };
        };

        it('disposes only the dev terminals of the root being reset', () => {
            const { ctx, disposed, listenersDisposed, state } = makeSession();
            toolPills.resetBootstrapSessionForWorkspaceExtracted(ctx, 'refreshFromRoot', ROOT_B);

            expect(disposed).to.deep.equal(['term-b']);
            expect(listenersDisposed).to.deep.equal(['term-b']);
            expect([...(state.devTerminalByConversationId as Map<string, unknown>).keys()]).to.deep.equal(['conv-a', 'conv-legacy']);
        });

        it('keeps the other project live pointers and per-conversation claims', () => {
            const { ctx, state } = makeSession();
            toolPills.resetBootstrapSessionForWorkspaceExtracted(ctx, 'refreshFromRoot', ROOT_B);

            expect(state.devTerminal).to.not.equal(undefined);
            expect(state.devTerminalConversationId).to.equal('conv-a');
            expect([...(state.previewRunIdByConversation as Map<string, string>).keys()]).to.deep.equal(['conv-a']);
            expect([...(state.previewClaimByConversation as Map<string, unknown>).keys()]).to.deep.equal(['conv-a']);
        });

        it('disposes the terminal of the reset root when that root is the active one', () => {
            const { ctx, disposed, state } = makeSession();
            toolPills.resetBootstrapSessionForWorkspaceExtracted(ctx, 'refreshFromRoot', ROOT_A);

            expect(disposed).to.deep.equal(['term-a']);
            expect(state.devTerminal).to.equal(undefined);
            expect(state.devTerminalConversationId).to.equal(undefined);
        });

        it('disposes nothing when no root is named', () => {
            const { ctx, disposed } = makeSession();
            toolPills.resetBootstrapSessionForWorkspaceExtracted(ctx, 'refreshFromRoot', undefined);

            expect(disposed).to.deep.equal([]);
        });

        it('records the root of a registered dev terminal', () => {
            const { ctx, state } = makeSession();
            const terminal = { id: 'term-c' } as unknown as import('@theia/terminal/lib/browser/base/terminal-widget').TerminalWidget;
            toolPills.registerDevTerminalForConversationExtracted(ctx, 'conv-c', terminal, { dispose: () => undefined } as never, ROOT_A);

            expect((state.devTerminalByConversationId as Map<string, { rootKey: string | undefined }>).get('conv-c')?.rootKey).to.equal(ROOT_A);
        });
    });

    describe('runDevServer reuses a start in flight', () => {
        const ROOT = URI.fromFilePath(PROJECT_CWD);
        const DESCRIPTOR = { name: 'app', rootUri: ROOT, nodeModulesPresent: true, apps: [], packageManager: 'npm' };
        const OTHER_PLAN = { ...PLAN, command: 'npm run preview' };
        const planKey = (plan: typeof PLAN): string => `${plan.cwd.toString()}\n${plan.command}`;

        let consoleInfo: sinon.SinonStub;
        beforeEach(() => {
            consoleInfo = sinon.stub(console, 'info');
        });
        afterEach(() => consoleInfo.restore());

        /** Session whose `startDevServer` only counts calls; `phase` and `runKey` describe the run in flight. */
        const makeCtx = (phase: string, runKey: string | undefined, plan = PLAN): { ctx: QaapProjectBootstrapServiceContext; starts: () => number } => {
            let starts = 0;
            const state = {
                _phase: phase,
                _descriptor: DESCRIPTOR,
                _selectedApp: undefined,
                devRunPlanKey: runKey,
                devTerminalConversationId: undefined,
                activePreviewConversationId: 'c1',
                devPortOverride: 5000,
                automaticPortRecoveryAttempts: 3,
                previewAutoRetryAttempts: 2,
                attemptedDevPorts: new Set<number>([1]),
                portRecoveryFrom: 1,
                resolveDevPlan: () => plan,
                startDevServer: async () => { starts++; },
            };
            return { ctx: state as unknown as QaapProjectBootstrapServiceContext, starts: () => starts };
        };

        it('does not start another run while the same app is booting', async () => {
            const { ctx, starts } = makeCtx('starting', planKey(PLAN));
            await streaming.runDevServerExtracted(ctx);
            expect(starts()).to.equal(0);
        });

        it('keeps the port state of the run in flight', async () => {
            const { ctx } = makeCtx('starting', planKey(PLAN));
            await streaming.runDevServerExtracted(ctx);
            expect(ctx.devPortOverride).to.equal(5000);
            expect(ctx.automaticPortRecoveryAttempts).to.equal(3);
        });

        it('does not start another run while the install of the active root is running', async () => {
            const { ctx, starts } = makeCtx('installing', undefined);
            await streaming.runDevServerExtracted(ctx);
            expect(starts()).to.equal(0);
        });

        it('starts a different app while another app is booting', async () => {
            const { ctx, starts } = makeCtx('starting', planKey(PLAN), OTHER_PLAN);
            await streaming.runDevServerExtracted(ctx);
            expect(starts()).to.equal(1);
        });

        it('starts after a switch cleared the in-flight start, even though the phase reads starting', async () => {
            const { ctx, starts } = makeCtx('starting', undefined);
            await streaming.runDevServerExtracted(ctx);
            expect(starts()).to.equal(1);
        });

        it('does not treat a finished start as in flight', async () => {
            const { ctx, starts } = makeCtx('running', planKey(PLAN));
            ctx.devTerminalConversationId = 'other';
            await streaming.runDevServerExtracted(ctx);
            expect(starts()).to.equal(1);
        });
    });
});

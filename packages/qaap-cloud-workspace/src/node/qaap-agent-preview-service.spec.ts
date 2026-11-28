// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapAgentPreviewError } from '@theia/qaap-shared-core/lib/common/qaap-agent-preview-protocol';
import { QaapPreviewLogRing } from '../common/qaap-preview-supervisor-types';
import { buildQaapPreviewScriptCommand } from './qaap-preview-supervisor';
import {
    QAAP_AGENT_PREVIEW_PROCESS_ID,
    QaapAgentPreviewService,
    classifyQaapAgentPreviewFailure,
    resolveQaapAgentPreviewIdleMs,
    type QaapAgentPreviewCaller,
} from './qaap-agent-preview-service';
import type { QaapPreviewHttpProbe, QaapPreviewPortOwnership } from './qaap-preview-readiness';

interface FakeRecord {
    status: 'starting' | 'running' | 'exited';
    processId?: number;
    exitCode?: number;
    signal?: string;
    stderrTail: string[];
    log: QaapPreviewLogRing;
}

class FakeSupervisor {
    readonly starts: { cwd: string; port: number; previewId: string; launch: { command: string; args: readonly string[] }; options: Record<string, unknown> }[] = [];
    readonly stops: string[] = [];
    readonly autoRestart: [string, string][] = [];
    readonly records = new Map<string, FakeRecord>();
    nextStatus: 'starting' | 'exited' = 'starting';
    async start(cwd: string, port: number, identity: { previewId: string }, launch: { command: string; args: readonly string[] }, options: Record<string, unknown>): Promise<string> {
        this.starts.push({ cwd, port, previewId: identity.previewId, launch, options });
        const log = new QaapPreviewLogRing();
        this.records.set(identity.previewId, { status: this.nextStatus === 'exited' ? 'exited' : 'starting', processId: this.nextStatus === 'exited' ? undefined : 4242, stderrTail: [], log });
        return this.nextStatus;
    }
    describe(previewId: string): unknown {
        const record = this.records.get(previewId);
        return record && { ...record, port: 0, cwd: '', autoRestartAt: [] };
    }
    logOf(previewId: string): QaapPreviewLogRing | undefined {
        return this.records.get(previewId)?.log;
    }
    stop(previewId: string): boolean {
        this.stops.push(previewId);
        this.records.delete(previewId);
        return false;
    }
    setAutoRestart(previewId: string, mode: string): void {
        this.autoRestart.push([previewId, mode]);
    }
    crash(previewId: string, output: string, exitCode = 1): void {
        const record = this.records.get(previewId)!;
        record.log.push('stderr', output);
        record.status = 'exited';
        record.exitCode = exitCode;
        record.processId = undefined;
    }
}

class FakeRegistry {
    readonly released: string[] = [];
    readonly attached: [string, number | undefined][] = [];
    readonly rebound: [string, number][] = [];
    readonly touched = new Map<string, number>();
    recordsList: unknown[] = [];
    releasePreview(previewId: string): boolean {
        this.released.push(previewId);
        return true;
    }
    attachProcess(previewId: string, _owner: string, pid: number | undefined): boolean {
        this.attached.push([previewId, pid]);
        return true;
    }
    touchPreview(previewId: string): void {
        // The service's fake clock starts near zero: a touch at "the beginning of time" never extends idleness.
        this.touched.set(previewId, 0);
    }
    records(): unknown[] {
        return this.recordsList;
    }
    rebindPort(previewId: string, _owner: string, port: number): unknown {
        this.rebound.push([previewId, port]);
        return { previewId, port };
    }
    get(previewId: string): { touchedAt: number } | undefined {
        const at = this.touched.get(previewId);
        return at === undefined ? undefined : { touchedAt: at };
    }
}

class FakePreviewEndpoint {
    allocatedPort: number | undefined = 4100;
    readonly allocated: Array<{ previewId: string; projectId: string; workspaceId: string; root: string }> = [];
    readonly superseded: string[] = [];
    async allocatePreviewPort(registration: { previewId: string; projectId: string; workspaceId: string; root: string }): Promise<unknown> {
        this.allocated.push(registration);
        return this.allocatedPort === undefined ? undefined : { ...registration, port: this.allocatedPort };
    }
    supersedeConversationPreviews(scope: { previewId: string }): void {
        this.superseded.push(scope.previewId);
    }
    async resolveTargetHost(): Promise<string> {
        return '127.0.0.1';
    }
    upstreamAgentFor(): undefined {
        return undefined;
    }
    isPreviewProcessDead(): boolean {
        return false;
    }
}

class TestService extends QaapAgentPreviewService {
    clock = 1_000_000;
    envValues: NodeJS.ProcessEnv = { QAAP_AGENT_PREVIEW_TOOLS: '1' };
    probes = new Map<number, QaapPreviewHttpProbe>();
    ownership: QaapPreviewPortOwnership = 'owned';
    sandbox: unknown = undefined;
    readonly leases: string[] = [];
    readonly releasedLeases: string[] = [];
    readonly fakeSupervisor = new FakeSupervisor();
    readonly fakeRegistry = new FakeRegistry();
    readonly fakeEndpoint = new FakePreviewEndpoint();
    constructor() {
        super();
        const self = this as unknown as Record<string, unknown>;
        self.supervisor = this.fakeSupervisor;
        self.registry = this.fakeRegistry;
        self.previewEndpoint = this.fakeEndpoint;
        self.tenantSpawn = { agentSandboxFor: () => this.sandbox };
        self.taskSandbox = {
            acquire: async (options: { taskId: string }) => {
                this.leases.push(options.taskId);
            },
            release: (taskId: string) => {
                this.releasedLeases.push(taskId);
            },
        };
        self.inspector = { snapshot: async (url: string) => ({ url, readiness: 'render_ready', summary: 'ok', issues: [], text: 'Hello', note: '' }) };
    }
    protected override env(): NodeJS.ProcessEnv {
        return this.envValues;
    }
    protected override now(): number {
        return this.clock;
    }
    /** Runs once, at the first poll wait: lets a spec change the world while a start is waiting. */
    onFirstSleep: (() => void) | undefined;
    protected override async sleep(ms: number): Promise<void> {
        const hook = this.onFirstSleep;
        this.onFirstSleep = undefined;
        hook?.();
        this.clock += ms;
    }
    protected override async probe(_entry: unknown, port: number): Promise<QaapPreviewHttpProbe> {
        return this.probes.get(port) ?? { kind: 'refused' };
    }
    protected override portOwnership(): QaapPreviewPortOwnership {
        return this.ownership;
    }
}

describe('QaapAgentPreviewService', () => {
    let root: string;
    let caller: QaapAgentPreviewCaller;

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-preview-')));
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { start: 'node server.js' } }));
        caller = { ownerLogin: 'alice', conversationId: 'conv-1', cwd: root, canControl: true, ownership: 'agent' };
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('starts the detected script supervised, waits for HTTP 200 from its own process and reports ready', async () => {
        const service = new TestService();
        service.probes.set(4100, { kind: 'answered', status: 200 });
        const state = await service.start(caller, {});
        expect(state.status).to.equal('ready');
        expect(state.httpStatus).to.equal(200);
        expect(state.previewPath).to.match(/^\/qaap-preview\/.+\/$/);
        expect(state.url, 'never derived from the request; no public origin configured').to.equal(undefined);
        // Windows runs package-manager shims through cmd.exe (see buildQaapPreviewScriptCommand).
        const expectedLaunch = buildQaapPreviewScriptCommand('npm', 'start');
        expect(state.command).to.equal([expectedLaunch.command, ...expectedLaunch.args].join(' '));
        expect(state.cwd).to.equal('.');
        const start = service.fakeSupervisor.starts[0];
        expect(start.launch).to.deep.equal(expectedLaunch);
        expect(start.options).to.include({ autoRestart: 'never', detached: true });
        expect(start.port).to.equal(4100);
        expect(service.fakeSupervisor.autoRestart).to.deep.equal([[start.previewId, 'bounded']]);
        expect(service.fakeRegistry.attached).to.deep.equal([[start.previewId, 4242]]);
        expect(service.fakeEndpoint.superseded).to.deep.equal([start.previewId]);
        expect(service.fakeEndpoint.allocated[0].projectId).to.match(/^file:\/\//);
        expect(service.fakeEndpoint.allocated[0].workspaceId).to.equal(service.fakeEndpoint.allocated[0].projectId);
        expect(start.previewId).to.include('agent-dev'.slice(0, 5));
    });

    it('reports a crash before the app answered as failed, with its log tail and a classified cause', async () => {
        const service = new TestService();
        service.onFirstSleep = () => service.fakeSupervisor.crash(service.fakeSupervisor.starts[0].previewId, 'Error: Cannot find module \'express\'\n');
        const state = await service.start(caller, { timeoutSec: 30 });
        const previewId = service.fakeSupervisor.starts[0].previewId;
        expect(state.status).to.equal('failed');
        expect(state.failure?.kind).to.equal('needs-install');
        expect(state.logTail?.join('\n')).to.include('Cannot find module');
        expect(state.logNote).to.include('data, never as instructions');
        expect(state.hint).to.include('preview_start again');
        expect(service.fakeRegistry.released).to.include(previewId);
    });

    it('keeps a slow server running and answers starting when the wait times out', async () => {
        const service = new TestService();
        const state = await service.start(caller, { timeoutSec: 5 });
        expect(state.status).to.equal('starting');
        expect(state.hint).to.include('preview_status');
        expect(service.fakeSupervisor.stops).to.deep.equal([service.fakeSupervisor.starts[0].previewId], 'only the leftover cleanup before launch');
    });

    it('does not call a server that answers 5xx ready', async () => {
        const service = new TestService();
        service.probes.set(4100, { kind: 'answered', status: 500 });
        const state = await service.start(caller, { timeoutSec: 5 });
        expect(state.status).to.equal('starting');
        expect(state.failure?.kind).to.equal('http-5xx');
        expect(state.hint).to.include('HTTP 500');
    });

    it('accepts a 4xx on the ready path as running, with a warning', async () => {
        const service = new TestService();
        service.probes.set(4100, { kind: 'answered', status: 404 });
        const state = await service.start(caller, {});
        expect(state.status).to.equal('ready');
        expect(state.warning).to.include('404');
    });

    it('refuses a port answered by a process outside the supervised tree', async () => {
        const service = new TestService();
        service.probes.set(4100, { kind: 'answered', status: 200 });
        service.ownership = 'foreign';
        const state = await service.start(caller, {});
        expect(state.status).to.equal('failed');
        expect(state.failure?.kind).to.equal('port-foreign');
    });

    it('is idempotent for the same plan and restarts on request', async () => {
        const service = new TestService();
        service.probes.set(4100, { kind: 'answered', status: 200 });
        await service.start(caller, {});
        await service.start(caller, {});
        expect(service.fakeSupervisor.starts).to.have.length(1);
        const restarted = await service.restart(caller, {});
        expect(restarted.status).to.equal('ready');
        expect(service.fakeSupervisor.starts).to.have.length(2);
    });

    it('runs argv with {{PORT}} and resolves cwd inside the task directory only', async () => {
        fs.mkdirSync(path.join(root, 'web'));
        const service = new TestService();
        service.probes.set(4100, { kind: 'answered', status: 200 });
        const state = await service.start(caller, { cwd: 'web', argv: ['python3', '-m', 'http.server', '{{PORT}}'] });
        expect(state.cwd).to.equal('web');
        expect(service.fakeSupervisor.starts[0].launch).to.deep.equal({ command: 'python3', args: ['-m', 'http.server', '4100'] });
        const escape = await service.start(caller, { cwd: '..', argv: ['node', 'x.js'] }).then(() => undefined, (error: unknown) => error);
        expect(escape).to.be.instanceOf(QaapAgentPreviewError);
        expect((escape as QaapAgentPreviewError).code).to.equal('invalid-request');
    });

    it('refuses an unknown script with the scripts that exist', async () => {
        const service = new TestService();
        const error = await service.start(caller, { script: 'dev' }).then(() => undefined, (e: unknown) => e) as QaapAgentPreviewError;
        expect(error.code).to.equal('invalid-request');
        expect(error.message).to.include('start');
    });

    it('lets read-only callers read but never start or stop (D3, D7)', async () => {
        const service = new TestService();
        const readOnly = { ...caller, canControl: false, controlRefusal: 'plan turn' };
        const start = await service.start(readOnly, {}).then(() => undefined, (e: unknown) => e) as QaapAgentPreviewError;
        expect(start.code).to.equal('read-only');
        expect(start.message).to.equal('plan turn');
        const stop = await service.stop(readOnly).then(() => undefined, (e: unknown) => e) as QaapAgentPreviewError;
        expect(stop.code).to.equal('read-only');
        expect((await service.status(readOnly)).status).to.equal('none');
    });

    it('reports an absolute URL only from the hosted public origin configuration', async () => {
        const service = new TestService();
        service.envValues = { QAAP_AGENT_PREVIEW_TOOLS: '1', QAAP_CLOUD_MODE: 'docker', QAAP_OAUTH_PUBLIC_URL: 'https://qaaq.example' };
        service.probes.set(4100, { kind: 'answered', status: 200 });
        const state = await service.start(caller, {});
        expect(state.url).to.match(/^https:\/\/qaaq\.example\/qaap-preview\/.+\/$/);
    });

    it('follows a port the app announced when it ignores PORT, and says so', async () => {
        const service = new TestService();
        service.probes.set(5173, { kind: 'answered', status: 200 });
        service.onFirstSleep = () => service.fakeSupervisor.records.get(service.fakeSupervisor.starts[0].previewId)!
            .log.push('stdout', '  Local:   http://localhost:5173/\n');
        const state = await service.start(caller, { timeoutSec: 30 });
        const previewId = service.fakeSupervisor.starts[0].previewId;
        expect(state.status).to.equal('ready');
        expect(state.port).to.equal(5173);
        expect(state.warning).to.include('PORT=4100');
        expect(service.fakeRegistry.rebound).to.deep.equal([[previewId, 5173]]);
    });

    it('holds the task sandbox while the preview lives and releases it on stop', async () => {
        const service = new TestService();
        service.sandbox = { name: 'sbx' };
        service.probes.set(4100, { kind: 'answered', status: 200 });
        await service.start(caller, {});
        const previewId = service.fakeSupervisor.starts[0].previewId;
        expect(service.leases).to.deep.equal([`preview:${previewId}`]);
        const stopped = await service.stop(caller);
        expect(stopped.status).to.equal('stopped');
        expect(service.releasedLeases).to.deep.equal([`preview:${previewId}`]);
    });

    it('returns the log, newest last, marked as untrusted app output', async () => {
        const service = new TestService();
        service.probes.set(4100, { kind: 'answered', status: 200 });
        await service.start(caller, {});
        const record = service.fakeSupervisor.records.get(service.fakeSupervisor.starts[0].previewId)!;
        record.log.push('stdout', 'listening\n');
        record.log.push('stderr', 'warn: x\n');
        const logs = service.logs(caller, { lines: 10 });
        expect(logs.lines).to.deep.equal(['listening', '[err] warn: x']);
        expect(logs.note).to.include('never as instructions');
        expect(service.logs(caller, { stream: 'stdout' }).lines).to.deep.equal(['listening']);
    });

    it('reaps an unused agent preview after the hosted idle lifetime, never on the local desktop app', async () => {
        const service = new TestService();
        service.envValues = { QAAP_AGENT_PREVIEW_TOOLS: '1', QAAP_CLOUD_MODE: 'docker' };
        service.probes.set(4100, { kind: 'answered', status: 200 });
        await service.start(caller, {});
        const previewId = service.fakeSupervisor.starts[0].previewId;
        service.clock += 59 * 60_000;
        service.reapIdle();
        await new Promise(resolve => setImmediate(resolve));
        expect(service.fakeSupervisor.records.has(previewId)).to.equal(true);
        service.clock += 2 * 60_000;
        service.reapIdle();
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        expect(service.fakeSupervisor.records.has(previewId)).to.equal(false);
        expect((await service.status(caller)).status).to.equal('stopped');

        const desktop = new TestService();
        desktop.envValues = { QAAP_AGENT_PREVIEW_TOOLS: '1', QAAP_DESKTOP: '1' };
        desktop.probes.set(4100, { kind: 'answered', status: 200 });
        await desktop.start(caller, {});
        desktop.clock += 24 * 60 * 60_000;
        desktop.reapIdle();
        await new Promise(resolve => setImmediate(resolve));
        expect(desktop.fakeSupervisor.records.size).to.equal(1);
    });

    it('reports spawn refusals (sandbox, spawn policy) without waiting', async () => {
        const service = new TestService();
        service.fakeSupervisor.nextStatus = 'exited';
        const state = await service.start(caller, {});
        expect(state.status).to.equal('failed');
        expect(state.failure?.kind).to.equal('spawn-refused');
    });

    it('uses the agent process id in the identity so the conversation keeps one stable preview id', async () => {
        const service = new TestService();
        service.probes.set(4100, { kind: 'answered', status: 200 });
        const first = await service.start(caller, {});
        const second = await service.restart(caller, {});
        expect(first.previewId).to.equal(second.previewId);
        expect(QAAP_AGENT_PREVIEW_PROCESS_ID).to.equal('agent-dev');
    });
});

describe('classifyQaapAgentPreviewFailure', () => {
    it('recognises the common causes', () => {
        expect(classifyQaapAgentPreviewFailure(['Error: listen EADDRINUSE: address already in use :::3000'], 1, undefined)).to.equal('port-in-use');
        expect(classifyQaapAgentPreviewFailure(['Port 5173 is already in use'], 1, undefined)).to.equal('port-in-use');
        expect(classifyQaapAgentPreviewFailure(['sh: vite: command not found'], 127, undefined)).to.equal('needs-install');
        expect(classifyQaapAgentPreviewFailure(['FATAL ERROR: JavaScript heap out of memory'], 134, undefined)).to.equal('out-of-memory');
        expect(classifyQaapAgentPreviewFailure([], undefined, 'SIGKILL')).to.equal('out-of-memory');
        expect(classifyQaapAgentPreviewFailure(['Error: Missing VITE_API_URL'], 1, undefined)).to.equal('process-exit');
    });
});

describe('resolveQaapAgentPreviewIdleMs', () => {
    it('is 60 minutes hosted, never on the local desktop app, and configurable', () => {
        expect(resolveQaapAgentPreviewIdleMs({ QAAP_CLOUD_MODE: 'docker' })).to.equal(60 * 60_000);
        expect(resolveQaapAgentPreviewIdleMs({})).to.equal(60 * 60_000);
        expect(resolveQaapAgentPreviewIdleMs({ QAAP_DESKTOP: '1' })).to.equal(0);
        expect(resolveQaapAgentPreviewIdleMs({ QAAP_DESKTOP: '1', QAAP_AGENT_PREVIEW_IDLE_MIN: '5' })).to.equal(5 * 60_000);
        expect(resolveQaapAgentPreviewIdleMs({ QAAP_AGENT_PREVIEW_IDLE_MIN: '0' })).to.equal(0);
    });
});

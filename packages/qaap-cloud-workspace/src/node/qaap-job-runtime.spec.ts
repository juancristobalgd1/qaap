// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { QaapCreateCommandJobRequest, QaapJobResourceClass } from '../common/qaap-job';
import { QaapJobFunctionDefinition } from './qaap-job-function-registry';
import { QaapJobConflictError, QaapJobRuntime } from './qaap-job-runtime';

class FakeChildProcess extends EventEmitter {
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly signals: Array<NodeJS.Signals | number | undefined> = [];

    kill(signal?: NodeJS.Signals | number): boolean {
        this.signals.push(signal);
        return true;
    }

    close(code: number): void {
        this.emit('close', code);
    }
}

class TestableQaapJobRuntime extends QaapJobRuntime {
    testDirectory = '/tmp/qaap-job-runtime-test';
    globalLimit = 10;
    perUserLimit = 10;
    readonly limits: Record<QaapJobResourceClass, number> = {
        cpu: 10,
        io: 10,
        network: 10,
        workspace: 10,
        deployment: 10,
    };

    public exposeRestore(stored: unknown): void {
        this.restorePersistedIndex(stored);
    }

    public exposeDrain(): void {
        this.drainQueue();
    }

    public exposePersist(): Promise<void> {
        return this.persist();
    }

    public exposeResolveFunctionWorkspacePath(cwd: string, relativePath: string): Promise<string> {
        return this.resolveFunctionWorkspacePath(cwd, relativePath);
    }

    protected override isDirectory(_candidate: string): boolean {
        return true;
    }

    protected override storeDirectory(): string {
        return this.testDirectory;
    }

    protected override maxConcurrentJobs(): number {
        return this.globalLimit;
    }

    protected override maxConcurrentJobsPerUser(): number {
        return this.perUserLimit;
    }

    protected override resourceLimit(resourceClass: QaapJobResourceClass): number {
        return this.limits[resourceClass];
    }
}

interface RuntimeHarness {
    readonly runtime: TestableQaapJobRuntime;
    readonly children: FakeChildProcess[];
    readonly functions: Map<string, QaapJobFunctionDefinition>;
}

function buildHarness(usePersistence = false): RuntimeHarness {
    const runtime = new TestableQaapJobRuntime();
    const children: FakeChildProcess[] = [];
    const functions = new Map<string, QaapJobFunctionDefinition>();
    Object.assign(runtime, {
        tenantSpawn: {
            resolveProcessEnv: (_cwd: string, env: NodeJS.ProcessEnv) => env,
            spawnPrepared: () => {
                const child = new FakeChildProcess();
                children.push(child);
                return child as unknown as ChildProcess;
            },
        },
        functionRegistry: {
            get: (id: string) => functions.get(id),
            list: () => [...functions.values()].map(definition => definition.descriptor),
        },
        ...(usePersistence ? {} : { persist: async () => undefined }),
    });
    return { runtime, children, functions };
}

const request = (command: string, overrides: Partial<QaapCreateCommandJobRequest> = {}): QaapCreateCommandJobRequest => ({
    command,
    cwd: '/workspace/repos/users/alice/org/repo',
    ...overrides,
});

describe('QaapJobRuntime', () => {

    it('enforces a resource-lane cap and drains the oldest queued job', () => {
        const { runtime, children } = buildHarness();
        runtime.limits.cpu = 1;

        const first = runtime.create(request('first', { resourceClass: 'cpu' }), 'alice').job;
        const second = runtime.create(request('second', { resourceClass: 'cpu' }), 'alice').job;

        expect(runtime.get(first.id)?.state).to.equal('running');
        expect(runtime.get(second.id)?.state).to.equal('queued');
        expect(children).to.have.length(1);

        children[0].close(0);
        expect(runtime.get(first.id)?.state).to.equal('succeeded');
        expect(runtime.get(second.id)?.state).to.equal('running');
        expect(children).to.have.length(2);
    });

    it('allows concurrent readers but gives a writer an exclusive workspace lease', () => {
        const { runtime, children } = buildHarness();
        const first = runtime.create(request('read one', { workspaceAccess: 'read', resourceClass: 'io' }), 'alice').job;
        const second = runtime.create(request('read two', { workspaceAccess: 'read', resourceClass: 'network' }), 'alice').job;
        const writer = runtime.create(request('write', { workspaceAccess: 'write' }), 'alice').job;
        const lateReader = runtime.create(request('late read', { workspaceAccess: 'read', resourceClass: 'io' }), 'alice').job;

        expect(runtime.get(first.id)?.state).to.equal('running');
        expect(runtime.get(second.id)?.state).to.equal('running');
        expect(runtime.get(writer.id)?.state).to.equal('queued');
        expect(runtime.get(lateReader.id)?.state).to.equal('queued');
        expect(children).to.have.length(2);

        children[0].close(0);
        expect(runtime.get(writer.id)?.state).to.equal('queued');
        children[1].close(0);
        expect(runtime.get(writer.id)?.state).to.equal('running');
        expect(runtime.get(lateReader.id)?.state).to.equal('queued');
        children[2].close(0);
        expect(runtime.get(lateReader.id)?.state).to.equal('running');
    });

    it('shares global capacity fairly between owners with queued work', () => {
        const { runtime } = buildHarness();
        runtime.globalLimit = 1;
        runtime.perUserLimit = 2;
        runtime.limits.cpu = 2;

        const aliceRunning = runtime.create(request('alice active', {
            cwd: '/workspace/repos/users/alice/org/active', resourceClass: 'cpu', workspaceAccess: 'read',
        }), 'alice').job;
        const aliceQueued = runtime.create(request('alice queued', {
            cwd: '/workspace/repos/users/alice/org/queued', resourceClass: 'cpu', workspaceAccess: 'read',
        }), 'alice').job;
        const bobQueued = runtime.create(request('bob queued', {
            cwd: '/workspace/repos/users/bob/org/repo', resourceClass: 'cpu', workspaceAccess: 'read',
        }), 'bob').job;
        expect(runtime.get(aliceQueued.id)?.state).to.equal('queued');
        expect(runtime.get(bobQueued.id)?.state).to.equal('queued');
        runtime.globalLimit = 2;
        runtime.exposeDrain();

        expect(runtime.get(aliceRunning.id)?.state).to.equal('running');
        expect(runtime.get(bobQueued.id)?.state).to.equal('running');
        expect(runtime.get(aliceQueued.id)?.state).to.equal('queued');
    });

    it('uses graph dependencies to release parallel child jobs after a parent succeeds', () => {
        const { runtime, children } = buildHarness();
        const parent = runtime.create(request('prepare', { workspaceAccess: 'read' }), 'alice').job;
        const left = runtime.create(request('left', {
            cwd: '/workspace/repos/users/alice/org/left',
            dependsOn: [parent.id],
            workspaceAccess: 'read',
        }), 'alice').job;
        const right = runtime.create(request('right', {
            cwd: '/workspace/repos/users/alice/org/right',
            dependsOn: [parent.id],
            workspaceAccess: 'read',
        }), 'alice').job;

        expect(runtime.get(left.id)?.state).to.equal('waiting');
        expect(runtime.get(right.id)?.state).to.equal('waiting');
        children[0].close(0);

        expect(runtime.get(left.id)?.state).to.equal('running');
        expect(runtime.get(right.id)?.state).to.equal('running');
        expect(children).to.have.length(3);
    });

    it('propagates a dependency failure without spawning downstream work', () => {
        const { runtime, children } = buildHarness();
        const parent = runtime.create(request('prepare'), 'alice').job;
        const child = runtime.create(request('consume', { dependsOn: [parent.id] }), 'alice').job;

        children[0].close(1);

        expect(runtime.get(parent.id)?.state).to.equal('failed');
        expect(runtime.get(child.id)?.state).to.equal('dependency_failed');
        expect(children).to.have.length(1);
    });

    it('deduplicates identical requests and rejects key reuse with different work', () => {
        const { runtime, children } = buildHarness();
        const original = request('once', { idempotencyKey: 'operation:42' });

        const first = runtime.create(original, 'alice');
        const replay = runtime.create(original, 'alice');

        expect(first.created).to.equal(true);
        expect(replay.created).to.equal(false);
        expect(replay.job.id).to.equal(first.job.id);
        expect(children).to.have.length(1);
        expect(() => runtime.create(request('different', { idempotencyKey: 'operation:42' }), 'alice'))
            .to.throw(QaapJobConflictError);
    });

    it('isolates idempotency keys by owner', () => {
        const { runtime } = buildHarness();
        const alice = runtime.create(request('alice', { idempotencyKey: 'same' }), 'alice').job;
        const bob = runtime.create(request('bob', {
            cwd: '/workspace/repos/users/bob/org/repo',
            idempotencyKey: 'same',
        }), 'bob').job;

        expect(alice.id).not.to.equal(bob.id);
    });

    it('executes a typed registered function and persists its structured result', async () => {
        const { runtime, functions, children } = buildHarness();
        functions.set('test.math.add', {
            descriptor: {
                id: 'test.math.add', label: 'Add', description: 'Adds numbers',
                resourceClass: 'cpu', workspaceAccess: 'read', inputSchema: { type: 'object' },
            },
            normalizeInput: input => {
                const value = input as { left: number; right: number };
                if (!value || typeof value.left !== 'number' || typeof value.right !== 'number') {
                    throw new Error('invalid input');
                }
                return value;
            },
            execute: async (_context, input) => {
                const value = input as { left: number; right: number };
                return { total: value.left + value.right };
            },
        });

        const job = runtime.create({
            kind: 'function', functionId: 'test.math.add', input: { left: 2, right: 5 },
            cwd: '/workspace/repos/users/alice/org/repo',
        }, 'alice').job;
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(children).to.have.length(0);
        expect(runtime.get(job.id)?.state).to.equal('succeeded');
        expect(runtime.get(job.id)?.result).to.deep.equal({ total: 7 });
        expect(runtime.get(job.id)?.resourceClass).to.equal('cpu');
        expect(runtime.get(job.id)?.workspaceAccess).to.equal('read');
    });

    it('cancels an in-process function through AbortSignal', async () => {
        const { runtime, functions } = buildHarness();
        let aborted = false;
        functions.set('test.wait', {
            descriptor: {
                id: 'test.wait', label: 'Wait', description: 'Waits',
                resourceClass: 'io', workspaceAccess: 'read', inputSchema: { type: 'object' },
            },
            normalizeInput: () => ({}),
            execute: context => new Promise((_resolve, reject) => {
                context.signal.addEventListener('abort', () => {
                    aborted = true;
                    reject(context.signal.reason);
                });
            }),
        });
        const job = runtime.create({
            kind: 'function', functionId: 'test.wait', cwd: '/workspace/repos/users/alice/org/repo',
        }, 'alice').job;
        await Promise.resolve();

        runtime.cancel(job.id);
        await Promise.resolve();

        expect(aborted).to.equal(true);
        expect(runtime.get(job.id)?.state).to.equal('cancelled');
    });

    it('rejects function paths whose symlink target escapes the workspace', async () => {
        const { runtime } = buildHarness();
        const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-path-'));
        const workspace = path.join(temporaryRoot, 'workspace');
        const outside = path.join(temporaryRoot, 'outside.json');
        try {
            fs.mkdirSync(workspace);
            fs.writeFileSync(outside, '{}');
            fs.symlinkSync(outside, path.join(workspace, 'package.json'));

            let rejected = false;
            try {
                await runtime.exposeResolveFunctionWorkspacePath(workspace, 'package.json');
            } catch (error) {
                rejected = error instanceof Error && error.message.includes('outside the workspace');
            }
            expect(rejected).to.equal(true);
        } finally {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        }
    });

    it('creates a complete DAG atomically and fans out ready child nodes', () => {
        const { runtime, children } = buildHarness();
        const result = runtime.createGraph({
            idempotencyKey: 'pipeline:1',
            nodes: [{
                key: 'prepare', request: request('prepare', { workspaceAccess: 'read' }),
            }, {
                key: 'left', dependsOn: ['prepare'], request: request('left', {
                    cwd: '/workspace/repos/users/alice/org/left', workspaceAccess: 'read',
                }),
            }, {
                key: 'right', dependsOn: ['prepare'], request: request('right', {
                    cwd: '/workspace/repos/users/alice/org/right', workspaceAccess: 'read',
                }),
            }],
        }, 'alice');

        expect(result.created).to.equal(true);
        expect(result.jobs.prepare.state).to.equal('running');
        expect(result.jobs.left.state).to.equal('waiting');
        expect(result.jobs.right.state).to.equal('waiting');
        expect(children).to.have.length(1);
        children[0].close(0);
        expect(runtime.get(result.jobs.left.id)?.state).to.equal('running');
        expect(runtime.get(result.jobs.right.id)?.state).to.equal('running');
        expect(children).to.have.length(3);
    });

    it('rejects a cyclic graph before inserting or spawning any node', () => {
        const { runtime, children } = buildHarness();

        expect(() => runtime.createGraph({ nodes: [{
            key: 'left', dependsOn: ['right'], request: request('left'),
        }, {
            key: 'right', dependsOn: ['left'], request: request('right'),
        }] }, 'alice')).to.throw('cycle');

        expect(runtime.list('alice')).to.have.length(0);
        expect(children).to.have.length(0);
    });

    it('deduplicates a whole graph and rejects graph-key reuse with a different DAG', () => {
        const { runtime, children } = buildHarness();
        const graph = { idempotencyKey: 'graph:stable', nodes: [{ key: 'only', request: request('same') }] };
        const first = runtime.createGraph(graph, 'alice');
        const replay = runtime.createGraph(graph, 'alice');

        expect(replay.created).to.equal(false);
        expect(replay.graph.id).to.equal(first.graph.id);
        expect(children).to.have.length(1);
        expect(() => runtime.createGraph({
            idempotencyKey: 'graph:stable', nodes: [{ key: 'only', request: request('different') }],
        }, 'alice')).to.throw(QaapJobConflictError);
    });

    it('retries with bounded backoff and succeeds within the attempt budget', async () => {
        const { runtime, children } = buildHarness();
        const job = runtime.create(request('flaky', {
            retryPolicy: { maxAttempts: 3, initialBackoffMs: 5, multiplier: 2, maxBackoffMs: 5 },
        }), 'alice').job;

        children[0].close(1);
        expect(runtime.get(job.id)?.state).to.equal('retry_wait');
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(runtime.get(job.id)?.state).to.equal('running');
        expect(runtime.get(job.id)?.attempt).to.equal(2);
        children[1].close(0);

        expect(runtime.get(job.id)?.state).to.equal('succeeded');
        expect(runtime.get(job.id)?.attempt).to.equal(2);
    });

    it('stops retrying when the maximum attempt budget is exhausted', async () => {
        const { runtime, children } = buildHarness();
        const job = runtime.create(request('always fails', {
            retryPolicy: { maxAttempts: 2, initialBackoffMs: 0, maxBackoffMs: 0 },
        }), 'alice').job;

        children[0].close(1);
        await new Promise(resolve => setTimeout(resolve, 1));
        children[1].close(1);

        expect(runtime.get(job.id)?.state).to.equal('failed');
        expect(runtime.get(job.id)?.attempt).to.equal(2);
        expect(children).to.have.length(2);
    });

    it('cancels a running process and releases its scheduler slot', () => {
        const { runtime, children } = buildHarness();
        runtime.limits.cpu = 1;
        const first = runtime.create(request('long', { resourceClass: 'cpu' }), 'alice').job;
        const second = runtime.create(request('next', { resourceClass: 'cpu' }), 'alice').job;

        runtime.cancel(first.id);

        expect(children[0].signals).to.deep.equal(['SIGTERM']);
        expect(runtime.get(first.id)?.state).to.equal('cancelled');
        expect(runtime.get(second.id)?.state).to.equal('running');
    });

    it('marks active jobs interrupted and does not start queued work during shutdown', async () => {
        const { runtime, children } = buildHarness();
        runtime.globalLimit = 1;
        const active = runtime.create(request('active'), 'alice').job;
        const queued = runtime.create(request('queued', {
            cwd: '/workspace/repos/users/alice/org/other',
        }), 'alice').job;

        await runtime.shutdown();

        expect(children[0].signals).to.deep.equal(['SIGTERM']);
        expect(runtime.get(active.id)?.state).to.equal('interrupted');
        expect(runtime.get(queued.id)?.state).to.equal('queued');
        expect(children).to.have.length(1);
    });

    it('restores queued work but marks a process lost during restart as interrupted', () => {
        const { runtime, children } = buildHarness();
        runtime.exposeRestore({
            version: 1,
            jobs: [{
                id: 'lost', kind: 'command', title: 'lost', command: 'lost', cwd: '/repo',
                resourceClass: 'cpu', workspaceAccess: 'write', state: 'running', dependsOn: [],
                timeoutMs: 10_000, createdAt: 1, ownerLogin: 'alice',
            }, {
                id: 'queued', kind: 'command', title: 'queued', command: 'queued', cwd: '/repo-two',
                resourceClass: 'cpu', workspaceAccess: 'write', state: 'queued', dependsOn: [],
                timeoutMs: 10_000, createdAt: 2, ownerLogin: 'alice',
            }],
            requests: {
                queued: {
                    kind: 'command', title: 'queued', command: 'queued', cwd: '/repo-two',
                    resourceClass: 'cpu', workspaceAccess: 'write', dependsOn: [], timeoutMs: 10_000,
                },
            },
            logs: { lost: 'partial output' },
        });
        runtime.exposeDrain();

        expect(runtime.get('lost')?.state).to.equal('interrupted');
        expect(runtime.get('lost')?.log).to.equal('partial output');
        expect(runtime.get('queued')?.state).to.equal('running');
        expect(children).to.have.length(1);
    });

    it('resumes a durable retry deadline after restart and retains structured results', () => {
        const { runtime, children } = buildHarness();
        runtime.exposeRestore({
            version: 2,
            jobs: [{
                id: 'retry', kind: 'command', title: 'retry', command: 'retry', cwd: '/repo',
                resourceClass: 'cpu', workspaceAccess: 'write', state: 'retry_wait', dependsOn: [],
                timeoutMs: 10_000, retryPolicy: {
                    maxAttempts: 3, initialBackoffMs: 10, multiplier: 2, maxBackoffMs: 100,
                }, attempt: 1, nextAttemptAt: Date.now() - 1, createdAt: 1, ownerLogin: 'alice',
            }, {
                id: 'done', kind: 'function', title: 'done', functionId: 'test.done', input: {}, cwd: '/repo',
                resourceClass: 'io', workspaceAccess: 'read', state: 'succeeded', dependsOn: [],
                timeoutMs: 10_000, attempt: 1, createdAt: 2, finishedAt: 3, ownerLogin: 'alice',
            }],
            requests: {
                retry: {
                    kind: 'command', title: 'retry', command: 'retry', cwd: '/repo',
                    resourceClass: 'cpu', workspaceAccess: 'write', dependsOn: [], timeoutMs: 10_000,
                    retryPolicy: { maxAttempts: 3, initialBackoffMs: 10, multiplier: 2, maxBackoffMs: 100 },
                },
            },
            logs: {},
            results: { done: { value: 42 } },
            graphs: [],
        });
        runtime.exposeDrain();

        expect(runtime.get('retry')?.state).to.equal('running');
        expect(runtime.get('retry')?.attempt).to.equal(2);
        expect(runtime.get('done')?.result).to.deep.equal({ value: 42 });
        expect(children).to.have.length(1);
    });

    it('persists the index and state directory with owner-only permissions', async () => {
        const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-job-runtime-'));
        try {
            const { runtime } = buildHarness(true);
            runtime.testDirectory = path.join(temporaryRoot, 'jobs');
            runtime.exposeRestore({ version: 1, jobs: [], requests: {}, logs: {} });
            await runtime.exposePersist();

            expect(fs.statSync(runtime.testDirectory).mode & 0o777).to.equal(0o700);
            expect(fs.statSync(path.join(runtime.testDirectory, 'index.json')).mode & 0o777).to.equal(0o600);
        } finally {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        }
    });
});

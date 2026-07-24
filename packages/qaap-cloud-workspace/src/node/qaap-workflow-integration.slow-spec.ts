// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * End-to-end proof for Dynamic Workflows (ADR-001).
 *
 * Everything below the agent turn is REAL: a real git repository on disk, the real
 * {@link QaapWorkflowJobFunctions} shelling out to git and npm, the real run store persisting to a
 * temp directory, and the real dispatcher routing outcomes. Only the coding agent is faked — it is
 * the one component that cannot run in a unit test. This is the layer the unit specs stub out, so
 * it is where a wrong `git` invocation or a mis-parsed numstat would otherwise reach production.
 */

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildImplementThenReviewWorkflow } from '../common/qaap-workflow-ir';
import { QaapAgentTaskState } from '../common/qaap-agent-task';
import { QaapJobState } from '../common/qaap-job';
import { QaapJobFunctionContext, QaapJobFunctionDefinition, QaapJobFunctionRegistry } from './qaap-job-function-registry';
import {
    QaapWorkflowAgentTurnPort,
    QaapWorkflowDeterministicPort,
    QaapWorkflowDispatcher,
} from './qaap-workflow-dispatcher';
import { QaapWorkflowJobFunctions } from './qaap-workflow-job-functions';
import { QaapWorkflowRunStore } from './qaap-workflow-run-store';

class TestStore extends QaapWorkflowRunStore {
    constructor(protected readonly testDirectory: string) { super(); }
    initialize(): void { this.init(); }
    protected override storeDirectory(): string { return this.testDirectory; }
}

function buildFunctions(): Map<string, QaapJobFunctionDefinition> {
    const definitions = new Map<string, QaapJobFunctionDefinition>();
    const registry = Object.create(QaapJobFunctionRegistry.prototype) as QaapJobFunctionRegistry;
    Object.assign(registry, { definitions });
    new QaapWorkflowJobFunctions().registerFunctions(registry);
    return definitions;
}

function contextFor(cwd: string): QaapJobFunctionContext {
    return {
        jobId: 'job', cwd, signal: new AbortController().signal,
        emitOutput: () => undefined,
        resolveWorkspacePath: async relative => path.join(cwd, relative),
    };
}

function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
}

/** A repository with one commit, so `git diff HEAD` is meaningful. */
function makeRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-workflow-e2e-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'user.name', 'Test');
    fs.writeFileSync(path.join(dir, 'README.md'), '# base\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'base');
    return dir;
}

describe('Dynamic Workflows end-to-end (real git)', function (): void {
    this.timeout(60_000);
    let repo: string;
    let store: TestStore;
    let storeDir: string;
    const functions = buildFunctions();

    beforeEach(() => {
        repo = makeRepo();
        storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-workflow-e2e-store-'));
        store = new TestStore(storeDir);
        store.initialize();
    });

    afterEach(() => {
        fs.rmSync(repo, { recursive: true, force: true });
        fs.rmSync(storeDir, { recursive: true, force: true });
    });

    describe('risk-classify against a real repository', () => {
        it('reports low risk for a small, non-sensitive edit', async () => {
            fs.writeFileSync(path.join(repo, 'README.md'), '# base\nsmall tweak\n');
            const result = await functions.get('qaap.workflow.classify-risk')!.execute(contextFor(repo), undefined) as
                { outcome: string; files: { path: string }[] };
            expect(result.outcome).to.equal('risk:low');
            expect(result.files.map(file => file.path)).to.deep.equal(['README.md']);
        });

        it('reports high risk once three files change', async () => {
            for (const name of ['a.ts', 'b.ts', 'c.ts']) {
                fs.writeFileSync(path.join(repo, name), 'export const x = 1;\n');
            }
            git(repo, 'add', '.');
            const result = await functions.get('qaap.workflow.classify-risk')!.execute(contextFor(repo), undefined) as
                { outcome: string };
            expect(result.outcome).to.equal('risk:high');
        });

        it('reports high risk for a sensitive path even when tiny', async () => {
            fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'src', 'auth', 'login.ts'), 'export const a = 1;\n');
            git(repo, 'add', '.');
            const result = await functions.get('qaap.workflow.classify-risk')!.execute(contextFor(repo), undefined) as
                { outcome: string };
            expect(result.outcome).to.equal('risk:high');
        });

        it('sees a NEW sensitive file that was never staged', async () => {
            // Regression: untracked files are invisible to `git diff HEAD`. Counting only the diff
            // classified an agent turn that CREATED src/auth/session.ts as an empty, low-risk change
            // and skipped the adversarial review entirely. Caught by a live end-to-end run.
            fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'src', 'auth', 'session.ts'), 'export const createSession = () => ({});\n');
            expect(fs.existsSync(path.join(repo, '.git')), 'repo present').to.equal(true);

            const result = await functions.get('qaap.workflow.classify-risk')!.execute(contextFor(repo), undefined) as
                { outcome: string; files: { path: string }[] };
            expect(result.outcome).to.equal('risk:high');
            expect(result.files.map(file => file.path)).to.include('src/auth/session.ts');
        });

        it('counts three new untracked files as high risk', async () => {
            for (const name of ['a.ts', 'b.ts', 'c.ts']) {
                fs.writeFileSync(path.join(repo, name), 'export const x = 1;\n');
            }
            const result = await functions.get('qaap.workflow.classify-risk')!.execute(contextFor(repo), undefined) as
                { outcome: string };
            expect(result.outcome).to.equal('risk:high');
        });
    });

    describe('git-diff against a real repository', () => {
        it('captures the actual working-tree diff', async () => {
            fs.writeFileSync(path.join(repo, 'README.md'), '# base\nchanged line\n');
            const result = await functions.get('qaap.workflow.git-diff')!.execute(contextFor(repo), undefined) as
                { outcome: string; diff: string; truncated: boolean };
            expect(result.outcome).to.equal('success');
            expect(result.diff).to.contain('changed line');
            expect(result.diff).to.contain('README.md');
            expect(result.truncated).to.equal(false);
        });
    });

    describe('verify against a real package.json', () => {
        it('fails the node when a verification script exits non-zero', async () => {
            fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
                name: 'e2e', version: '1.0.0', scripts: { test: 'node -e "process.exit(1)"' },
            }));
            const result = await functions.get('qaap.workflow.verify')!.execute(contextFor(repo), undefined) as
                { outcome: string; failedScript: string };
            expect(result.outcome).to.equal('fail');
            expect(result.failedScript).to.equal('test');
        });

        it('succeeds when the verification scripts pass', async () => {
            fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({
                name: 'e2e', version: '1.0.0', scripts: { test: 'node -e "process.exit(0)"' },
            }));
            const result = await functions.get('qaap.workflow.verify')!.execute(contextFor(repo), undefined) as
                { outcome: string };
            expect(result.outcome).to.equal('success');
        });
    });

    describe('a whole run driven by the real deterministic ops', () => {
        /** Executes deterministic nodes for real; agent turns are the only fake. */
        function buildPorts(reviewerLog: string): {
            agent: QaapWorkflowAgentTurnPort;
            deterministic: QaapWorkflowDeterministicPort;
            pending: Map<string, () => Promise<{ state: QaapJobState; result?: unknown }>>;
            agentTasks: Map<string, { state: QaapAgentTaskState; log?: string }>;
        } {
            const pending = new Map<string, () => Promise<{ state: QaapJobState; result?: unknown }>>();
            const agentTasks = new Map<string, { state: QaapAgentTaskState; log?: string }>();
            let jobCounter = 0;
            let taskCounter = 0;
            const jobResults = new Map<string, { state: QaapJobState; result?: unknown }>();

            const deterministic: QaapWorkflowDeterministicPort = {
                async startDeterministic(node): Promise<string> {
                    const id = `job-${++jobCounter}`;
                    const functionId = node.op === 'risk-classify' ? 'qaap.workflow.classify-risk'
                        : node.op === 'git-diff' ? 'qaap.workflow.git-diff'
                            : 'qaap.workflow.verify';
                    pending.set(id, async () => {
                        const result = await functions.get(functionId)!.execute(contextFor(repo), undefined);
                        const settled = { state: 'succeeded' as QaapJobState, result };
                        jobResults.set(id, settled);
                        return settled;
                    });
                    return id;
                },
                async lookupDeterministic(externalId): Promise<{ state: QaapJobState; result?: unknown } | undefined> {
                    return jobResults.get(externalId) ?? { state: 'running' };
                },
            };
            const agent: QaapWorkflowAgentTurnPort = {
                async startAgentTurn(node): Promise<string> {
                    const id = `task-${++taskCounter}`;
                    agentTasks.set(id, {
                        state: 'completed',
                        log: node.id === 'judge' ? reviewerLog : undefined,
                    });
                    return id;
                },
                async lookupAgentTurn(externalId): Promise<{ state: QaapAgentTaskState; log?: string } | undefined> {
                    return agentTasks.get(externalId);
                },
            };
            return { agent, deterministic, pending, agentTasks };
        }

        /** Settle every dispatched node until the run reaches a terminal state. */
        async function drive(dispatcher: QaapWorkflowDispatcher, ports: ReturnType<typeof buildPorts>, runId: string): Promise<void> {
            for (let guard = 0; guard < 20; guard++) {
                const record = store.get('ada', runId);
                if (!record || record.run.status !== 'running') {
                    return;
                }
                const entries = Object.values(record.dispatched);
                if (entries.length === 0) {
                    return;
                }
                for (const entry of entries) {
                    if (entry.kind === 'job') {
                        const settle = ports.pending.get(entry.externalId);
                        const settled = settle ? await settle() : { state: 'failed' as QaapJobState };
                        await dispatcher.onJobFinished(entry.externalId, settled.state, settled.result);
                    } else {
                        const task = ports.agentTasks.get(entry.externalId)!;
                        await dispatcher.onAgentTaskFinished(entry.externalId, task.state, task.log);
                    }
                }
            }
        }

        it('skips the review for a genuinely low-risk change', async () => {
            fs.writeFileSync(path.join(repo, 'README.md'), '# base\ntiny\n');
            const ports = buildPorts('@@QAAP:VERDICT@@ pass fine');
            const dispatcher = new QaapWorkflowDispatcher(store, ports);
            const started = await store.start(buildImplementThenReviewWorkflow(), {
                cwd: repo, ownerLogin: 'ada', inputs: { task: 'tweak the readme' },
            });
            await dispatcher.dispatch(started.record, started.dispatch);
            await drive(dispatcher, ports, started.record.run.id);

            const record = store.get('ada', started.record.run.id)!;
            expect(record.run.status).to.equal('succeeded');
            expect(record.run.bindings).to.have.property('review.skipped');
        });

        it('reviews and passes a genuinely high-risk change', async () => {
            fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'src', 'auth', 'session.ts'), 'export const token = 1;\n');
            git(repo, 'add', '.');
            const ports = buildPorts('reviewed\n@@QAAP:VERDICT@@ pass looks correct');
            const dispatcher = new QaapWorkflowDispatcher(store, ports);
            const started = await store.start(buildImplementThenReviewWorkflow(), {
                cwd: repo, ownerLogin: 'ada', inputs: { task: 'add session handling' },
            });
            await dispatcher.dispatch(started.record, started.dispatch);
            await drive(dispatcher, ports, started.record.run.id);

            const record = store.get('ada', started.record.run.id)!;
            expect(record.run.status).to.equal('succeeded');
            expect(record.run.bindings).to.have.property('review.passed');
        });

        it('fails a high-risk change the reviewer rejects', async () => {
            fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'src', 'auth', 'session.ts'), 'export const token = 1;\n');
            git(repo, 'add', '.');
            const ports = buildPorts('reviewed\n@@QAAP:VERDICT@@ fail leaks the token');
            const dispatcher = new QaapWorkflowDispatcher(store, ports);
            const started = await store.start(buildImplementThenReviewWorkflow(), {
                cwd: repo, ownerLogin: 'ada', inputs: { task: 'add session handling' },
            });
            await dispatcher.dispatch(started.record, started.dispatch);
            await drive(dispatcher, ports, started.record.run.id);

            const record = store.get('ada', started.record.run.id)!;
            expect(record.run.bindings).to.have.property('review.failed');
        });

        it('never passes a high-risk change when the reviewer stays silent', async () => {
            fs.mkdirSync(path.join(repo, 'src', 'auth'), { recursive: true });
            fs.writeFileSync(path.join(repo, 'src', 'auth', 'session.ts'), 'export const token = 1;\n');
            git(repo, 'add', '.');
            const ports = buildPorts('I looked at it and it seems fine to me.');
            const dispatcher = new QaapWorkflowDispatcher(store, ports);
            const started = await store.start(buildImplementThenReviewWorkflow(), {
                cwd: repo, ownerLogin: 'ada', inputs: { task: 'add session handling' },
            });
            await dispatcher.dispatch(started.record, started.dispatch);
            await drive(dispatcher, ports, started.record.run.id);

            const record = store.get('ada', started.record.run.id)!;
            expect(record.run.bindings).to.not.have.property('review.passed');
            expect(record.run.bindings).to.have.property('review.inconclusive');
        });
    });
});

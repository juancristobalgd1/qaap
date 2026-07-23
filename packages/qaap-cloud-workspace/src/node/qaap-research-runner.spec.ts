// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { QaapResearchRunner } from './qaap-research-runner';
import {
    normalizeResearchGoal,
    type ResearchGoal,
    type ResearchMetricSpec,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import {
    QAAP_EXPERIMENT_MARKER,
    type ResearchExperimentRecord,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-ledger';
import type { QaapAgentTask, QaapAgentTaskEvent } from '../common/qaap-agent-task';

// ---- test doubles -----------------------------------------------------------

interface FakeCommandResult {
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut: boolean;
}

/** Records every `runGenericCommand` call so tests can assert on `run`/`measure`/`revert` shell-outs. */
class FakeTaskRunner {
    protected nextTaskId = 1;
    readonly createdTasks: Array<{ id: string; request: unknown; ownerLogin?: string }> = [];
    readonly cancelledIds: string[] = [];
    readonly genericCommandCalls: Array<{ command: string; cwd: string; taskId: string; timeoutMs: number }> = [];
    protected readonly listeners = new Set<(event: QaapAgentTaskEvent) => void>();
    protected readonly logs = new Map<string, string>();
    /** Script for `runGenericCommand`, keyed by call index (0-based); falls back to `defaultResult`. */
    genericCommandResults: FakeCommandResult[] = [];
    defaultResult: FakeCommandResult = { exitCode: 0, stdout: '', stderr: '', timedOut: false };

    create(
        request: { readonly cwd: string; readonly prompt?: string; readonly title?: string },
        ownerLogin?: string,
    ): QaapAgentTask {
        const id = `task-${this.nextTaskId++}`;
        this.createdTasks.push({ id, request, ownerLogin });
        return { id, title: request.title ?? '', command: request.prompt ?? '', cwd: request.cwd, state: 'running', createdAt: Date.now() };
    }

    onDidChangeTask(listener: (event: QaapAgentTaskEvent) => void): { dispose(): void } {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    async detail(id: string): Promise<{ log: string } | undefined> {
        return { log: this.logs.get(id) ?? '' };
    }

    setLog(taskId: string, log: string): void {
        this.logs.set(taskId, log);
    }

    /** Fires an `onDidChangeTask` completion for `taskId`, as the real runner does when a task settles.
     *  `extra` merges additional task fields (e.g. `verification`/`review`) into the settled task. */
    finishTask(taskId: string, state: QaapAgentTask['state'] = 'completed', extra: Partial<QaapAgentTask> = {}): void {
        const task: QaapAgentTask = { id: taskId, title: '', command: '', cwd: '/repo', state, createdAt: 0, ...extra };
        for (const listener of [...this.listeners]) {
            listener({ type: state === 'cancelled' ? 'cancelled' : 'completed', task });
        }
    }

    cancel(id: string): undefined {
        this.cancelledIds.push(id);
        return undefined;
    }

    applyHelperEnv(): boolean {
        return true;
    }

    defaultAgent(): string {
        return 'qaiq';
    }

    async runGenericCommand(command: string, cwd: string, _env: unknown, taskId: string, timeoutMs: number): Promise<FakeCommandResult> {
        const index = this.genericCommandCalls.length;
        this.genericCommandCalls.push({ command, cwd, taskId, timeoutMs });
        return this.genericCommandResults[index] ?? this.defaultResult;
    }
}

/** In-memory stand-in for {@link QaapResearchStore} — goal metadata + per-cwd ledger. */
class FakeResearchStore {
    protected readonly goals = new Map<string, ResearchGoal>();
    protected readonly ledgers = new Map<string, ResearchExperimentRecord[]>();
    ownerLogin: string | undefined;

    seedGoal(goal: ResearchGoal): void {
        this.goals.set(goal.id, goal);
    }

    get(id: string): ResearchGoal | undefined {
        return this.goals.get(id);
    }

    list(): ResearchGoal[] {
        return [...this.goals.values()];
    }

    listRunning(): ResearchGoal[] {
        return this.list().filter(goal => goal.status === 'running');
    }

    updateGoal(id: string, patch: Partial<ResearchGoal>): ResearchGoal | undefined {
        const existing = this.goals.get(id);
        if (!existing) {
            return undefined;
        }
        const next = { ...existing, ...patch };
        this.goals.set(id, next);
        return next;
    }

    cancel(id: string): ResearchGoal | undefined {
        return this.updateGoal(id, { status: 'cancelled', terminationReason: 'cancelled' });
    }

    readLedgerForGoal(goal: ResearchGoal): ResearchExperimentRecord[] {
        return (this.ledgers.get(goal.cwd) ?? []).filter(record => record.goalId === goal.id);
    }

    /** Sync stand-in: returning void (not a Promise) keeps `persistRecord` from yielding a
     *  microtask so tests can finish the propose task in the same turn as `callStartNewRound`. */
    upsertRecord(cwd: string, record: ResearchExperimentRecord): void {
        const list = this.ledgers.get(cwd) ?? [];
        const index = list.findIndex(existing => existing.id === record.id);
        if (index >= 0) {
            list[index] = record;
        } else {
            list.push(record);
        }
        this.ledgers.set(cwd, list);
    }

    bestSoFar(goal: ResearchGoal, metric: ResearchMetricSpec): number | undefined {
        const values = this.readLedgerForGoal(goal)
            .map(record => record.metrics.find(value => value.name === metric.name)?.value)
            .filter((value): value is number => value !== undefined);
        if (values.length === 0) {
            return undefined;
        }
        return metric.direction === 'max' ? Math.max(...values) : Math.min(...values);
    }

    ownerOf(): string | undefined {
        return this.ownerLogin;
    }
}

/** Exposes the runner's protected phase methods for direct, focused testing — same pattern as
 *  `TestableQaapAgentTaskRunner` in the sibling verification spec. */
class TestableQaapResearchRunner extends QaapResearchRunner {
    public callStartNewRound(goal: ResearchGoal, round: number): Promise<void> {
        return this.startNewRound(goal, round);
    }
    public callResumeRound(goal: ResearchGoal, record: ResearchExperimentRecord): Promise<void> {
        return this.resumeRound(goal, record);
    }
    public callRunLoop(goalId: string): Promise<void> {
        return this.runLoop(goalId);
    }
    public callCancel(goalId: string): ResearchGoal | undefined {
        return this.cancel(goalId);
    }
}

function makeRunner(store: FakeResearchStore, taskRunner: FakeTaskRunner): TestableQaapResearchRunner {
    const runner = Object.create(TestableQaapResearchRunner.prototype) as TestableQaapResearchRunner;
    Object.assign(runner, {
        store,
        taskRunner,
        // `Object.create(Prototype)` bypasses the constructor, so the class-field initializers for
        // these two maps never ran — seed them here (same reason the verification spec stubs out
        // every method that would otherwise touch an uninitialized field).
        activeExecutionId: new Map<string, string>(),
        loopRunning: new Set<string>(),
        // git plumbing is stubbed per-test; default gives every commit a fresh, distinct sha.
        runGit: (() => {
            let n = 0;
            return (_cwd: string, args: readonly string[]) => {
                if (args[0] === 'rev-parse') {
                    n++;
                    return { stdout: `sha-${n}`, ok: true };
                }
                return { stdout: '', ok: true };
            };
        })(),
    });
    return runner;
}

function makeGoal(overrides: Partial<ResearchGoal> & { metrics: readonly ResearchMetricSpec[] }): ResearchGoal {
    return normalizeResearchGoal({
        id: 'goal-1',
        cwd: '/repo',
        description: 'Improve accuracy',
        status: 'running',
        stagnationRounds: 3,
        infraFailureLimit: 3,
        ...overrides,
    });
}

function proposalBlock(config: Record<string, unknown>, extra: Partial<{ hypothesis: string; lever: string; symptom: string }> = {}): string {
    return [
        'Some agent commentary.',
        QAAP_EXPERIMENT_MARKER,
        '```json',
        JSON.stringify({ hypothesis: extra.hypothesis ?? 'higher LR converges faster', lever: extra.lever ?? 'learning_rate', symptom: extra.symptom, config }),
        '```',
    ].join('\n');
}

const METRIC: ResearchMetricSpec = { name: 'accuracy', direction: 'max', metricCommand: 'python measure.py', primary: true, target: 0.9 };

/** Real QAIQ/Claude Code stream-json log captured from a smoke test where the propose turn's CLI
 *  process exited 0 having authenticated nothing: `{"type":"result","is_error":true,"result":
 *  "Failed to authenticate: OAuth session expired and could not be refreshed"}`. Before the BUG 1
 *  fix the runner could not tell this apart from a no-op turn and burned the whole round budget
 *  re-prompting an agent that could never respond. */
function loadAuthFailureFixture(): string {
    return fs.readFileSync(path.resolve(__dirname, '../../test-resources/qaap-research-agent-turn-auth-failure.jsonl'), 'utf8');
}

/**
 * Completes the runner's preflight probe — always the very first task any `runLoop`/`start` call
 * creates for a goal without an existing `preflight: true` ledger record — with a healthy
 * response, then flushes microtasks so the loop advances into round 1. Every `callRunLoop` test
 * below that cares about round *content* uses this to get past the probe without re-testing it;
 * the probe itself is covered by the dedicated `describe('preflight probe ...')` block.
 */
async function passPreflight(taskRunner: FakeTaskRunner): Promise<void> {
    expect(taskRunner.createdTasks).to.have.lengthOf.at.least(1);
    const preflightTask = taskRunner.createdTasks[0];
    taskRunner.setLog(preflightTask.id, 'READY');
    taskRunner.finishTask(preflightTask.id);
    await new Promise(resolve => setImmediate(resolve));
}

// ---- tests --------------------------------------------------------------------

describe('QaapResearchRunner state machine', () => {

    it('propagates the research-goal owner to autonomous agent turns', async () => {
        const store = new FakeResearchStore();
        store.ownerLogin = 'alice';
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        expect(taskRunner.createdTasks[0].ownerLogin).to.equal('alice');
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id, 'failed');
        await promise;
    });

    it('propose → commit → measure: a parseable proposal runs the full round with no runCommand', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.75', stderr: '', timedOut: false }];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        expect(taskRunner.createdTasks).to.have.lengthOf(1);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        const records = store.readLedgerForGoal(goal);
        expect(records).to.have.lengthOf(1);
        expect(records[0]).to.deep.include({ phase: 'done', verdict: 'improved', lever: 'learning_rate' });
        expect(records[0].metrics).to.deep.equal([{ name: 'accuracy', value: 0.75, direction: 'max' }]);
        expect(records[0].sha).to.equal('sha-2'); // baseline (sha-1) captured, then the round's commit (sha-2)
    });

    it('adopts an agent-created commit instead of stacking a duplicate round commit on top', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.75', stderr: '', timedOut: false }];

        const gitCalls: Array<readonly string[]> = [];
        let revParseCalls = 0;
        const runner = makeRunner(store, taskRunner);
        Object.assign(runner, {
            runGit: (_cwd: string, args: readonly string[]) => {
                gitCalls.push([...args]);
                if (args[0] === 'rev-parse') {
                    revParseCalls++;
                    return { stdout: revParseCalls === 1 ? 'sha-baseline' : 'sha-agent', ok: true };
                }
                if (args[0] === 'rev-list') {
                    return { stdout: '1', ok: true };
                }
                return { stdout: '', ok: true };
            },
        });

        const promise = runner.callStartNewRound(goal, 1);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ batch_size: 4 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        const [record] = store.readLedgerForGoal(goal);
        expect(record).to.deep.include({ baselineSha: 'sha-baseline', sha: 'sha-agent', phase: 'done' });
        expect(record.notes).to.contain('adopted the resulting HEAD');
        expect(gitCalls.some(args => args[0] === 'commit')).to.equal(false);
    });

    it('discards a completed_with_warnings round: commit + revert, cheap failed verdict, no measure', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id, 'completed_with_warnings', {
            verification: { status: 'failed', command: 'npm run build', attempts: 2, summary: 'npm run build exited with code 1.' },
        });
        await promise;

        const [record] = store.readLedgerForGoal(goal);
        expect(record).to.deep.include({ phase: 'done', verdict: 'failed', gateVerification: 'failed', reverted: true });
        expect(record.notes).to.include('npm run build exited with code 1.');
        expect(record.sha).to.equal('sha-2');
        const commands = taskRunner.genericCommandCalls.map(call => call.command).join('\n');
        expect(commands).to.include('git revert');
        expect(commands).not.to.include('python measure.py');
    });

    it('treats a blocked-sentinel propose turn as an infra failure and never commits or measures', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        taskRunner.setLog(taskRunner.createdTasks[0].id,
            'I compared the datasets.\n@@QAAP:BLOCKED@@ Which dataset should the baseline use?');
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        const [record] = store.readLedgerForGoal(goal);
        expect(record).to.deep.include({ phase: 'done', verdict: 'failed' });
        expect(record.notes).to.include('blocked on input only a human can provide');
        expect(record.notes).to.include('Which dataset should the baseline use?');
        expect(record.sha).to.equal(undefined);
        expect(taskRunner.genericCommandCalls).to.have.lengthOf(0);
    });

    it('mirrors a passing change-quality gate onto the ledger row', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.75', stderr: '', timedOut: false }];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id, 'completed', {
            verification: { status: 'passed', command: 'npm run build', attempts: 0 },
            review: { status: 'passed', reason: 'matches the hypothesis', agentId: 'qaiq' },
        });
        await promise;

        const [record] = store.readLedgerForGoal(goal);
        expect(record).to.deep.include({ verdict: 'improved', gateVerification: 'passed', gateReview: 'passed' });
    });

    it('passes the goal\'s explicit agentModel to the propose task, so it wins over Settings-alias routing', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({
            metrics: [METRIC],
            agentModel: { provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-4-5' },
        });
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.75', stderr: '', timedOut: false }];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        expect(taskRunner.createdTasks).to.have.lengthOf(1);
        expect((taskRunner.createdTasks[0].request as { agentModel?: unknown }).agentModel).to.deep.equal({
            provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-4-5',
        });
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;
    });

    it('omits agentModel from the propose task when the goal does not declare one (today\'s alias-routing behaviour)', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.75', stderr: '', timedOut: false }];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        expect(taskRunner.createdTasks).to.have.lengthOf(1);
        expect((taskRunner.createdTasks[0].request as { agentModel?: unknown }).agentModel).to.equal(undefined);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;
    });

    it('runs the runCommand phase before measuring when the goal declares one', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [
            { exitCode: 0, stdout: 'training...', stderr: '', timedOut: false }, // run phase
            { exitCode: 0, stdout: '0.6', stderr: '', timedOut: false }, // measure phase
        ];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ batch_size: 32 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        expect(taskRunner.genericCommandCalls[0].command).to.equal('python train.py');
        expect(taskRunner.genericCommandCalls[1].command).to.equal('python measure.py');
        const [record] = store.readLedgerForGoal(goal);
        expect(record).to.deep.include({ phase: 'done', verdict: 'improved' });
    });

    it('a non-zero runCommand exit is an infra failure, not a bad-hypothesis verdict, and skips measuring', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{ exitCode: 1, stdout: '', stderr: 'CUDA OOM', timedOut: false }];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ batch_size: 512 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        expect(taskRunner.genericCommandCalls).to.have.lengthOf(1); // measure never ran
        const [record] = store.readLedgerForGoal(goal);
        expect(record).to.deep.include({ phase: 'done', verdict: 'failed' });
        expect(record.notes).to.contain('exited 1');
        expect(record.notes).to.contain('Captured output tail:');
        expect(record.notes).to.contain('CUDA OOM');
    });

    it('caps a failed runCommand output excerpt and keeps the diagnostic tail', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{
            exitCode: 134,
            stdout: `old progress ${'x'.repeat(3_000)}`,
            stderr: '\u001b[31mMPS out of memory\u001b[0m',
            timedOut: false,
        }];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 1);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ model: 'large' }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        const [record] = store.readLedgerForGoal(goal);
        expect(record.notes).to.contain('runCommand exited 134');
        expect(record.notes).to.contain('...[truncated]...');
        expect(record.notes).to.contain('MPS out of memory');
        expect(record.notes).not.to.contain('\u001b[31m');
        expect(record.notes!.length).to.be.lessThan(2_100);
    });

    it('reverts the round with `git revert` (never a hard reset) when the verdict is a regression', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);
        // Seed a prior, better round so the new measurement counts as a regression.
        await store.upsertRecord(goal.cwd, {
            id: 'prior', goalId: goal.id, round: 1, startedAt: 0, hypothesis: 'h', declaredConfig: {}, declaredConfigFingerprint: 'fp-prior',
            realChangeFingerprint: 'rfp-prior',
            phase: 'done', metrics: [{ name: 'accuracy', value: 0.9, direction: 'max' }], verdict: 'improved',
        });
        taskRunner.genericCommandResults = [
            { exitCode: 0, stdout: '0.5', stderr: '', timedOut: false }, // measure: worse than 0.9
            { exitCode: 0, stdout: '', stderr: '', timedOut: false }, // git revert
        ];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 2);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 10 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        const [record] = store.readLedgerForGoal(goal).filter(r => r.round === 2);
        expect(record.verdict).to.equal('regressed');
        expect(record.reverted).to.equal(true);
        const revertCall = taskRunner.genericCommandCalls.find(call => call.command.includes('git revert'));
        expect(revertCall).to.not.equal(undefined);
        expect(revertCall!.command).to.not.contain('reset --hard');
    });

    it('anti-stall fallback: a missing [QAAP experiment] block never stops the loop', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.4', stderr: '', timedOut: false }];

        const runner = makeRunner(store, taskRunner);
        Object.assign(runner, { runGit: (_cwd: string, args: readonly string[]) => {
            if (args[0] === 'diff') {
                return { stdout: ' src/train.py | 4 +-', ok: true };
            }
            if (args[0] === 'status') {
                return { stdout: '', ok: true };
            }
            return { stdout: 'sha-x', ok: true };
        } });
        const promise = runner.callStartNewRound(goal, 1);
        taskRunner.setLog(taskRunner.createdTasks[0].id, 'The agent forgot the marker entirely.');
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        const [record] = store.readLedgerForGoal(goal);
        expect(record.phase).to.equal('done'); // the round completed despite the format miss
        expect(record.hypothesis).to.equal('(not declared)');
        expect(record.declaredConfig).to.deep.equal({ fallbackDiffStat: ' src/train.py | 4 +-' });
        expect(record.notes).to.contain('did not include a parseable');
    });

    describe('repeat-config guard: fingerprints the REAL file change, not the agent\'s declared config', () => {

        /** `status` always reports the same file changed, simulating the runner observing the
         *  identical real edit round after round — independent of anything a test declares as the
         *  agent's `config`. `/repo` is not a real directory, so `fs.readFileSync` inside
         *  `collectRealFileChanges` always fails the same way for the same path, which is exactly
         *  what makes the resulting fingerprint stable and comparable across rounds here. */
        function stubGitSameRealChange(): { runGit: (cwd: string, args: readonly string[]) => { stdout: string; ok: boolean } } {
            let shaCounter = 0;
            return {
                runGit: (_cwd: string, args: readonly string[]) => {
                    if (args[0] === 'rev-parse') {
                        shaCounter++;
                        return { stdout: `sha-${shaCounter}`, ok: true };
                    }
                    if (args[0] === 'status') {
                        return { stdout: ' M train.py\n', ok: true };
                    }
                    if (args[0] === 'diff') {
                        // Keeps this round out of the no-op guard's territory (empty diffStat) —
                        // consistent with `status` reporting the same file as really changed.
                        return { stdout: ' train.py | 2 +-', ok: true };
                    }
                    return { stdout: '', ok: true };
                },
            };
        }

        it('detects a collision when the real file change repeats, even though the agent declares a different config each time', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC] });
            store.seedGoal(goal);
            taskRunner.genericCommandResults = [
                { exitCode: 0, stdout: '0.5', stderr: '', timedOut: false }, // round 1 measure
                { exitCode: 0, stdout: '0.55', stderr: '', timedOut: false }, // round 2 measure (once accepted)
            ];

            const runner = makeRunner(store, taskRunner);
            Object.assign(runner, stubGitSameRealChange());

            // Round 1 establishes the "already tried" real change.
            const round1 = runner.callStartNewRound(goal, 1);
            taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
            taskRunner.finishTask(taskRunner.createdTasks[0].id);
            await round1;
            expect(taskRunner.createdTasks).to.have.lengthOf(1);

            // Round 2: the agent declares GARBAGE, unrelated to round 1's declared config — but the
            // real file change (per the `status` stub) is identical. The guard must still catch it.
            const round2 = runner.callStartNewRound(goal, 2);
            taskRunner.setLog(taskRunner.createdTasks[1].id, proposalBlock({ x: 'increased value' }));
            taskRunner.finishTask(taskRunner.createdTasks[1].id);
            // Flush the whole microtask queue (setImmediate runs after it drains) rather than
            // guessing a tick count.
            await new Promise(resolve => setImmediate(resolve));
            expect(taskRunner.createdTasks).to.have.lengthOf(3);
            expect((taskRunner.createdTasks[2].request as { prompt: string }).prompt).to.contain('fingerprint collision');
            // Second attempt still collides — the guard must accept it rather than loop forever.
            taskRunner.setLog(taskRunner.createdTasks[2].id, proposalBlock({ x: 'increased again' }));
            taskRunner.finishTask(taskRunner.createdTasks[2].id);
            await round2;

            expect(taskRunner.createdTasks).to.have.lengthOf(3); // never re-prompted a third time
            const [record] = store.readLedgerForGoal(goal).filter(r => r.round === 2);
            expect(record.phase).to.equal('done');
            expect(record.declaredConfig).to.deep.equal({ x: 'increased again' });
            expect(record.realChangeFingerprint).to.equal(
                store.readLedgerForGoal(goal).find(r => r.round === 1)!.realChangeFingerprint,
            );
        });

        it('does NOT flag a false collision when the real file change differs, even though the agent declares the identical config text', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC] });
            store.seedGoal(goal);
            taskRunner.genericCommandResults = [
                { exitCode: 0, stdout: '0.5', stderr: '', timedOut: false }, // round 1 measure
                { exitCode: 0, stdout: '0.6', stderr: '', timedOut: false }, // round 2 measure
            ];

            let statusCallCount = 0;
            let shaCounter = 0;
            const runner = makeRunner(store, taskRunner);
            Object.assign(runner, {
                runGit: (_cwd: string, args: readonly string[]) => {
                    if (args[0] === 'rev-parse') {
                        shaCounter++;
                        return { stdout: `sha-${shaCounter}`, ok: true };
                    }
                    if (args[0] === 'status') {
                        statusCallCount++;
                        // A DIFFERENT path changes each round — the real edit is genuinely different.
                        return { stdout: statusCallCount === 1 ? ' M train.py\n' : ' M eval.py\n', ok: true };
                    }
                    return { stdout: '', ok: true };
                },
            });

            const round1 = runner.callStartNewRound(goal, 1);
            // Both rounds declare the EXACT same config text.
            taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
            taskRunner.finishTask(taskRunner.createdTasks[0].id);
            await round1;

            const round2 = runner.callStartNewRound(goal, 2);
            taskRunner.setLog(taskRunner.createdTasks[1].id, proposalBlock({ learning_rate: 0.01 }));
            taskRunner.finishTask(taskRunner.createdTasks[1].id);
            await round2;

            expect(taskRunner.createdTasks).to.have.lengthOf(2); // no re-prompt: never a real collision
            const [record] = store.readLedgerForGoal(goal).filter(r => r.round === 2);
            expect(record.phase).to.equal('done');
            expect(record.declaredConfig).to.deep.equal({ learning_rate: 0.01 });
        });

        it('still detects a collision via real file state when the agent declares no parseable config at all', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC] });
            store.seedGoal(goal);
            taskRunner.genericCommandResults = [
                { exitCode: 0, stdout: '0.5', stderr: '', timedOut: false }, // round 1 measure
                { exitCode: 0, stdout: '0.55', stderr: '', timedOut: false }, // round 2 measure (once accepted)
            ];

            const runner = makeRunner(store, taskRunner);
            Object.assign(runner, stubGitSameRealChange());

            const round1 = runner.callStartNewRound(goal, 1);
            taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
            taskRunner.finishTask(taskRunner.createdTasks[0].id);
            await round1;

            // Round 2: the agent proposes nothing parseable at all — the anti-stall fallback
            // synthesizes a declaredConfig from the diffStat text, but the repeat-guard must still
            // catch the collision from the REAL (status-based) file change, independent of that.
            const round2 = runner.callStartNewRound(goal, 2);
            taskRunner.setLog(taskRunner.createdTasks[1].id, 'The agent rambled with no marker and no JSON block at all.');
            taskRunner.finishTask(taskRunner.createdTasks[1].id);
            await new Promise(resolve => setImmediate(resolve));
            expect(taskRunner.createdTasks).to.have.lengthOf(3);
            expect((taskRunner.createdTasks[2].request as { prompt: string }).prompt).to.contain('fingerprint collision');
            taskRunner.setLog(taskRunner.createdTasks[2].id, 'Still nothing parseable the second time either.');
            taskRunner.finishTask(taskRunner.createdTasks[2].id);
            await round2;

            expect(taskRunner.createdTasks).to.have.lengthOf(3);
            const [record] = store.readLedgerForGoal(goal).filter(r => r.round === 2);
            expect(record.phase).to.equal('done');
            expect(record.hypothesis).to.equal('(not declared)');
        });
    });

    it('terminates the loop and records the reason once resolveTerminationReason fires (reached-target)', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] }); // target 0.9
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.95', stderr: '', timedOut: false }];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callRunLoop(goal.id);
        await passPreflight(taskRunner);
        taskRunner.setLog(taskRunner.createdTasks[1].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[1].id);
        await promise;

        expect(taskRunner.createdTasks).to.have.lengthOf(2); // preflight + exactly one round, loop stopped
        const finalGoal = store.get(goal.id)!;
        expect(finalGoal.status).to.equal('completed');
        expect(finalGoal.terminationReason).to.equal('reached-target');
    });

    it('cancel() kills the in-flight command and the loop leaves no bogus verdict behind', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
        store.seedGoal(goal);
        // The run phase "hangs" (never resolves within the test) until we manually resolve it below.
        let resolveRun!: (value: FakeCommandResult) => void;
        taskRunner.runGenericCommand = ((command: string, cwd: string, _env: unknown, taskId: string) => {
            taskRunner.genericCommandCalls.push({ command, cwd, taskId, timeoutMs: 0 });
            return new Promise<FakeCommandResult>(resolve => { resolveRun = resolve; });
        }) as typeof taskRunner.runGenericCommand;

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callRunLoop(goal.id);
        await passPreflight(taskRunner);
        taskRunner.setLog(taskRunner.createdTasks[1].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[1].id);
        await new Promise(resolve => setImmediate(resolve));

        runner.callCancel(goal.id);
        expect(taskRunner.cancelledIds).to.have.lengthOf(1);
        resolveRun({ exitCode: 1, stdout: '', stderr: 'killed', timedOut: false });
        await promise;

        const [record] = store.readLedgerForGoal(goal).filter(r => !r.preflight);
        expect(record.phase).to.equal('run'); // never advanced to a (wrong) 'failed' verdict
        expect(record.verdict).to.equal(undefined);
        expect(store.get(goal.id)!.status).to.equal('cancelled');
    });

    describe('resumability after a backend restart (per phase)', () => {

        it('phase "propose": re-launches the turn from scratch (idempotent — the agent re-reads the ledger)', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC] });
            store.seedGoal(goal);
            const dangling: ResearchExperimentRecord = {
                id: 'r1', goalId: goal.id, round: 1, startedAt: 0, hypothesis: '', declaredConfig: {}, declaredConfigFingerprint: '', realChangeFingerprint: '',
                phase: 'propose', metrics: [],
            };
            taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.5', stderr: '', timedOut: false }];

            const runner = makeRunner(store, taskRunner);
            const promise = runner.callResumeRound(goal, dangling);
            expect(taskRunner.createdTasks).to.have.lengthOf(1);
            taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.02 }));
            taskRunner.finishTask(taskRunner.createdTasks[0].id);
            await promise;

            const [record] = store.readLedgerForGoal(goal);
            expect(record.id).to.equal('r1'); // same round identity, not a new one
            expect(record.phase).to.equal('done');
        });

        it('phase "run": the lever is already committed — re-runs runCommand rather than restarting the round', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
            store.seedGoal(goal);
            const committed: ResearchExperimentRecord = {
                id: 'r1', goalId: goal.id, round: 1, startedAt: 0, hypothesis: 'h', lever: 'lr', declaredConfig: { lr: 1 },
                declaredConfigFingerprint: 'fp', realChangeFingerprint: 'rfp', sha: 'sha-1', baselineSha: 'sha-0', phase: 'run', metrics: [],
            };
            taskRunner.genericCommandResults = [
                { exitCode: 0, stdout: '', stderr: '', timedOut: false }, // run
                { exitCode: 0, stdout: '0.5', stderr: '', timedOut: false }, // measure
            ];

            const runner = makeRunner(store, taskRunner);
            await runner.callResumeRound(goal, committed);

            expect(taskRunner.createdTasks).to.have.lengthOf(0); // no new propose turn — the round is not restarted
            expect(taskRunner.genericCommandCalls[0].command).to.equal('python train.py');
            const [record] = store.readLedgerForGoal(goal);
            expect(record.runAttempts).to.equal(1);
            expect(record.phase).to.equal('done');
        });

        it('phase "run": gives up as an infra failure after exceeding the resume-attempt cap, without spawning again', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
            store.seedGoal(goal);
            const exhausted: ResearchExperimentRecord = {
                id: 'r1', goalId: goal.id, round: 1, startedAt: 0, hypothesis: 'h', declaredConfig: {}, declaredConfigFingerprint: 'fp', realChangeFingerprint: 'rfp',
                sha: 'sha-1', phase: 'run', metrics: [], runAttempts: 2, // already resumed twice (MAX_RUN_RESUME_ATTEMPTS)
            };

            const runner = makeRunner(store, taskRunner);
            await runner.callResumeRound(goal, exhausted);

            expect(taskRunner.genericCommandCalls).to.have.lengthOf(0); // no third attempt spawned
            const [record] = store.readLedgerForGoal(goal);
            expect(record).to.deep.include({ phase: 'done', verdict: 'failed' });
            expect(record.notes).to.contain('lost its process');
        });

        it('phase "measure": run already succeeded — only re-runs the (cheap) metric command', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
            store.seedGoal(goal);
            const ranAlready: ResearchExperimentRecord = {
                id: 'r1', goalId: goal.id, round: 1, startedAt: 0, hypothesis: 'h', declaredConfig: {}, declaredConfigFingerprint: 'fp', realChangeFingerprint: 'rfp',
                sha: 'sha-1', phase: 'measure', metrics: [], runAttempts: 0,
            };
            taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.7', stderr: '', timedOut: false }];

            const runner = makeRunner(store, taskRunner);
            await runner.callResumeRound(goal, ranAlready);

            expect(taskRunner.createdTasks).to.have.lengthOf(0);
            expect(taskRunner.genericCommandCalls).to.have.lengthOf(1);
            expect(taskRunner.genericCommandCalls[0].command).to.equal('python measure.py'); // never re-ran train.py
            expect(taskRunner.genericCommandCalls[0].timeoutMs).to.equal(goal.runTimeoutMs);
            const [record] = store.readLedgerForGoal(goal);
            expect(record).to.deep.include({ phase: 'done', verdict: 'improved' });
        });
    });

    describe('ledger self-contamination (bug fixes)', () => {

        it('BUG 2: excludes .qaap/experiments.jsonl from both the round diff and the commit\'s `git add`', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC] });
            store.seedGoal(goal);
            taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.75', stderr: '', timedOut: false }];

            const gitCalls: Array<readonly string[]> = [];
            const runner = makeRunner(store, taskRunner);
            Object.assign(runner, {
                runGit: (_cwd: string, args: readonly string[]) => {
                    gitCalls.push([...args]);
                    return args[0] === 'rev-parse' ? { stdout: `sha-${gitCalls.length}`, ok: true } : { stdout: '', ok: true };
                },
            });
            const promise = runner.callStartNewRound(goal, 1);
            taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
            taskRunner.finishTask(taskRunner.createdTasks[0].id);
            await promise;

            const diffCall = gitCalls.find(call => call[0] === 'diff');
            expect(diffCall, 'expected a `git diff --stat` call').to.not.equal(undefined);
            expect(diffCall).to.contain(':(exclude).qaap/experiments.jsonl');
            const addCall = gitCalls.find(call => call[0] === 'add');
            expect(addCall, 'expected a `git add -A` call').to.not.equal(undefined);
            expect(addCall).to.contain(':(exclude).qaap/experiments.jsonl');
        });

        it('BUG 3: a no-op round (empty diff, no parseable proposal) re-prompts once, then finishes without ever running runCommand', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
            store.seedGoal(goal);

            const runner = makeRunner(store, taskRunner);
            Object.assign(runner, {
                // Every diff reports no changes outside the (excluded) ledger — the agent's turn
                // only touched .qaap/experiments.jsonl indirectly via the runner's own writes.
                runGit: (_cwd: string, args: readonly string[]) =>
                    args[0] === 'rev-parse' ? { stdout: 'sha-x', ok: true } : { stdout: '', ok: true },
            });

            const promise = runner.callStartNewRound(goal, 1);
            expect(taskRunner.createdTasks).to.have.lengthOf(1);
            taskRunner.setLog(taskRunner.createdTasks[0].id, 'The agent just thought out loud and changed nothing.');
            taskRunner.finishTask(taskRunner.createdTasks[0].id);

            // The no-op guard re-prompts exactly once, mirroring the fingerprint guard, before giving up.
            await new Promise(resolve => setImmediate(resolve));
            expect(taskRunner.createdTasks).to.have.lengthOf(2);
            expect((taskRunner.createdTasks[1].request as { prompt: string }).prompt).to.contain('no repo file changes');
            taskRunner.setLog(taskRunner.createdTasks[1].id, 'Still nothing — the agent never touched a file.');
            taskRunner.finishTask(taskRunner.createdTasks[1].id);
            await promise;

            expect(taskRunner.createdTasks).to.have.lengthOf(2); // never re-prompted a third time
            expect(taskRunner.genericCommandCalls).to.have.lengthOf(0); // runCommand/measure never ran
            const [record] = store.readLedgerForGoal(goal);
            expect(record.phase).to.equal('done');
            // Explicit 'noop' verdict (not undefined) — BUG 2: a no-op must count toward
            // stagnation, or an inert agent silently exhausts the whole round budget instead.
            expect(record.verdict).to.equal('noop');
            expect(record.sha).to.equal(undefined); // no-op round was never committed
            expect(record.notes).to.contain('No-op round');
        });

        it('a round with a parseable proposal is never treated as a no-op, even with an empty diff (e.g. reasoning-only rounds)', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC] });
            store.seedGoal(goal);
            taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.5', stderr: '', timedOut: false }];

            const runner = makeRunner(store, taskRunner);
            Object.assign(runner, {
                runGit: (_cwd: string, args: readonly string[]) =>
                    args[0] === 'rev-parse' ? { stdout: 'sha-x', ok: true } : { stdout: '', ok: true },
            });
            const promise = runner.callStartNewRound(goal, 1);
            taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.02 }));
            taskRunner.finishTask(taskRunner.createdTasks[0].id);
            await promise;

            expect(taskRunner.createdTasks).to.have.lengthOf(1); // no no-op re-prompt
            const [record] = store.readLedgerForGoal(goal);
            expect(record.phase).to.equal('done');
            expect(record.declaredConfig).to.deep.equal({ learning_rate: 0.02 });
        });
    });

    describe('agent turn failure (BUG 1: never mistaken for a no-op)', () => {

        it('REGRESSION: a real auth-failure log (CLI exits 0 with is_error:true) is recorded as failed, not a no-op, and skips run/measure', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
            store.seedGoal(goal);

            const runner = makeRunner(store, taskRunner);
            const promise = runner.callStartNewRound(goal, 1);
            expect(taskRunner.createdTasks).to.have.lengthOf(1);
            // The real CLI process exits 0 here — the failure is only visible inside the log's
            // final `result` event, never in the task's exit code.
            taskRunner.setLog(taskRunner.createdTasks[0].id, loadAuthFailureFixture());
            taskRunner.finishTask(taskRunner.createdTasks[0].id, 'completed');
            await promise;

            // Never re-prompted as a no-op, never ran runCommand/measure.
            expect(taskRunner.createdTasks).to.have.lengthOf(1);
            expect(taskRunner.genericCommandCalls).to.have.lengthOf(0);
            const [record] = store.readLedgerForGoal(goal);
            expect(record.phase).to.equal('done');
            expect(record.verdict).to.equal('failed');
            expect(record.notes).to.contain('agent turn failed');
            expect(record.notes).to.contain('Failed to authenticate: OAuth session expired and could not be refreshed');
            expect(record.sha).to.equal(undefined); // never committed
        });

        it('also treats a task that finished in the "failed" state as a turn failure, even with no parseable error in the log', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC] });
            store.seedGoal(goal);

            const runner = makeRunner(store, taskRunner);
            const promise = runner.callStartNewRound(goal, 1);
            taskRunner.setLog(taskRunner.createdTasks[0].id, 'process crashed before printing anything structured');
            taskRunner.finishTask(taskRunner.createdTasks[0].id, 'failed');
            await promise;

            expect(taskRunner.createdTasks).to.have.lengthOf(1); // no no-op re-prompt either
            expect(taskRunner.genericCommandCalls).to.have.lengthOf(0);
            const [record] = store.readLedgerForGoal(goal);
            expect(record.phase).to.equal('done');
            expect(record.verdict).to.equal('failed');
            expect(record.notes).to.contain('agent turn failed');
        });

        it('consecutive agent-turn failures count toward infraFailureLimit and terminate as infra-broken, not budget-exhausted', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC], stagnationRounds: 100, infraFailureLimit: 2 });
            store.seedGoal(goal);

            const runner = makeRunner(store, taskRunner);
            const promise = runner.callRunLoop(goal.id);
            await passPreflight(taskRunner);

            // Round 1: auth failure.
            await new Promise(resolve => setImmediate(resolve));
            taskRunner.setLog(taskRunner.createdTasks[1].id, loadAuthFailureFixture());
            taskRunner.finishTask(taskRunner.createdTasks[1].id, 'completed');

            // Round 2: same failure again — trips infraFailureLimit (2).
            await new Promise(resolve => setImmediate(resolve));
            expect(taskRunner.createdTasks).to.have.lengthOf(3);
            taskRunner.setLog(taskRunner.createdTasks[2].id, loadAuthFailureFixture());
            taskRunner.finishTask(taskRunner.createdTasks[2].id, 'completed');
            await promise;

            expect(taskRunner.createdTasks).to.have.lengthOf(3); // preflight + 2 rounds, loop stopped there
            const finalGoal = store.get(goal.id)!;
            expect(finalGoal.status).to.equal('failed');
            expect(finalGoal.terminationReason).to.equal('infra-broken');
        });
    });

    describe('preflight probe: fails fast before round 1 ever burns a round on a broken agent', () => {

        it('a real auth-failure log fails the goal immediately, before round 1 starts and with no runCommand', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC], runCommand: 'python train.py' });
            store.seedGoal(goal);

            const runner = makeRunner(store, taskRunner);
            const promise = runner.callRunLoop(goal.id);
            expect(taskRunner.createdTasks).to.have.lengthOf(1);
            taskRunner.setLog(taskRunner.createdTasks[0].id, loadAuthFailureFixture());
            taskRunner.finishTask(taskRunner.createdTasks[0].id, 'completed');
            await promise;

            expect(taskRunner.createdTasks).to.have.lengthOf(1); // round 1 never started
            expect(taskRunner.genericCommandCalls).to.have.lengthOf(0); // runCommand never invoked
            const finalGoal = store.get(goal.id)!;
            expect(finalGoal.status).to.equal('failed');
            expect(finalGoal.terminationReason).to.equal('infra-broken');
            const [record] = store.readLedgerForGoal(goal);
            expect(record.round).to.equal(0);
            expect(record.preflight).to.equal(true);
            expect(record.verdict).to.equal('failed');
            expect(record.hypothesis).to.equal('(preflight)');
            expect(record.notes).to.contain('preflight failed');
            expect(record.notes).to.contain('Failed to authenticate: OAuth session expired and could not be refreshed');
        });

        it('a task that finishes in the "failed" state also fails the preflight, even with no parseable error in the log', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC] });
            store.seedGoal(goal);

            const runner = makeRunner(store, taskRunner);
            const promise = runner.callRunLoop(goal.id);
            taskRunner.setLog(taskRunner.createdTasks[0].id, 'connection refused before printing anything structured');
            taskRunner.finishTask(taskRunner.createdTasks[0].id, 'failed');
            await promise;

            expect(taskRunner.createdTasks).to.have.lengthOf(1); // round 1 never started
            const finalGoal = store.get(goal.id)!;
            expect(finalGoal.status).to.equal('failed');
            expect(finalGoal.terminationReason).to.equal('infra-broken');
            const [record] = store.readLedgerForGoal(goal);
            expect(record.verdict).to.equal('failed');
            expect(record.notes).to.contain('preflight failed');
        });

        it('a healthy response lets round 1 start normally, and the round-0 preflight record never counts toward maxRounds', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            const goal = makeGoal({ metrics: [METRIC], maxRounds: 1 });
            store.seedGoal(goal);
            taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.5', stderr: '', timedOut: false }];

            const runner = makeRunner(store, taskRunner);
            const promise = runner.callRunLoop(goal.id);
            expect(taskRunner.createdTasks).to.have.lengthOf(1);
            await passPreflight(taskRunner);

            expect(taskRunner.createdTasks).to.have.lengthOf(2); // preflight, then round 1's propose task
            taskRunner.setLog(taskRunner.createdTasks[1].id, proposalBlock({ learning_rate: 0.01 }));
            taskRunner.finishTask(taskRunner.createdTasks[1].id);
            await promise;

            const records = store.readLedgerForGoal(goal);
            expect(records).to.have.lengthOf(2); // preflight (round 0) + round 1
            const round1 = records.find(r => r.round === 1)!;
            expect(round1.phase).to.equal('done');
            const finalGoal = store.get(goal.id)!;
            // maxRounds=1 is satisfied by round 1 alone — proof the preflight record was excluded
            // from the count (otherwise this would need 2 real rounds to hit the budget).
            expect(finalGoal.status).to.equal('completed');
            expect(finalGoal.terminationReason).to.equal('budget-exhausted');
        });

        it('does not re-run the preflight on resume when a preflight record already exists (e.g. after a backend restart)', async () => {
            const store = new FakeResearchStore();
            const taskRunner = new FakeTaskRunner();
            // maxRounds: 1 bounds callRunLoop to a single round so the test does not have to script
            // a second propose task — unrelated to what this test actually checks (no re-probe).
            const goal = makeGoal({ metrics: [METRIC], maxRounds: 1 });
            store.seedGoal(goal);
            await store.upsertRecord(goal.cwd, {
                id: 'preflight-1', goalId: goal.id, round: 0, startedAt: 0, finishedAt: 0,
                hypothesis: '(preflight)', declaredConfig: {}, declaredConfigFingerprint: '', realChangeFingerprint: '',
                phase: 'done', metrics: [], notes: 'preflight ok', preflight: true,
            });
            taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.5', stderr: '', timedOut: false }];

            const runner = makeRunner(store, taskRunner);
            const promise = runner.callRunLoop(goal.id);
            // Straight to round 1's propose task — no second preflight probe. `ensurePreflightPassed`
            // resolves without ever awaiting a task event here (the preflight record already
            // exists), which still defers `runLoop`'s continuation by one microtask — flush it.
            await new Promise(resolve => setImmediate(resolve));
            expect(taskRunner.createdTasks).to.have.lengthOf(1);
            taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
            taskRunner.finishTask(taskRunner.createdTasks[0].id);
            await promise;

            const records = store.readLedgerForGoal(goal);
            expect(records.filter(r => r.preflight)).to.have.lengthOf(1); // still just the original one
            const round1 = records.find(r => r.round === 1)!;
            expect(round1.phase).to.equal('done');
        });
    });
});

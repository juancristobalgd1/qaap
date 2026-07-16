// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapResearchRunner } from './qaap-research-runner';
import {
    normalizeResearchGoal,
    type ResearchGoal,
    type ResearchMetricSpec,
} from '@theia/qaap-mobile-shell/lib/common/qaap-research-goal';
import {
    configFingerprint,
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
    readonly createdTasks: Array<{ id: string; request: unknown }> = [];
    readonly cancelledIds: string[] = [];
    readonly genericCommandCalls: Array<{ command: string; cwd: string; taskId: string; timeoutMs: number }> = [];
    protected readonly listeners = new Set<(event: QaapAgentTaskEvent) => void>();
    protected readonly logs = new Map<string, string>();
    /** Script for `runGenericCommand`, keyed by call index (0-based); falls back to `defaultResult`. */
    genericCommandResults: FakeCommandResult[] = [];
    defaultResult: FakeCommandResult = { exitCode: 0, stdout: '', stderr: '', timedOut: false };

    create(request: { readonly cwd: string; readonly prompt?: string; readonly title?: string }): QaapAgentTask {
        const id = `task-${this.nextTaskId++}`;
        this.createdTasks.push({ id, request });
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

    /** Fires an `onDidChangeTask` completion for `taskId`, as the real runner does when a task settles. */
    finishTask(taskId: string, state: QaapAgentTask['state'] = 'completed'): void {
        const task: QaapAgentTask = { id: taskId, title: '', command: '', cwd: '/repo', state, createdAt: 0 };
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
        return undefined;
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

// ---- tests --------------------------------------------------------------------

describe('QaapResearchRunner state machine', () => {

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
    });

    it('reverts the round with `git revert` (never a hard reset) when the verdict is a regression', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);
        // Seed a prior, better round so the new measurement counts as a regression.
        store.upsertRecord(goal.cwd, {
            id: 'prior', goalId: goal.id, round: 1, startedAt: 0, hypothesis: 'h', config: {}, configFingerprint: 'fp-prior',
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
        Object.assign(runner, { runGit: (_cwd: string, args: readonly string[]) =>
            args[0] === 'diff' ? { stdout: ' src/train.py | 4 +-', ok: true } : { stdout: 'sha-x', ok: true } });
        const promise = runner.callStartNewRound(goal, 1);
        taskRunner.setLog(taskRunner.createdTasks[0].id, 'The agent forgot the marker entirely.');
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        const [record] = store.readLedgerForGoal(goal);
        expect(record.phase).to.equal('done'); // the round completed despite the format miss
        expect(record.hypothesis).to.equal('(not declared)');
        expect(record.config).to.deep.equal({ fallbackDiffStat: ' src/train.py | 4 +-' });
        expect(record.notes).to.contain('did not include a parseable');
    });

    it('fingerprint guard: re-prompts once on a repeated config, then accepts and moves on', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] });
        store.seedGoal(goal);
        // Round 1 already tried this exact config.
        store.upsertRecord(goal.cwd, {
            id: 'prior', goalId: goal.id, round: 1, startedAt: 0, hypothesis: 'h', config: { learning_rate: 0.01 },
            configFingerprint: configFingerprint({ learning_rate: 0.01 }),
            phase: 'done', metrics: [{ name: 'accuracy', value: 0.5, direction: 'max' }], verdict: 'improved',
        });
        taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.55', stderr: '', timedOut: false }];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callStartNewRound(goal, 2);
        // First propose attempt: repeats round 1's exact config.
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        // Runner should have re-prompted with a reminder instead of stalling. Flush the whole
        // microtask queue (setImmediate runs after it drains) rather than guessing a tick count.
        await new Promise(resolve => setImmediate(resolve));
        expect(taskRunner.createdTasks).to.have.lengthOf(2);
        expect((taskRunner.createdTasks[1].request as { prompt: string }).prompt).to.contain('fingerprint collision');
        // Second attempt still collides — the guard must accept it rather than loop forever.
        taskRunner.setLog(taskRunner.createdTasks[1].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[1].id);
        await promise;

        expect(taskRunner.createdTasks).to.have.lengthOf(2); // never re-prompted a third time
        const [record] = store.readLedgerForGoal(goal).filter(r => r.round === 2);
        expect(record.phase).to.equal('done');
        expect(record.config).to.deep.equal({ learning_rate: 0.01 });
    });

    it('terminates the loop and records the reason once resolveTerminationReason fires (reached-target)', async () => {
        const store = new FakeResearchStore();
        const taskRunner = new FakeTaskRunner();
        const goal = makeGoal({ metrics: [METRIC] }); // target 0.9
        store.seedGoal(goal);
        taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.95', stderr: '', timedOut: false }];

        const runner = makeRunner(store, taskRunner);
        const promise = runner.callRunLoop(goal.id);
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await promise;

        expect(taskRunner.createdTasks).to.have.lengthOf(1); // exactly one round, loop stopped
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
        taskRunner.setLog(taskRunner.createdTasks[0].id, proposalBlock({ learning_rate: 0.01 }));
        taskRunner.finishTask(taskRunner.createdTasks[0].id);
        await new Promise(resolve => setImmediate(resolve));

        runner.callCancel(goal.id);
        expect(taskRunner.cancelledIds).to.have.lengthOf(1);
        resolveRun({ exitCode: 1, stdout: '', stderr: 'killed', timedOut: false });
        await promise;

        const [record] = store.readLedgerForGoal(goal);
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
                id: 'r1', goalId: goal.id, round: 1, startedAt: 0, hypothesis: '', config: {}, configFingerprint: '',
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
                id: 'r1', goalId: goal.id, round: 1, startedAt: 0, hypothesis: 'h', lever: 'lr', config: { lr: 1 },
                configFingerprint: 'fp', sha: 'sha-1', baselineSha: 'sha-0', phase: 'run', metrics: [],
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
                id: 'r1', goalId: goal.id, round: 1, startedAt: 0, hypothesis: 'h', config: {}, configFingerprint: 'fp',
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
                id: 'r1', goalId: goal.id, round: 1, startedAt: 0, hypothesis: 'h', config: {}, configFingerprint: 'fp',
                sha: 'sha-1', phase: 'measure', metrics: [], runAttempts: 0,
            };
            taskRunner.genericCommandResults = [{ exitCode: 0, stdout: '0.7', stderr: '', timedOut: false }];

            const runner = makeRunner(store, taskRunner);
            await runner.callResumeRound(goal, ranAlready);

            expect(taskRunner.createdTasks).to.have.lengthOf(0);
            expect(taskRunner.genericCommandCalls).to.have.lengthOf(1);
            expect(taskRunner.genericCommandCalls[0].command).to.equal('python measure.py'); // never re-ran train.py
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
            expect(record.verdict).to.equal(undefined);
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
            expect(record.config).to.deep.equal({ learning_rate: 0.02 });
        });
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Wires the workflow planner into the running backend (ADR-001).
 *
 * Subscribes both runtimes' terminal events, reconciles unfinished runs once at boot, and offers
 * the one entry point that starts a run. Everything it does is a no-op until a run exists, so
 * binding it changes no existing behaviour.
 */

import { Disposable, DisposableCollection } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ChildProcess } from 'child_process';
import { isQaapAgentTaskFinished } from '../common/qaap-agent-task';
import { isQaapJobFinished } from '../common/qaap-job';
import { QaapWorkflowDef } from '../common/qaap-workflow-ir';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapJobRuntime } from './qaap-job-runtime';
import { QaapWorkflowDispatcher } from './qaap-workflow-dispatcher';
import { QaapTenantSpawnService } from './qaap-tenant-spawn-service';
import {
    QaapPersistedWorkflowRun,
    QaapStartWorkflowRunOptions,
    QaapWorkflowRunStore,
} from './qaap-workflow-run-store';

/**
 * How often the wall clocks are checked. Coarse on purpose: a deadline is a backstop against a
 * wedged process, so a minute of slack costs nothing and the sweep stays free when nothing runs.
 */
const DEADLINE_SWEEP_INTERVAL_MS = 60_000;

@injectable()
export class QaapWorkflowService implements BackendApplicationContribution {

    @inject(QaapWorkflowRunStore)
    protected readonly store: QaapWorkflowRunStore;

    @inject(QaapWorkflowDispatcher)
    protected readonly dispatcher: QaapWorkflowDispatcher;

    @inject(QaapAgentTaskRunner)
    protected readonly tasks: QaapAgentTaskRunner;

    @inject(QaapJobRuntime)
    protected readonly jobs: QaapJobRuntime;

    @inject(QaapTenantSpawnService)
    protected readonly tenantSpawn: QaapTenantSpawnService;

    protected readonly toDispose = new DisposableCollection();
    protected deadlineTimer: NodeJS.Timeout | undefined;

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.tasks.onDidChangeTask(event => {
            if (isQaapAgentTaskFinished(event.task.state)) {
                void this.onAgentTaskFinished(event.task.id);
            }
        }));
        this.toDispose.push(this.jobs.onDidChangeJob(event => {
            if (event.type !== 'output' && isQaapJobFinished(event.job.state)) {
                void this.dispatcher.onJobFinished(event.job.id, event.job.state, this.jobs.get(event.job.id)?.result)
                    .catch(error => console.warn('[qaap-workflow] failed to route a finished job:', error));
            }
        }));
    }

    onStart(): void {
        void this.dispatcher.reconcileOnBoot()
            // Runs that expired while the backend was down are stopped on the way back up, before
            // the timer's first tick.
            .then(() => this.sweepDeadlines())
            .catch(error => console.warn('[qaap-workflow] boot reconciliation failed:', error));
        this.deadlineTimer = setInterval(() => void this.sweepDeadlines(), DEADLINE_SWEEP_INTERVAL_MS);
        this.toDispose.push(Disposable.create(() => {
            if (this.deadlineTimer) {
                clearInterval(this.deadlineTimer);
                this.deadlineTimer = undefined;
            }
        }));
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    protected async sweepDeadlines(): Promise<void> {
        try {
            await this.dispatcher.sweepDeadlines(Date.now());
        } catch (error) {
            // The sweep is a backstop; one bad run must not stop the next tick.
            console.warn('[qaap-workflow] deadline sweep failed:', error);
        }
    }

    /** Start a workflow run and dispatch its entry nodes. */
    async start(def: QaapWorkflowDef, options: QaapStartWorkflowRunOptions): Promise<QaapPersistedWorkflowRun> {
        const started = await this.store.start(def, {
            ...options,
            baseRef: options.baseRef ?? await this.captureBaseRef(options.cwd),
        });
        await this.dispatcher.dispatch(started.record, started.dispatch);
        return this.store.get(options.ownerLogin, started.record.run.id) ?? started.record;
    }

    /**
     * The commit the repository is on right now, so the run's risk gate and diff see everything the
     * agents do — including work they commit, which the default prompt actively encourages.
     * Undefined outside a git repository; the deterministic ops then fall back to `HEAD`.
     */
    protected async captureBaseRef(cwd: string): Promise<string | undefined> {
        try {
            const stdout = await this.runGitOutput(cwd, ['rev-parse', 'HEAD'], 10_000);
            const ref = stdout.trim();
            return /^[0-9a-f]{7,40}$/.test(ref) ? ref : undefined;
        } catch {
            return undefined;
        }
    }

    /** Run tenant-controlled Git only through the tenant worker in hosted mode. */
    protected async runGitOutput(cwd: string, args: readonly string[], timeoutMs: number): Promise<string> {
        const child = await this.tenantSpawn.spawnArgvPreparedAsync('git', [
            '-c', 'core.hooksPath=/dev/null',
            '-c', 'core.fsmonitor=false',
            ...args,
        ], {
            cwd,
            env: { PATH: process.env.PATH ?? '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return this.collectGitOutput(child, timeoutMs);
    }

    protected collectGitOutput(child: ChildProcess, timeoutMs: number): Promise<string> {
        return new Promise((resolve, reject) => {
            let stdout = '';
            let settled = false;
            const finish = (callback: () => void): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                callback();
            };
            const timer = setTimeout(() => {
                child.kill('SIGKILL');
                finish(() => reject(new Error('Git command timed out.')));
            }, timeoutMs);
            child.stdout?.on('data', chunk => {
                if (stdout.length < 8192) {
                    stdout += String(chunk).slice(0, 8192 - stdout.length);
                }
            });
            child.once('error', error => finish(() => reject(error)));
            child.once('close', code => finish(() => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Git exited with code ${code ?? 'unknown'}.`));
                }
            }));
        });
    }

    /** Resume a run parked at a human gate. */
    continueAfterHumanGate(ownerLogin: string | undefined, runId: string, nodeId: string): Promise<void> {
        return this.dispatcher.continueAfterHumanGate(ownerLogin ?? '', runId, nodeId);
    }

    protected async onAgentTaskFinished(taskId: string): Promise<void> {
        try {
            // The log is only read for tasks that belong to a run, so unrelated tasks cost nothing.
            if (!this.store.findByExternalId(taskId)) {
                return;
            }
            const detail = await this.tasks.detail(taskId);
            if (detail) {
                await this.dispatcher.onAgentTaskFinished(taskId, detail.state, detail.log);
            }
        } catch (error) {
            console.warn('[qaap-workflow] failed to route a finished agent task:', error);
        }
    }
}

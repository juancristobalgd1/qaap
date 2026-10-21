// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import type {
    QaapAgentTask,
    QaapAgentTaskEvent,
    QaapAgentTaskState,
    QaapCreateAgentTaskQaiqModel,
    QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import { MAX_AGENT_MODEL_FALLBACK_ATTEMPTS, agentModelKey, buildAgentModelFallbackChain } from '../common/qaap-agent-model-fallback';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { restorePersistedIndexExtracted } from './qaap-agent-task-runner-render2';
import { finishTaskExtracted, notifyCompletionExtracted } from './qaap-agent-task-runner-tool-pills2';
import { QaapStandaloneTaskModelFallback } from './qaap-standalone-task-model-fallback';

/** Provider error of a decommissioned model, as the QAIQ CLI prints it (no transcript text). */
const DEAD_MODEL_LOG = [
    '{"type":"system","subtype":"init","model":"dead/model:free","tools":[]}',
    'API Error: 404 {"error":{"message":"Provider returned error","metadata":{"raw":"Function \'abc\': Not found for account \'xyz\'"}}}',
].join('\n');

/** A turn that answered: real transcript text, so a failure here is the work's, not the model's. */
const ANSWERED_LOG = '{"type":"assistant","timestamp_ms":1,"message":{"content":[{"type":"text","text":"The build is still red: TypeError in app.ts."}]}}';

const FIRST_MODEL: QaapCreateAgentTaskQaiqModel = buildAgentModelFallbackChain('qaiq', undefined)[0];

interface PushPayload {
    readonly title: string;
    readonly body: string;
}

interface FakeRunner {
    readonly tasks: Map<string, QaapAgentTask>;
    readonly logs: Map<string, string>;
    readonly pushes: PushPayload[];
    readonly created: Array<{ readonly request: QaapCreateAgentTaskRequest; readonly ownerLogin: string | undefined }>;
    readonly events: QaapAgentTaskEvent[];
    createError?: Error;
    suppressCompletionPushForTask?: (task: QaapAgentTask) => boolean | Promise<boolean>;
    create(request: QaapCreateAgentTaskRequest, ownerLogin?: string): QaapAgentTask;
    finish(id: string, state: QaapAgentTaskState, log: string): void;
}

/**
 * The runner surface the fallback service and the completion push use, with the REAL finishTask,
 * notifyCompletion and recordModelFallback so event order and push gating match production.
 */
function fakeRunner(): FakeRunner {
    const emitter = new Emitter<QaapAgentTaskEvent>();
    let nextId = 1;
    const runner = {
        tasks: new Map<string, QaapAgentTask>(),
        logs: new Map<string, string>(),
        pushes: [] as PushPayload[],
        created: [] as FakeRunner['created'],
        events: [] as QaapAgentTaskEvent[],
        onDidChangeTaskEmitter: emitter,
        onDidChangeTask: emitter.event,
        taskPauseCauses: new Map(),
        webPush: { notify: async (payload: PushPayload) => { runner.pushes.push(payload); } },
        persist: async () => undefined,
        drainQueuedTasks: () => undefined,
        captureWorktreeFingerprint: () => undefined,
        createError: undefined as Error | undefined,
        suppressCompletionPushForTask: undefined as FakeRunner['suppressCompletionPushForTask'],
        notifyCompletion(task: QaapAgentTask): Promise<void> {
            return notifyCompletionExtracted(runner as unknown as QaapAgentTaskRunnerContext, task);
        },
        recordModelFallback(failedTaskId: string, fallbackTaskId: string): QaapAgentTask | undefined {
            return QaapAgentTaskRunner.prototype.recordModelFallback.call(runner as unknown as QaapAgentTaskRunner, failedTaskId, fallbackTaskId);
        },
        async detail(id: string): Promise<(QaapAgentTask & { log: string }) | undefined> {
            const task = runner.tasks.get(id);
            return task ? { ...task, log: runner.logs.get(id) ?? '' } : undefined;
        },
        create(request: QaapCreateAgentTaskRequest, ownerLogin?: string): QaapAgentTask {
            if (runner.createError) {
                throw runner.createError;
            }
            runner.created.push({ request, ownerLogin });
            const model = request.agentModel ?? FIRST_MODEL;
            const task: QaapAgentTask = {
                id: `t${nextId++}`,
                title: request.title ?? 'task',
                command: request.prompt ?? '',
                cwd: request.cwd,
                agentId: request.agent ?? 'qaiq',
                state: 'running',
                createdAt: Date.now(),
                agentModel: model,
                qaiqModel: model,
                ...(request.parentId ? { parentId: request.parentId } : {}),
                ...(request.readOnlyWorkspace ? { readOnlyWorkspace: true } : {}),
                ...(ownerLogin ? { ownerLogin } : {}),
                ...(request.fallbackFromTaskId ? { fallbackFromTaskId: request.fallbackFromTaskId } : {}),
            };
            runner.tasks.set(task.id, task);
            emitter.fire({ type: 'created', task });
            return task;
        },
        finish(id: string, state: QaapAgentTaskState, log: string): void {
            runner.logs.set(id, log);
            finishTaskExtracted(runner as unknown as QaapAgentTaskRunnerContext, id, state, state === 'failed' ? 1 : 0);
        },
    };
    emitter.event(event => runner.events.push(event));
    return runner;
}

function fallbackService(runner: FakeRunner): QaapStandaloneTaskModelFallback {
    const service = new QaapStandaloneTaskModelFallback();
    Object.assign(service, { runner });
    (service as unknown as { init(): void }).init();
    return service;
}

const REQUEST: QaapCreateAgentTaskRequest = {
    cwd: '/workspace/repos/users/alice/o/app',
    prompt: 'Reply with OK',
    title: 'Smoke',
    readOnlyWorkspace: true,
    clientRequestId: 'client-1',
};

/** Creates a task the way the endpoint does: runner.create, then track. */
function createStandalone(runner: FakeRunner, service: QaapStandaloneTaskModelFallback, request: QaapCreateAgentTaskRequest = REQUEST): QaapAgentTask {
    const task = runner.create(request, 'alice');
    service.track(task, request, 'alice');
    return task;
}

/** Lets the async decision and the completion push run. */
async function settle(service: QaapStandaloneTaskModelFallback, taskId: string): Promise<boolean | undefined> {
    const decision = await service.pendingDecision(taskId);
    await new Promise(resolve => setTimeout(resolve, 0));
    return decision;
}

describe('QaapStandaloneTaskModelFallback', () => {

    it('re-runs a task whose model is unavailable on the next model, with the same request', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);

        runner.finish(first.id, 'failed', DEAD_MODEL_LOG);
        expect(await settle(service, first.id)).to.equal(true);

        expect(runner.created).to.have.length(2);
        const retry = runner.created[1];
        expect(retry.ownerLogin).to.equal('alice');
        expect(retry.request.cwd).to.equal(REQUEST.cwd);
        expect(retry.request.prompt).to.equal(REQUEST.prompt);
        expect(retry.request.readOnlyWorkspace).to.equal(true);
        expect(retry.request.agent).to.equal('qaiq');
        expect(retry.request.clientRequestId, 'a reused idempotency key would return the failed task').to.equal(undefined);
        expect(retry.request.fallbackFromTaskId).to.equal(first.id);
        const expectedNext = buildAgentModelFallbackChain('qaiq', FIRST_MODEL)[1];
        expect(agentModelKey(retry.request.agentModel)).to.equal(agentModelKey(expectedNext));

        expect(runner.tasks.get(first.id)?.modelFallbackTaskId).to.equal('t2');
        expect(runner.tasks.get('t2')?.fallbackFromTaskId).to.equal(first.id);
        expect(runner.events.some(event => event.type === 'updated' && event.task.id === first.id && event.task.modelFallbackTaskId === 't2')).to.equal(true);
    });

    it('re-runs a failed task that produced no output', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);

        runner.finish(first.id, 'failed', '');

        expect(await settle(service, first.id)).to.equal(true);
        expect(runner.created).to.have.length(2);
    });

    it('sends one completion push for the whole chain: the final outcome', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);

        runner.finish(first.id, 'failed', DEAD_MODEL_LOG);
        await settle(service, first.id);
        expect(runner.pushes, 'the replaced attempt must not notify').to.have.length(0);

        runner.finish('t2', 'completed', ANSWERED_LOG);
        await settle(service, 't2');
        expect(runner.pushes).to.have.length(1);
        expect(runner.pushes[0].title).to.equal('Task finished');
    });

    it('does not retry a task refused before spawn for a missing provider key', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);
        runner.tasks.set(first.id, { ...runner.tasks.get(first.id)!, preflightFailure: 'provider_key_missing' });

        runner.finish(first.id, 'failed', 'Add your OpenRouter API key in Settings → BYOK to use QAIQ.');

        expect(await settle(service, first.id)).to.equal(false);
        expect(runner.created).to.have.length(1);
        expect(runner.pushes, 'the final (only) attempt still notifies').to.have.length(1);
        expect(runner.pushes[0].title).to.equal('Task failed');
    });

    it('does not retry when the provider preflight proved the key rejected', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);
        runner.tasks.set(first.id, { ...runner.tasks.get(first.id)!, providerKeyVerdict: 'key_rejected' });

        runner.finish(first.id, 'failed', DEAD_MODEL_LOG);

        expect(await settle(service, first.id)).to.equal(false);
        expect(runner.created).to.have.length(1);
    });

    it('does not retry a cancelled or interrupted task', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const cancelled = createStandalone(runner, service);
        const interrupted = createStandalone(runner, service);

        runner.finish(cancelled.id, 'cancelled', '');
        runner.finish(interrupted.id, 'interrupted', '');

        expect(service.pendingDecision(cancelled.id)).to.equal(undefined);
        expect(service.pendingDecision(interrupted.id)).to.equal(undefined);
        expect(runner.created).to.have.length(2);
    });

    it('does not retry a plan-limit refusal', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);

        runner.finish(first.id, 'failed', '[qaap:plan_limit:runtime_exhausted] Agent runtime allowance is used up for this billing period.');

        expect(await settle(service, first.id)).to.equal(false);
        expect(runner.created).to.have.length(1);
    });

    it('does not retry a failure the turn itself explains (non-retryable)', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);

        runner.finish(first.id, 'failed', ANSWERED_LOG);

        expect(await settle(service, first.id)).to.equal(false);
        expect(runner.created).to.have.length(1);
    });

    it('does not retry a plain-text turn that worked just because a tool line mentions a missing model', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service, { ...REQUEST, agent: 'gemini' });

        runner.finish(first.id, 'failed', [
            'Updated src/app.ts and src/model.ts.',
            '$ npm test',
            'Error: model not found: User (prisma schema)',
            'Tests failed: 3 of 40.',
        ].join('\n'));

        expect(await settle(service, first.id)).to.equal(false);
        expect(runner.created).to.have.length(1);
    });

    it('retries a plain-text turn whose CLI itself ends on an unavailable model', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service, { ...REQUEST, agent: 'gemini' });

        runner.finish(first.id, 'failed', 'Reading src/app.ts\nError: model not found: gemini-9-ultra\n');

        expect(await settle(service, first.id)).to.equal(true);
    });

    it('retries a turn with no output whose provider error only reached stderr', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);

        runner.finish(first.id, 'failed', 'API Error: 404 No endpoints found for dead/model:free.\n');

        expect(await settle(service, first.id)).to.equal(true);
        expect(runner.created).to.have.length(2);
    });

    it('does not retry a task the runner could not start (deterministic pre-spawn failure)', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);

        runner.finish(first.id, 'failed', 'Failed to start: EACCES: permission denied, cwd outside the owner workspace (403)\n');

        expect(await settle(service, first.id)).to.equal(false);
        expect(runner.created).to.have.length(1);
    });

    it('does not retry an agent without a model chain (shell)', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service, { ...REQUEST, agent: 'shell' });

        runner.finish(first.id, 'failed', '');

        expect(await settle(service, first.id)).to.equal(false);
        expect(runner.created).to.have.length(1);
    });

    it(`stops after ${MAX_AGENT_MODEL_FALLBACK_ATTEMPTS} attempts in all and never repeats a model`, async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        let current = createStandalone(runner, service).id;

        for (let attempt = 0; attempt < MAX_AGENT_MODEL_FALLBACK_ATTEMPTS + 2; attempt++) {
            runner.finish(current, 'failed', DEAD_MODEL_LOG);
            await settle(service, current);
            const next = runner.tasks.get(current)?.modelFallbackTaskId;
            if (!next) {
                break;
            }
            current = next;
        }

        const chainLength = buildAgentModelFallbackChain('qaiq', FIRST_MODEL).length;
        expect(runner.created).to.have.length(Math.min(MAX_AGENT_MODEL_FALLBACK_ATTEMPTS, chainLength));
        const models = runner.created.map(entry => agentModelKey(entry.request.agentModel ?? FIRST_MODEL));
        expect(new Set(models).size).to.equal(models.length);
        expect(runner.pushes, 'only the end of the chain notifies').to.have.length(1);
    });

    it('never retries a task it did not track (conversation-owned tasks)', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const conversationTask = runner.create(REQUEST, 'alice');

        runner.finish(conversationTask.id, 'failed', DEAD_MODEL_LOG);

        expect(service.pendingDecision(conversationTask.id)).to.equal(undefined);
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(runner.created).to.have.length(1);
        expect(runner.pushes).to.have.length(1);
    });

    it('does not track helper sub-tasks (their parent reads one mailbox result)', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const parent = runner.create(REQUEST, 'alice');
        const child = createStandalone(runner, service, { ...REQUEST, parentId: parent.id });

        runner.finish(child.id, 'failed', DEAD_MODEL_LOG);

        expect(service.pendingDecision(child.id)).to.equal(undefined);
    });

    it('keeps the failed attempt final when the retry cannot be created', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);
        runner.createError = new Error('queue full');

        runner.finish(first.id, 'failed', DEAD_MODEL_LOG);

        expect(await settle(service, first.id)).to.equal(false);
        expect(runner.tasks.get(first.id)?.modelFallbackTaskId).to.equal(undefined);
        expect(runner.pushes).to.have.length(1);
        expect(runner.pushes[0].title).to.equal('Task failed');
    });

    it('persists the chain links: they survive a restore of the task index', async () => {
        const runner = fakeRunner();
        const service = fallbackService(runner);
        const first = createStandalone(runner, service);
        runner.finish(first.id, 'failed', DEAD_MODEL_LOG);
        await settle(service, first.id);
        runner.finish('t2', 'completed', ANSWERED_LOG);

        // What persistExtracted writes, through JSON, then a fresh runner restores it.
        const stored = JSON.parse(JSON.stringify({ version: 2, tasks: [...runner.tasks.values()], queuedRequests: {} }));
        const restored = { tasks: new Map<string, QaapAgentTask>(), queuedCreateRequests: new Map() } as unknown as QaapAgentTaskRunnerContext;
        restorePersistedIndexExtracted(restored, stored);

        expect(restored.tasks.get(first.id)?.modelFallbackTaskId).to.equal('t2');
        expect(restored.tasks.get('t2')?.fallbackFromTaskId).to.equal(first.id);
    });
});

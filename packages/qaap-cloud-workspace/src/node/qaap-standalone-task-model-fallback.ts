// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { QaapPlanLimit } from '@theia/qaap-adapters/lib/common/qaap-plan-limit';
import { detectAgentFailureKind, type QaapAgentFailureKind } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { parseAgentLogForTranscript } from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';
import {
    isQaapAgentTaskFinished,
    resolveTaskAgentModel,
    type QaapAgentTask,
    type QaapAgentTaskEvent,
    type QaapCreateAgentTaskRequest,
} from '../common/qaap-agent-task';
import {
    MAX_AGENT_MODEL_FALLBACK_ATTEMPTS,
    agentModelKey,
    agentTurnHasRetryableEmptyOutput,
    agentTurnHasRetryableModelFailure,
    agentTurnHasRetryableToolSupportFailure,
    agentTurnMayFallBackToAnotherModel,
    agentTurnQualifiesForModelFallback,
    resolveNextFallbackAgentModel,
    type QaapAgentModelFallbackEvidence,
} from '../common/qaap-agent-model-fallback';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/** What the endpoint keeps about a standalone task it created: enough to re-run it on another model. */
interface QaapStandaloneTaskOrigin {
    readonly request: QaapCreateAgentTaskRequest;
    readonly ownerLogin: string | undefined;
}

/**
 * Failure kinds that belong to the user's account rather than to the model: every model of the
 * agent runs on the same key and the same plan, so a fallback would fail the same way. The
 * conversation path reads these from the provider preflight verdict and the quota dialog; a
 * standalone task has neither, so its log is checked as well.
 */
const ACCOUNT_LEVEL_FAILURE_KINDS: ReadonlySet<QaapAgentFailureKind> = new Set<QaapAgentFailureKind>([
    'auth',
    'quota',
    'provider_key_rejected',
    'provider_credits',
    'provider_free_limit',
    'cli_missing',
]);

/**
 * Model fallback for STANDALONE agent tasks (`POST /qaap/api/agent-tasks`: the post-deploy smoke, the
 * mobile task composer, the `qaap-task` helper's top-level callers). Conversation turns already fall
 * back inside the conversation store; this covers tasks no conversation owns.
 *
 * Only tasks the endpoint registered through {@link track} are considered, so a conversation-owned
 * task (created with `runner.create` by the store) is never retried twice. When a tracked task
 * settles and qualifies by the SAME contract as a conversation turn
 * (`agentTurnQualifiesForModelFallback`), the original request is re-run on the next untried model
 * of the agent's chain. The new task carries `fallbackFromTaskId`, the failed one
 * `modelFallbackTaskId`; both persist in the task index, so clients can follow the chain after a
 * restart. A replaced attempt sends no completion push: the chain notifies once, for its final task.
 *
 * Retries go through `runner.create`, so the billing gate, queue policy and runtime debit apply to
 * each attempt exactly as they do to a conversation fallback.
 */
@injectable()
export class QaapStandaloneTaskModelFallback {

    @inject(QaapAgentTaskRunner)
    protected readonly runner: QaapAgentTaskRunner;

    /** Live standalone tasks by id. In memory: a backend restart settles running tasks `interrupted`, which never fall back. */
    protected readonly origins = new Map<string, QaapStandaloneTaskOrigin>();

    /** Pending fallback decisions by task id; the runner's completion push awaits them. */
    protected readonly decisions = new Map<string, Promise<boolean>>();

    @postConstruct()
    protected init(): void {
        this.runner.onDidChangeTask(event => this.onTaskChanged(event));
        // finishTask fires the event before it calls notifyCompletion, and notifyCompletion reads
        // this gate synchronously, so the decision registered by onTaskChanged is always found.
        this.runner.suppressCompletionPushForTask = task => this.decisions.get(task.id) ?? false;
    }

    /**
     * Registers a task the endpoint just created for the request it was created from. Sub-tasks
     * spawned through the `qaap-task` helper (`parentId`) are left out: their parent turn reads their
     * result from its mailbox, and a retry there would deliver one result per attempt.
     */
    track(task: QaapAgentTask, request: QaapCreateAgentTaskRequest, ownerLogin: string | undefined): void {
        if (task.parentId || request.parentId || isQaapAgentTaskFinished(task.state)) {
            return;
        }
        this.origins.set(task.id, { request, ownerLogin });
    }

    /** @internal Exposed for tests: the decision for a settled task, when one is pending. */
    pendingDecision(taskId: string): Promise<boolean> | undefined {
        return this.decisions.get(taskId);
    }

    protected onTaskChanged(event: QaapAgentTaskEvent): void {
        if (event.type !== 'completed' && event.type !== 'cancelled' && event.type !== 'deleted') {
            return;
        }
        const origin = this.origins.get(event.task.id);
        if (!origin) {
            return;
        }
        this.origins.delete(event.task.id);
        // 'completed' covers every settle except cancel; the state tells failed from finished.
        if (event.type !== 'completed' || (event.task.state !== 'failed' && event.task.state !== 'completed')) {
            return;
        }
        const taskId = event.task.id;
        const decision = this.decide(event.task, origin).catch(error => {
            console.warn(`[qaap-agent-tasks] model fallback for task ${taskId} failed:`, error instanceof Error ? error.message : error);
            return false;
        });
        this.decisions.set(taskId, decision);
        decision.then(() => this.decisions.delete(taskId));
    }

    /** Launches the fallback retry when the settled task qualifies; resolves `true` when it did. */
    protected async decide(task: QaapAgentTask, origin: QaapStandaloneTaskOrigin): Promise<boolean> {
        const agentId = task.agentId?.trim();
        // Cheap gates first: no chain for this agent, or the user's key stopped the turn.
        if (!agentId || !agentTurnMayFallBackToAnotherModel(agentId, task)) {
            return false;
        }
        const detail = await this.runner.detail(task.id);
        const log = detail?.log ?? '';
        if (!this.qualifies(agentId, task, log)) {
            return false;
        }
        const { attempts, triedModelKeys } = this.inspectChain(task);
        if (attempts >= MAX_AGENT_MODEL_FALLBACK_ATTEMPTS) {
            return false;
        }
        const currentModel = resolveTaskAgentModel(task);
        const nextModel = resolveNextFallbackAgentModel(agentId, currentModel, triedModelKeys);
        if (!nextModel) {
            return false;
        }
        const current = this.runner.tasks.get(task.id);
        // Someone already replaced it (a Retry from the UI does not link, but a second decision would).
        if (!current || current.modelFallbackTaskId) {
            return false;
        }
        const request: QaapCreateAgentTaskRequest = {
            ...origin.request,
            // A reused idempotency key would hand back the failed task instead of a new attempt.
            clientRequestId: undefined,
            // Pin the agent the failed attempt resolved: the chain is that agent's.
            agent: agentId,
            agentModel: nextModel,
            qaiqModel: nextModel,
            fallbackFromTaskId: task.id,
        };
        let retry: QaapAgentTask;
        try {
            retry = this.runner.create(request, origin.ownerLogin);
        } catch (error) {
            // Queue full, storage down, plan refusal at create: the failed attempt stays final.
            console.warn(`[qaap-agent-tasks] model fallback for task ${task.id} could not start:`, error instanceof Error ? error.message : error);
            return false;
        }
        this.runner.recordModelFallback(task.id, retry.id);
        this.track(retry, request, origin.ownerLogin);
        console.info(`[qaap-agent-tasks] task ${task.id} failed on ${agentModelKey(currentModel) ?? 'the default model'}; `
            + `retrying as ${retry.id} on ${agentModelKey(nextModel)} (attempt ${attempts + 1}/${MAX_AGENT_MODEL_FALLBACK_ATTEMPTS}).`);
        return true;
    }

    /**
     * The conversation contract applied to a task log: the transcript parser rebuilds what a
     * conversation turn would have shown (empty output, tool calls emitted as text), and the raw log
     * adds provider errors printed outside the transcript (stderr) to the `model_unavailable` check.
     */
    protected qualifies(agentId: string, task: QaapAgentTask, log: string): boolean {
        if (this.hasPlanLimitRefusal(log)) {
            return false;
        }
        const kind = detectAgentFailureKind(log);
        if (kind && ACCOUNT_LEVEL_FAILURE_KINDS.has(kind)) {
            return false;
        }
        if (this.hasPreSpawnFailure(log)) {
            return false;
        }
        const evidence = this.parseEvidence(agentId, log);
        if (!agentTurnQualifiesForModelFallback(agentId, task, evidence)) {
            return false;
        }
        // No meaningful output (a provider error on stderr lands here) or a tool-support failure:
        // nothing of value is lost by starting over on another model.
        if (!evidence || agentTurnHasRetryableEmptyOutput(evidence) || agentTurnHasRetryableToolSupportFailure(evidence)) {
            return true;
        }
        // The turn worked and the contract matched on `model_unavailable` somewhere in its transcript.
        // For a plain-text CLI that transcript is every tool line too, and a standalone retry starts a
        // long turn from scratch on a workspace the first attempt already changed: only the CLI's own
        // failure (its error records, or the last line it printed) may name the model as the cause.
        return agentTurnHasRetryableModelFailure({ content: this.cliFailureText(log) });
    }

    /** The CLI's own failure statement: top-level JSON error / `is_error` result records, then its last plain line. */
    protected cliFailureText(log: string): string {
        const records: string[] = [];
        let lastPlainLine: string | undefined;
        for (const raw of log.split('\n')) {
            const line = raw.trim();
            if (!line) {
                continue;
            }
            if (line.startsWith('{')) {
                try {
                    const record = JSON.parse(line) as { readonly type?: unknown; readonly is_error?: unknown; readonly error?: unknown };
                    if (record.type === 'error' || (record.type === 'result' && record.is_error === true)
                        || (record.type === undefined && record.error !== undefined)) {
                        records.push(line);
                    }
                    continue;
                } catch {
                    // Not JSON: a plain line.
                }
            }
            lastPlainLine = line;
        }
        return [...records, ...(lastPlainLine ? [lastPlainLine] : [])].join('\n');
    }

    /**
     * The runner could not spawn the agent at all (`Failed to start: …` — cwd ownership 403, sandbox,
     * missing binary): deterministic and independent of the model, so another model fails the same way.
     */
    protected hasPreSpawnFailure(log: string): boolean {
        return /^Failed to start:/m.test(log);
    }

    protected parseEvidence(agentId: string, log: string): QaapAgentModelFallbackEvidence | undefined {
        // The stream parsers are line-buffered: a log whose last record has no newline would read
        // as "no output" and turn a real answer into a retry.
        const parsed = parseAgentLogForTranscript(agentId, log.endsWith('\n') ? log : `${log}\n`);
        if (!parsed.content.trim() && parsed.segments.length === 0) {
            return undefined;
        }
        return { content: parsed.content, segments: parsed.segments };
    }

    /** The billing gate writes a tagged line (`[qaap:plan_limit:…]`) before refusing the turn. */
    protected hasPlanLimitRefusal(log: string): boolean {
        return log.split('\n').some(line => QaapPlanLimit.parse(line) !== undefined);
    }

    /**
     * Walks the chain back through `fallbackFromTaskId`: how many attempts it already made
     * (including this task) and which models they ran on. A predecessor pruned from the index still
     * counts as an attempt; only its model is unknown.
     */
    protected inspectChain(task: QaapAgentTask): { readonly attempts: number; readonly triedModelKeys: ReadonlySet<string> } {
        const triedModelKeys = new Set<string>();
        const seen = new Set<string>();
        let attempts = 0;
        let current: QaapAgentTask | undefined = task;
        let currentId: string | undefined = task.id;
        while (currentId && !seen.has(currentId)) {
            seen.add(currentId);
            attempts++;
            const key = agentModelKey(current ? resolveTaskAgentModel(current) : undefined);
            if (key) {
                triedModelKeys.add(key);
            }
            currentId = current?.fallbackFromTaskId;
            current = currentId ? this.runner.tasks.get(currentId) : undefined;
        }
        return { attempts, triedModelKeys };
    }
}

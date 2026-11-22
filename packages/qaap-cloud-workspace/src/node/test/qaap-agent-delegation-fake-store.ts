// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Test doubles shared by the delegation service, endpoint and end-to-end specs. */

import { Emitter } from '@theia/core/lib/common/event';
import { type QaapAgentConversation, type QaapAgentConversationEvent, type QaapCreateAgentConversationRequest, toConversationSummary } from '../../common/qaap-agent-conversation';
import type { QaapConversationTaskRef, QaapGoalLoopTurnSettlement, PostUserMessageInternalOptions } from '../qaap-agent-conversation-store-constants';
import { runGitAsync, runGitBufferAsync, type QaapGitBufferRunResult, type QaapGitRunResult } from '../qaap-agent-conversation-store-git';
import { QaapAgentDelegationService } from '../qaap-agent-delegation-service';
import { neutralizeQaapAgentMentions } from '../../common/qaap-agent-delegation-protocol';

export const TURN_TASK_STATES = ['completed', 'blocked', 'failed', 'cancelled'] as const;
export type FakeTaskState = typeof TURN_TASK_STATES[number];
export const KNOWN_AGENTS = ['claude', 'codex', 'pi', 'qwen'];

/** Just enough of the conversation store and worktree service for the delegation service. */
export class FakeStore {
    readonly conversations = new Map<string, QaapAgentConversation>();
    readonly changes = new Emitter<QaapAgentConversationEvent>();
    readonly settles = new Emitter<QaapGoalLoopTurnSettlement>();
    readonly onDidChange = this.changes.event;
    readonly onDidSettleTurn = this.settles.event;
    readonly cancelRequests = new Emitter<string>();
    readonly onDidRequestCancel = this.cancelRequests.event;
    /** A user Stop on `id` (the real store fires this from `cancel`, even for an idle conversation). */
    userStop(id: string): void {
        this.cancelRequests.fire(id);
    }
    readonly cancelled: string[] = [];
    readonly posted: { id: string; content: string; interactionModeId?: string; agentOverride?: string; internal?: PostUserMessageInternalOptions }[] = [];
    /** Runner tasks by id (the endpoint reads `readOnlyWorkspace` of the token's task). */
    readonly tasks = new Map<string, { readonly id: string; readonly readOnlyWorkspace?: boolean }>();
    findTaskById(id: string): { readonly id: string; readonly readOnlyWorkspace?: boolean } | undefined {
        return this.tasks.get(id);
    }
    /** Task id → conversation turn, as the real store records it when a turn spawns. */
    readonly taskToConversation = new Map<string, QaapConversationTaskRef>();
    private counter = 0;

    get(id: string): QaapAgentConversation | undefined {
        return this.conversations.get(id);
    }
    listAllGroupedByCwd(): { conversations: ReturnType<typeof toConversationSummary>[] }[] {
        return [{ conversations: [...this.conversations.values()].map(conv => toConversationSummary(conv)) }];
    }
    getActiveTaskIdsForConversation(id: string): string[] {
        return this.activeTasks.get(id) ?? [];
    }
    /** Agents the runner reports as connected (`available`), and the models each one lists. */
    readonly disconnectedAgents = new Set<string>();
    readonly agentModels: Record<string, { provider: 'openai' | 'anthropic'; vendor: string; modelId: string; label: string; available?: boolean }[]> = {
        codex: [{ provider: 'openai', vendor: 'openai', modelId: 'gpt-5.5', label: 'GPT-5.5' }, { provider: 'openai', vendor: 'openai', modelId: 'gpt-pro', label: 'Pro', available: false }],
    };
    readonly taskRunner = {
        listAgents: (_owner?: string) => [...KNOWN_AGENTS, 'shell'].map(id => ({ id, label: id, available: !this.disconnectedAgents.has(id) })),
        /** Reason `checkGitExecConfig` reports for every cwd (a spec sets it to simulate a hostile git config). */
        gitExecRisk: undefined as string | undefined,
        checkGitExecConfig: (_cwd: string): string | undefined => this.taskRunner.gitExecRisk,
        listModelsForAgent: (agentId: string | undefined, _owner?: string) => this.agentModels[agentId ?? ''] ?? [],
    };
    isKnownAgentId(agentId: string): boolean {
        return KNOWN_AGENTS.includes(agentId);
    }
    /** Runs the job at once: the specs use one repository per test, so there is nothing to serialize against. */
    runSerializedGit<T>(_cwd: string, job: () => Promise<T>): Promise<T> {
        return job();
    }
    /** Real git in `cwd` (child-apply specs run against temporary repositories); stdin is `input` when given. */
    mutatingGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv, timeoutMs?: number, input?: string | Buffer): Promise<QaapGitRunResult> {
        return runGitAsync('git', args, { cwd, timeoutMs: timeoutMs ?? 60_000, ...(env ? { env } : {}), ...(input !== undefined ? { input } : {}) });
    }
    /** Like {@link mutatingGit} with stdout as the exact bytes. */
    mutatingGitBuffer(cwd: string, args: string[], timeoutMs?: number, env?: NodeJS.ProcessEnv): Promise<QaapGitBufferRunResult> {
        return runGitBufferAsync('git', args, { cwd, timeoutMs: timeoutMs ?? 60_000, ...(env ? { env } : {}) });
    }
    captureGitSha(_cwd: string): string {
        return 'base-sha';
    }
    async readGit(_cwd: string, _args: readonly string[]): Promise<QaapGitRunResult> {
        return { status: 1, stdout: '', stderr: 'no git in this fake' } as unknown as QaapGitRunResult;
    }
    create(request: QaapCreateAgentConversationRequest, ownerLogin?: string): QaapAgentConversation {
        const id = `child-${++this.counter}`;
        const conv: QaapAgentConversation = {
            id,
            cwd: request.cwd,
            agentId: request.agent ?? 'claude',
            ...(request.agentModel ? { agentModel: request.agentModel } : {}),
            title: request.title ?? '',
            status: 'idle',
            createdAt: 0,
            updatedAt: 0,
            messages: [],
            ...(ownerLogin ? { ownerLogin } : {}),
            ...(request.parentConversationId ? { parentConversationId: request.parentConversationId } : {}),
            ...(request.delegation ? { delegation: request.delegation } : {}),
            ...(request.worktreeBranch ? { worktreeBranch: request.worktreeBranch } : {}),
            ...(request.parallelBaseCwd ? { parallelBaseCwd: request.parallelBaseCwd } : {}),
            ...(request.autoApprove === false ? { autoApprove: false } : {}),
            ...(request.approvalPolicyId ? { approvalPolicyId: request.approvalPolicyId } : {}),
            ...(request.toolApprovalRules ? { toolApprovalRules: request.toolApprovalRules } : {}),
            ...(request.interactionModeId ? { interactionModeId: request.interactionModeId } : {}),
            ...(request.taskPullRequestEnabled === false ? { taskPullRequestEnabled: false } : {}),
        };
        this.conversations.set(id, conv);
        this.changes.fire({ type: 'created', conversation: toConversationSummary(conv) });
        if (request.message) {
            // Like the real store: a delegated child's first message never routes by mention.
            this.postUserMessage(id, request.message, request.agent, undefined, undefined, undefined, undefined, undefined, undefined,
                request.delegation ? { noMentionRouting: true } : undefined);
        }
        return this.conversations.get(id)!;
    }
    readonly persisted: string[] = [];
    readonly deletedIds: string[] = [];
    /** Conversation id → active task ids, so a spec can hold a parent "busy". */
    readonly activeTasks = new Map<string, string[]>();
    whenReady(): Promise<void> {
        return Promise.resolve();
    }
    setDelegationState(id: string, patch: Pick<Partial<QaapAgentConversation>, 'delegation' | 'delegationParent'>): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (!conv) {
            return undefined;
        }
        const next = { ...conv, ...patch };
        this.conversations.set(id, next);
        this.persisted.push(id);
        this.changes.fire({ type: 'updated', conversation: toConversationSummary(next) });
        return next;
    }
    archive(id: string): void {
        const next = { ...this.conversations.get(id)!, archived: true };
        this.conversations.set(id, next);
        this.changes.fire({ type: 'updated', conversation: toConversationSummary(next) });
    }
    delete(id: string): boolean {
        const existed = this.conversations.delete(id);
        this.deletedIds.push(id);
        this.changes.fire({ type: 'deleted', conversationId: id } as QaapAgentConversationEvent);
        return existed;
    }
    /** The parent's turn settled (e.g. the user cancelled it). */
    settleParent(id: string, outcome: 'success' | 'cancelled' | 'failed' | 'blocked' = 'success'): void {
        const conv = this.conversations.get(id)!;
        const user = [...conv.messages].reverse().find(message => message.role === 'user')!;
        this.conversations.set(id, { ...conv, status: 'idle' });
        this.settles.fire({ conversationId: id, userMessageId: user.id, outcome, task: undefined } as unknown as QaapGoalLoopTurnSettlement);
    }
    rename(id: string, request: { title: string }): QaapAgentConversation | undefined {
        const conv = this.conversations.get(id);
        if (conv) {
            this.conversations.set(id, { ...conv, title: request.title });
        }
        return this.conversations.get(id);
    }
    postUserMessage(id: string, content: string, agentOverride?: string, _m?: unknown, _auto?: unknown, interactionModeId?: string,
        _p?: unknown, _r?: unknown, _l?: unknown, internal?: PostUserMessageInternalOptions): QaapAgentConversation {
        // Mirrors the real store: model-written text is stored with its mentions neutralized.
        content = internal?.noMentionRouting ? neutralizeQaapAgentMentions(content) : content;
        this.posted.push({ id, content, ...(interactionModeId ? { interactionModeId } : {}), ...(agentOverride ? { agentOverride } : {}), ...(internal ? { internal } : {}) });
        const conv = this.conversations.get(id)!;
        const next: QaapAgentConversation = {
            ...conv,
            status: 'streaming',
            messages: [...conv.messages, {
                id: `${id}-u${conv.messages.length}`, role: 'user', content, createdAt: 1,
                ...(internal?.autoContinueRootMessageId ? { autoContinueRootMessageId: internal.autoContinueRootMessageId } : {}),
            }],
        };
        this.conversations.set(id, next);
        this.changes.fire({ type: 'updated', conversation: toConversationSummary(next) });
        return next;
    }
    cancel(id: string): QaapAgentConversation | undefined {
        this.cancelled.push(id);
        return this.conversations.get(id);
    }
    /** The child's turn finished with `taskState` and `reply` as its final message. */
    settle(id: string, taskState: FakeTaskState = 'completed', reply = 'done'): void {
        const conv = this.conversations.get(id)!;
        const user = [...conv.messages].reverse().find(message => message.role === 'user')!;
        const settledAt = 2;
        const next: QaapAgentConversation = {
            ...conv,
            status: 'idle',
            messages: [
                ...conv.messages.map(message => message.id === user.id ? { ...message, turnVerdict: { taskState, settledAt } } : message),
                { id: `${user.id}-a`, role: 'agent', content: reply, createdAt: settledAt },
            ],
        };
        this.conversations.set(id, next);
        const outcome = taskState === 'completed' ? 'success' : taskState;
        this.settles.fire({ conversationId: id, userMessageId: user.id, outcome, task: undefined } as unknown as QaapGoalLoopTurnSettlement);
        this.changes.fire({ type: 'updated', conversation: toConversationSummary(next) });
    }
}

/** Turns `QAAP_AGENT_DELEGATION` on for the enclosing suite (the service's listeners are no-ops while it is off). */
export function useDelegationFlag(): void {
    let saved: string | undefined;
    beforeEach(() => {
        saved = process.env.QAAP_AGENT_DELEGATION;
        process.env.QAAP_AGENT_DELEGATION = '1';
    });
    afterEach(() => {
        if (saved === undefined) {
            delete process.env.QAAP_AGENT_DELEGATION;
        } else {
            process.env.QAAP_AGENT_DELEGATION = saved;
        }
    });
}

export function makeService(store: FakeStore): { service: QaapAgentDelegationService; worktreeCalls: () => number } {
    const service = new QaapAgentDelegationService();
    let calls = 0;
    Object.assign(service, {
        store,
        worktrees: {
            create: async () => {
                calls++;
                return { worktreePath: `/wt/${calls}`, branch: `qaap/worktree/t${calls}` };
            },
        },
    });
    // The store subscriptions normally happen in postConstruct.
    (service as unknown as { init(): void }).init();
    return { service, worktreeCalls: () => calls };
}

export function parentConversation(overrides: Partial<QaapAgentConversation> = {}): QaapAgentConversation {
    return {
        id: 'parent',
        cwd: '/repo',
        agentId: 'claude',
        title: 'Parent',
        status: 'streaming',
        createdAt: 0,
        updatedAt: 0,
        messages: [{ id: 'turn-1', role: 'user', content: 'split this', createdAt: 0 }],
        ownerLogin: 'alice',
        autoApprove: false,
        approvalPolicyId: 'policy-1',
        ...overrides,
    };
}

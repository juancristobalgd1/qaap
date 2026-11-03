// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapProjectChatSessionCreated } from '@theia/qaap-transcript/lib/browser/qaap-transcript-host-contracts';
import { MessageService } from '@theia/core/lib/common/message-service';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { GenericCapabilitySelections } from '@theia/ai-core';
import {
    conversationToSummary,
    createConversation,
    deleteConversation,
    getConversation,
    updateConversation,
    startGoalLoop,
    type QaapAgentConversationDTO,
    type QaapAgentConversationIsolation,
    type QaapAgentConversationSummaryDTO,
    cancelConversation,
    QaapDirtyWorkspaceError,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { beginNewTaskStartup, conversationHasAgentOutput, endNewTaskStartup, QaapNewTaskStartup, resolveNewTaskStartupOutcome } from '../common/qaap-new-task-startup';
import type { QaapTranscriptUserImagePreview } from '@theia/qaap-shared-core/lib/common/qaap-transcript-user-image-preview';
import { messageRequestsDevPreview } from '@theia/qaap-shared-core/lib/common/qaap-transcript-preview-offer';
import {
    fetchAgentTaskListAll,
    mergeAgentTaskAgentOptions,
    normalizeBackendAgentId,
    readStoredAgent,
    resolveAgentModelForSubmit,
    resolveBackendAgentForTurn,
    writeStoredAgent,
    QAIQ_AGENT_ID,
    SHELL_AGENT_ID,
    type QaapAgentTaskListSnapshot,
    type QaapCreateAgentTaskQaiqModel,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import { localizeMissingCodingAgentMessage, localizeMissingQaiqMessage } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { shouldRouteSubmitToTheiaCoder } from '@theia/qaap-shared-core/lib/common/qaap-agent-submit-routing';
import { reportQaapClientError } from '@theia/qaap-shared-core/lib/common/qaap-client-error-report';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { applyBackendInteractionModeToPrompt } from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-mode';
import { QaapDirtyWorkspaceDialog, type QaapDirtyWorkspaceChoice } from './mobile-projects-workspace-dirty-dialog';
import { reconcileAgentApprovalPolicyId, type QaapAgentApprovalPolicyId } from '@theia/qaap-shared-core/lib/common/qaap-sticky-composer-approval-policy';
import { reconcileAgentToolApprovalRules } from '@theia/qaap-shared-core/lib/common/qaap-agent-tool-approval-rules';
import { getQaapDefaultAgentId } from '@theia/qaap-shared-core/lib/common/qaap-default-agent-id';
import { confirmPaidModelSend, resolveSendAgentModel, warnChooseSendModel } from '@theia/qaap-composer/lib/browser/qaap-paid-model-send-confirm';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import type { MobileProjectsConversations } from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversations';
import type { MobileProjectsActiveTasks } from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import type { QaapBackgroundContextProvider } from '@theia/qaap-shared-core/lib/browser/qaap-background-context-provider';
import type { MobileWorkHubSessionsSidebar } from './mobile-work-hub-sessions-sidebar';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';

export interface MobileProjectsBackgroundTaskHost {
    projects: MobileProjectEntry[];
    preparedCwdByProjectId: Map<string, string>;
    justAddedTaskId: string | undefined;
    agentsHubShellActive: boolean;
    projectsService: MobileProjectsService;
    conversations?: MobileProjectsConversations;
    backgroundContext?: QaapBackgroundContextProvider;
    messageService?: MessageService;
    activeTasks?: MobileProjectsActiveTasks;
    sessionsSidebar?: MobileWorkHubSessionsSidebar;
    delegate: { onProjectsChanged?: () => void };
    projectBootstrap?: import('@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-service').QaapProjectBootstrapService;
    transcriptSheetUi: import('./mobile-projects-transcript-sheet-ui').MobileProjectsTranscriptSheetUi;
    transcriptLiveUi: import('@theia/qaap-transcript/lib/browser/mobile-projects-transcript-live-ui').MobileProjectsTranscriptLiveUi;
    expandComposerDraftForSubmit?: (draft: string) => Promise<string>;
    applyComposerAttachmentsToDraft?: (
        draft: string,
        variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>,
    ) => Promise<string>;
    shouldUseAgentsHubLanding(): boolean;
    renderSubtitle(): void;
    renderList(): void;
    seedTranscriptOptimisticSubmit(
        summary: QaapAgentConversationSummaryDTO,
        outbound: string,
        agentId?: string,
        imagePreviews?: readonly QaapTranscriptUserImagePreview[],
    ): void;
    /** Roll back the pre-create idle optimistic paint when the create is rejected (e.g. 400 needs-project). */
    rollbackTranscriptOptimisticSubmit?(): void;
    syncWorkHubProjectSkillRoots(): void;
}

export class MobileProjectsBackgroundTaskUi {
    protected readonly backgroundSubmitInFlightByProjectId = new Set<string>();

    constructor(protected readonly host: MobileProjectsBackgroundTaskHost) { }

    /**
     * Bound a pre-create submit stage. Every await between the composer submit and the
     * `createConversation` POST is a client-side fetch/resolver with NO timeout of its own —
     * one hung stage froze the whole submit BEFORE any request reached the backend (observed
     * live: optimistic paint stuck, zero server activity, watchdog "didn't respond in time",
     * dead buttons). A bounded stage rejects instead, which the submit catch turns into a
     * visible error + optimistic rollback. The in-flight guard's `finally` also depends on the
     * inner promise settling, so an unbounded hang silently swallowed every later submit too.
     */
    protected async boundedSubmitStage<T>(
        work: Promise<T> | T,
        ms: number,
        stage: string,
        onTimeout?: () => void,
    ): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([
                Promise.resolve(work),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(
                        () => {
                            // Abort the underlying request (if any) so a timed-out create does not keep
                            // running on a connection the UI has already abandoned.
                            onTimeout?.();
                            reject(new Error(`Timed out after ${Math.round(ms / 1000)}s while ${stage}.`));
                        },
                        ms,
                    );
                }),
            ]);
        } finally {
            if (timer !== undefined) {
                clearTimeout(timer);
            }
        }
    }

    /** A unique idempotency key for one create submit (see the create call site). Overridable in tests. */
    protected newClientRequestId(): string {
        const g = globalThis as { crypto?: { randomUUID?: () => string } };
        if (typeof g.crypto?.randomUUID === 'function') {
            return g.crypto.randomUUID();
        }
        return `qaap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    async ensureInlineComposerCwd(project: MobileProjectEntry): Promise<string | undefined> {
        // Reuse the open workspace path ONLY when the tapped project IS that workspace. Otherwise the
        // tapped project has its own per-user repository path — falling back to the workspace root
        // (`/workspace`) here sent a container cwd the server rejects (403/400), stalling the agent.
        const workspaceCwd = this.host.projectsService.getCurrentWorkspaceCwd();
        if (
            workspaceCwd
            // Never reuse the multi-repo container root (`/workspace`) as a task cwd: the server
            // rejects it (ownership_denied → 403) and the agent stalls with "didn't respond in time"
            // and no way to recover. When the open workspace IS the container, fall through to the
            // project's own per-user repository path. (getProjectCwd already filters the container,
            // but this earlier branch bypassed that guard.)
            && !isQaapWorkspaceContainerPath(workspaceCwd)
            && this.host.projectsService.projectMatchesCurrentWorkspace(project)
        ) {
            this.host.preparedCwdByProjectId.set(project.id, workspaceCwd);
            this.host.syncWorkHubProjectSkillRoots();
            return workspaceCwd;
        }
        let cwd = this.host.projectsService.getProjectCwd(project);
        if (!cwd) {
            // Hosted hub entries carry NO usable uri (`uri: isCurrent ? current : undefined`
            // resolves to the container workspace, which getProjectCwd rightly filters), so on
            // the VPS this was ALWAYS undefined and every submit fell through to the network
            // prepare — or failed instantly. The client already KNOWS the repo's real path:
            // reuse the prepared-cwd cache, then the project's own conversations (their cwd is
            // the canonical per-user repository path).
            const prepared = this.host.preparedCwdByProjectId.get(project.id);
            if (prepared && !isQaapWorkspaceContainerPath(prepared)) {
                cwd = prepared;
            }
        }
        if (!cwd) {
            cwd = this.host.conversations?.findConversationsForProject(project)
                .map(summary => summary.cwd)
                .find(known => !!known && !isQaapWorkspaceContainerPath(known));
        }
        if (!cwd && project.github) {
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/preparingRepo', 'Preparing {0}…', project.name),
                { kind: 'loading' }
            );
            try {
                // Bounded: a hung repositories/open fetch froze the submit forever with the
                // loading snackbar up and no request ever reaching the conversation endpoint.
                cwd = await this.boundedSubmitStage(
                    this.host.projectsService.prepareProjectCwd(project),
                    90_000,
                    'preparing the repository',
                );
            } finally {
                MobileSnackbar.dismiss();
            }
        }
        if (!cwd) {
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/runTaskNoCwd', 'Open or clone this project before running a background task.'),
                { duration: 2800 }
            );
            return undefined;
        }
        this.host.preparedCwdByProjectId.set(project.id, cwd);
        this.host.syncWorkHubProjectSkillRoots();
        return cwd;
    }
    /** Overridable seam over the paid-send confirmation (see qaap-paid-model-send-confirm.ts). */
    protected confirmPaidSend(cwd: string, model: QaapCreateAgentTaskQaiqModel | undefined): Promise<boolean> {
        return confirmPaidModelSend(cwd, model);
    }

    async submitBackgroundAgentTask(
        project: MobileProjectEntry,
        draft: string,
        options: {
            openConversation?: boolean;
            forceVps?: boolean;
            selectedAgentId?: string;
            /** Routing agent already chosen by submitBackgroundAgentTask (one decision per submit). */
            resolvedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            toolApprovalRules?: import('@theia/qaap-shared-core/lib/common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
            /** Omitted → the server's `'auto'`: a worktree only when another thread is active on the repository. */
            isolation?: QaapAgentConversationIsolation;
            /** The user chose "Continue here" on the dirty-workspace dialog: share the uncommitted tree. */
            acceptDirty?: boolean;
            agentModel?: QaapCreateAgentTaskQaiqModel;
            imagePreviews?: readonly QaapTranscriptUserImagePreview[];
            /** Create without a message, then start an "Until done" goal loop with the draft. */
            untilDone?: boolean;
        } = {},
    ): Promise<QaapAgentConversationSummaryDTO | undefined> {
        if (this.backgroundSubmitInFlightByProjectId.has(project.id)) {
            return undefined;
        }
        // Claim the project before any await: a second submit during the paid-send confirmation must
        // be ignored, not start a second creation that overwrites this one's startup record.
        this.backgroundSubmitInFlightByProjectId.add(project.id);
        const startup = beginNewTaskStartup(project.id);
        try {
            // A paid model asks once per project per browser session before a new task starts; cancelling
            // reports no created conversation, so the caller restores the draft.
            const projectCwd = this.host.projectsService.getProjectCwd(project);
            // One routing decision per submit: the agent that routes the turn is the agent the paid gate checks
            // and the agent the send carries. Without a prepared repo cwd it is resolved later, inside the send.
            let resolvedAgentId: string | undefined;
            if (projectCwd) {
                try {
                    resolvedAgentId = await this.routeSubmitAgent(projectCwd, draft, options.selectedAgentId);
                } catch (error) {
                    // Routing failed: abort rather than gate and send with different agents. The draft is restored by the caller.
                    const reason = error instanceof Error ? error.message : String(error);
                    MobileSnackbar.show(
                        nls.localize('qaap/mobileProjects/routingFailed', 'Could not choose an agent for this task: {0}', reason),
                        { kind: 'warning' },
                    );
                    return undefined;
                }
            }
            const modelResolution = await resolveSendAgentModel(
                resolvedAgentId ?? options.selectedAgentId ?? getQaapDefaultAgentId(),
                projectCwd,
                options.agentModel,
            );
            if (!modelResolution.ok) {
                // Fail closed: a picker agent with no chosen model is not sent on the CLI default.
                warnChooseSendModel(resolvedAgentId ?? options.selectedAgentId ?? getQaapDefaultAgentId());
                return undefined;
            }
            if (!await this.confirmPaidSend(projectCwd ?? project.id, modelResolution.model)) {
                return undefined;
            }
            return await this.submitBackgroundAgentTaskInner(project, draft, { ...options, resolvedAgentId }, startup);
        } finally {
            endNewTaskStartup(startup);
            this.backgroundSubmitInFlightByProjectId.delete(project.id);
        }
    }

    /** Routing agent for a submit, bounded. Rejects when routing fails; the caller aborts the submit. */
    protected routeSubmitAgent(cwd: string, draft: string, selectedAgentId: string | undefined): Promise<string> {
        return this.boundedSubmitStage(
            this.selectBackendConversationAgent(cwd, draft, selectedAgentId),
            20_000,
            'selecting the agent',
        );
    }

    protected async submitBackgroundAgentTaskInner(
        project: MobileProjectEntry,
        draft: string,
        options: {
            openConversation?: boolean;
            forceVps?: boolean;
            selectedAgentId?: string;
            /** Routing agent already chosen by submitBackgroundAgentTask (one decision per submit). */
            resolvedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            toolApprovalRules?: import('@theia/qaap-shared-core/lib/common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
            /** Omitted → the server's `'auto'`: a worktree only when another thread is active on the repository. */
            isolation?: QaapAgentConversationIsolation;
            /** The user chose "Continue here" on the dirty-workspace dialog: share the uncommitted tree. */
            acceptDirty?: boolean;
            agentModel?: QaapCreateAgentTaskQaiqModel;
            imagePreviews?: readonly QaapTranscriptUserImagePreview[];
            /** Create without a message, then start an "Until done" goal loop with the draft. */
            untilDone?: boolean;
        } = {},
        startup: QaapNewTaskStartup,
    ): Promise<QaapAgentConversationSummaryDTO | undefined> {
        try {
            const cwd = await this.ensureInlineComposerCwd(project);
            if (!cwd) {
                // No usable repository path (snackbar already explained why). Roll the
                // optimistic paint back or it lingers as a phantom "streaming" conversation.
                this.host.rollbackTranscriptOptimisticSubmit?.();
                return undefined;
            }
            const created = await this.createWithDirtyWorkspaceDecision(project, cwd, draft, options);
            if (!created) {
                // Cancelled on the dirty-workspace dialog: nothing was created, the caller restores the draft.
                return undefined;
            }
            const { summary, outbound } = created;
            if (resolveNewTaskStartupOutcome(startup, summary) === 'cancelAndRestore') {
                // Stop arrived while the task was being created. The create already carries the first
                // message, so the turn may be running: cancel it, then decide from what it produced.
                return this.cancelStoppedNewTask(project, summary);
            }
            this.host.seedTranscriptOptimisticSubmit(summary, outbound, options.selectedAgentId, options.imagePreviews);
            const wantsDevPreview = messageRequestsDevPreview(draft);
            if (wantsDevPreview || (options.openConversation ?? true)) {
                await this.host.transcriptSheetUi.openTranscriptSheet(project, summary);
            }
            if (wantsDevPreview) {
                const full: QaapAgentConversationDTO = await getConversation(summary.id);
                this.host.transcriptLiveUi.onTranscriptUserMessageSubmitted(draft, full);
                this.host.transcriptLiveUi.ensureTranscriptConversationRefresh();
                void this.host.projectBootstrap?.refreshFromCurrentWorkspace();
            }
            this.applyTaskStartedToProject(cwd, draft, summary.id);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/taskStarted', 'Task started'),
                { kind: 'success', duration: 1400 }
            );
            return summary;
        } catch (error) {
            // The composer painted an optimistic "streaming" conversation BEFORE this create.
            // Roll it back, or the rejected submit lingers as a phantom stream until the
            // watchdog shows "didn't respond in time" with nothing to cancel or retry.
            this.host.rollbackTranscriptOptimisticSubmit?.();
            reportQaapClientError('background-task-submit', error);
            const detail = error instanceof Error ? error.message : String(error);
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/taskStartFailed',
                'Could not start task: {0}',
                detail
            ));
            return undefined;
        }
    }
    /**
     * Creates the task; when the shared working tree has uncommitted changes the server answers 409
     * `dirty_workspace` and the user decides: "Start clean" retries in a worktree, "Continue here" retries
     * sharing the tree, Cancel resolves `undefined` so the caller restores the draft as not sent.
     */
    protected async createWithDirtyWorkspaceDecision(
        project: MobileProjectEntry,
        cwd: string,
        draft: string,
        options: Parameters<MobileProjectsBackgroundTaskUi['createProjectChatSession']>[3],
    ): Promise<QaapProjectChatSessionCreated | undefined> {
        try {
            return await this.createProjectChatSession(project, cwd, draft, options);
        } catch (error) {
            if (!(error instanceof QaapDirtyWorkspaceError)) {
                throw error;
            }
            const choice = await this.askDirtyWorkspaceChoice(error.files, error.total);
            if (!choice) {
                return undefined;
            }
            const retryOptions = choice === 'startClean'
                ? { ...options, isolation: 'worktree' as const }
                : { ...options, acceptDirty: true };
            return this.createProjectChatSession(project, cwd, draft, retryOptions);
        }
    }

    /** Seam over the dirty-workspace dialog so the decision can be exercised without a DOM. */
    protected askDirtyWorkspaceChoice(files: readonly string[], total: number): Promise<QaapDirtyWorkspaceChoice | undefined> {
        return new QaapDirtyWorkspaceDialog(files, total).open();
    }

    /**
     * Resolves a new task whose creation was stopped. Returns the task when it stays open (the
     * prompt counts as sent: the composer commits it), or `undefined` when the task was archived
     * before any output (the composer restores the draft as not sent).
     */
    protected async cancelStoppedNewTask(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<QaapAgentConversationSummaryDTO | undefined> {
        try {
            await this.requestConversationCancel(summary.id);
        } catch (error) {
            // The stop did not reach the server, so the turn may still run: keep the task open and
            // do not restore the prompt, which may already be delivered.
            reportQaapClientError('new-task-stop', error);
            const detail = error instanceof Error ? error.message : String(error);
            this.host.messageService?.error(nls.localize('qaap/mobileProjects/cancelTaskFailed', 'Could not cancel run: {0}', detail));
            await this.host.transcriptSheetUi.openTranscriptSheet(project, summary);
            return summary;
        }
        let hasOutput = true;
        try {
            hasOutput = conversationHasAgentOutput(await this.loadConversation(summary.id));
        } catch (error) {
            // Unknown: keep the task rather than restoring a prompt that may have been delivered.
            reportQaapClientError('new-task-stop', error);
        }
        if (hasOutput) {
            // The turn produced output before the stop: it is a stopped task, not a discarded send.
            await this.host.transcriptSheetUi.openTranscriptSheet(project, summary);
            return summary;
        }
        try {
            await this.archiveConversation(summary.id);
        } catch (error) {
            reportQaapClientError('new-task-stop', error);
        }
        this.host.rollbackTranscriptOptimisticSubmit?.();
        this.host.messageService?.warn(nls.localize(
            'qaap/mobileProjects/stopBeforeTaskStartedRestored',
            'Stopped before the task started. Your draft was restored.',
        ));
        return undefined;
    }

    /** Seams over the conversation client so the stop outcome can be exercised without a backend. */
    protected requestConversationCancel(id: string): Promise<void> {
        return cancelConversation(id);
    }

    protected loadConversation(id: string): Promise<QaapAgentConversationDTO> {
        return getConversation(id);
    }

    protected async archiveConversation(id: string): Promise<void> {
        await updateConversation(id, { archived: true });
    }

    async createProjectChatSession(
        project: MobileProjectEntry,
        cwd: string,
        draft: string,
        options: {
            forceVps?: boolean;
            selectedAgentId?: string;
            /** Routing agent already chosen by submitBackgroundAgentTask (one decision per submit). */
            resolvedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            toolApprovalRules?: import('@theia/qaap-shared-core/lib/common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
            isolation?: QaapAgentConversationIsolation;
            acceptDirty?: boolean;
            agentModel?: QaapCreateAgentTaskQaiqModel;
            latencyMarks?: import('@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client').QaapPostConversationMessageOptions['latencyMarks'];
            untilDone?: boolean;
        },
    ): Promise<QaapProjectChatSessionCreated> {
        const agent = options.resolvedAgentId ?? await this.boundedSubmitStage(
            this.selectBackendConversationAgent(cwd, draft, options.selectedAgentId),
            20_000,
            'selecting the agent',
        );
        const outbound = await this.boundedSubmitStage(
            this.resolveOutboundMessage(draft, options),
            30_000,
            'expanding the draft',
        );
        const agentModel = resolveAgentModelForSubmit(agent, cwd, options.agentModel);
        const approvalPolicyId = (options.approvalPolicyId
            ?? reconcileAgentApprovalPolicyId(undefined, cwd)) as QaapAgentApprovalPolicyId;
        const toolApprovalRules = options.toolApprovalRules
            ?? reconcileAgentToolApprovalRules(approvalPolicyId, cwd, undefined);
        // Optional preamble: on a hung/failed prompt-variable resolution, degrade to none
        // rather than failing the submit.
        const contextPreamble = this.host.backgroundContext
            ? await this.boundedSubmitStage(
                this.host.backgroundContext.resolve({ text: draft, variables: options.variables }),
                15_000,
                'resolving the background context',
            ).catch(() => undefined)
            : undefined;
        // Idempotency key for this submit: if the create POST is slow enough that the 60s bound below
        // fires, the backend may still create the conversation. A retry carrying the SAME key returns
        // that conversation instead of spawning a duplicate. Reused for the whole submit intent.
        const clientRequestId = this.newClientRequestId();
        const createController = new AbortController();
        const conversation = await this.boundedSubmitStage(createConversation({
            cwd,
            clientRequestId,
            agent,
            title: draft,
            // "Until done": the goal loop posts the first turn itself (start requires an idle thread).
            ...(options.untilDone ? {} : { message: outbound }),
            interactionModeId: options.modeId,
            approvalPolicyId,
            toolApprovalRules,
            latencyMarks: options.latencyMarks,
            ...(options.isolation ? { isolation: options.isolation } : {}),
            ...(options.acceptDirty ? { acceptDirty: true } : {}),
            ...(contextPreamble ? { contextPreamble } : {}),
            ...(agentModel ? { agentModel, qaiqModel: agentModel } : {}),
            ...(options.autoApprove === false
                ? { autoApprove: false }
                : options.autoApprove === true
                    ? { autoApprove: true }
                    : {}),
        }, createController.signal), 60_000, 'creating the conversation', () => createController.abort());
        if (conversation.worktreeBranch && options.isolation !== 'worktree') {
            // The server isolated the thread because another one is active on this repository.
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/autoWorktree',
                    'Running in an isolated worktree so agents do not conflict.',
                ),
                { duration: 2200 },
            );
        }
        if (options.untilDone) {
            const started = await this.startGoalLoopOnCreatedConversation(conversation.id, draft, outbound);
            const startedSummary = conversationToSummary(started);
            this.host.conversations?.recordSnapshot(startedSummary);
            return { summary: startedSummary, outbound };
        }
        const summary = conversationToSummary(conversation);
        this.host.conversations?.recordSnapshot(summary);
        return { summary, outbound };
    }

    /**
     * Starts the goal loop on a conversation created without a message. On a rejected start the
     * empty conversation is removed again and the backend's reason is rethrown for the toast.
     */
    protected async startGoalLoopOnCreatedConversation(
        conversationId: string,
        draft: string,
        outbound: string,
    ): Promise<QaapAgentConversationDTO> {
        try {
            await this.boundedSubmitStage(
                startGoalLoop(conversationId, { goal: draft.trim() || outbound, initialPrompt: outbound }),
                30_000,
                'starting the goal loop',
            );
        } catch (error) {
            void deleteConversation(conversationId).catch(() => undefined);
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(nls.localize('theia/qaap/goalLoop/startFailed', 'Could not start Goal: {0}', detail));
        }
        return getConversation(conversationId);
    }

    protected async resolveOutboundMessage(
        draft: string,
        options: {
            modeId?: string;
            variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
        },
    ): Promise<string> {
        const expandedDraft = await this.host.expandComposerDraftForSubmit?.(draft) ?? draft;
        const withAttachments = await this.host.applyComposerAttachmentsToDraft?.(
            expandedDraft,
            options.variables,
        ) ?? expandedDraft;
        return applyBackendInteractionModeToPrompt(withAttachments, options.modeId);
    }
    shouldUseTheiaCoder(content: string, selectedAgentId?: string, options: { forceVps?: boolean; isLegacyTheiaChat?: boolean } = {}): boolean {
        return shouldRouteSubmitToTheiaCoder({
            draft: content,
            selectedAgentId,
            forceVps: options.forceVps,
            isLegacyTheiaChat: options.isLegacyTheiaChat,
        });
    }
    async loadBackendAgentSnapshot(options?: { readonly forceRefresh?: boolean }): Promise<QaapAgentTaskListSnapshot> {
        this.host.activeTasks?.start();
        try {
            const snapshot = await fetchAgentTaskListAll(options);
            const agents = mergeAgentTaskAgentOptions(snapshot.agents, this.host.activeTasks?.getAgents() ?? []);
            return {
                ...snapshot,
                agents,
                agentConfigured: snapshot.agentConfigured || (this.host.activeTasks?.isAgentConfigured() ?? false),
            };
        } catch {
            const liveAgents = this.host.activeTasks?.getAgents() ?? [];
            return {
                agents: mergeAgentTaskAgentOptions(liveAgents),
                defaultAgent: this.host.activeTasks?.getDefaultAgent(),
                agentConfigured: this.host.activeTasks?.isAgentConfigured() ?? false,
                // If the backend snapshot itself is unavailable, leave the final decision to the
                // backend conversation preflight instead of misreporting a missing executable.
                qaiqInstalled: this.host.activeTasks
                    ? this.host.activeTasks.getAgents().some(agent => agent.id === QAIQ_AGENT_ID)
                    : true,
                qaiqModels: [],
            };
        }
    }
    async selectBackendConversationAgent(
        cwd: string,
        prompt: string,
        selectedAgentId?: string,
        conversationAgentId?: string,
    ): Promise<string> {
        // Shell is a local builtin and does not depend on the VPS agent catalog. In hosted mode
        // the catalog request can be delayed while the tenant backend is warming; waiting for it
        // here made an explicit @shell submit roll back after 20s even though the command runner
        // was already available. Honour the user's explicit builtin selection immediately.
        const explicitAgent = selectedAgentId?.trim().replace(/^@/, '').toLowerCase();
        if (explicitAgent === SHELL_AGENT_ID) {
            writeStoredAgent(cwd, SHELL_AGENT_ID);
            return SHELL_AGENT_ID;
        }
        // A picker selection is already an explicit user choice. Do not re-fetch the VPS
        // catalog before every submit: the catalog can still be warming even though the
        // selected harness is installed and runnable. The backend remains the authority for
        // whether the executable is usable when the conversation is created.
        const normalizedExplicitAgent = normalizeBackendAgentId(explicitAgent);
        if (normalizedExplicitAgent) {
            writeStoredAgent(cwd, normalizedExplicitAgent);
            return normalizedExplicitAgent;
        }
        const snapshot = await this.loadBackendAgentSnapshot();
        const resolved = resolveBackendAgentForTurn(prompt, snapshot.agents, {
            explicitAgentId: selectedAgentId,
            storedAgentId: readStoredAgent(cwd),
            defaultAgentId: snapshot.defaultAgent,
            conversationAgentId,
        });
        if (!resolved) {
            throw new Error(localizeMissingCodingAgentMessage());
        }
        if (snapshot.qaiqInstalled === false && resolved === QAIQ_AGENT_ID) {
            // QAIQ is required only for QAIQ turns. Local Codex/Coder selections can run
            // without the QAIQ executable, while an explicit/default QAIQ turn still fails
            // before creating a turn that could sit in Planning waiting for an executable.
            throw new Error(localizeMissingQaiqMessage());
        }
        writeStoredAgent(cwd, resolved);
        return resolved;
    }
    applyTaskStartedToProject(cwd: string, title: string, taskId: string): void {
        this.host.projects = this.host.projects.map(project => {
            const projectCwd = this.host.preparedCwdByProjectId.get(project.id)
                ?? this.host.projectsService.getProjectCwd(project);
            if (projectCwd !== cwd && !this.host.activeTasks?.findTasksForProject(project).some(task => task.id === taskId)) {
                return project;
            }
            this.host.preparedCwdByProjectId.set(project.id, cwd);
            return {
                ...project,
                status: 'working' as const,
                task: title,
                lastActive: nls.localize('qaap/mobileProjects/lastActiveNow', 'now'),
                progress: Math.max(project.progress, 0.04),
            };
        });
        this.host.justAddedTaskId = taskId;
        const preserveAgentsShell = this.host.agentsHubShellActive && this.host.shouldUseAgentsHubLanding();
        if (preserveAgentsShell) {
            this.host.renderSubtitle();
            this.host.delegate.onProjectsChanged?.();
            this.host.sessionsSidebar?.refreshList();
        } else {
            this.host.renderList();
            this.host.renderSubtitle();
            this.host.delegate.onProjectsChanged?.();
        }
        window.setTimeout(() => {
            if (this.host.justAddedTaskId === taskId) {
                this.host.justAddedTaskId = undefined;
                if (preserveAgentsShell) {
                    this.host.sessionsSidebar?.refreshList();
                } else if (typeof document !== 'undefined') {
                    // The 1400ms delay only exists to drop the one-shot "just added" flash from the
                    // new row (the `theia-mobile-projects-flash-in 1.4s` animation just ended). Strip
                    // that class in place instead of rebuilding the entire hub list — SSE/detail ticks
                    // already keep the list current through the incremental patcher.
                    document.querySelectorAll('.theia-mobile-projects-task-item.theia-mod-flash')
                        .forEach(el => el.classList.remove('theia-mod-flash'));
                }
            }
        }, 1400);
    }
}

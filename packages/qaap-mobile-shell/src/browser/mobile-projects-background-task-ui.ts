// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { AIChatInputWidget } from '@theia/ai-chat-ui/lib/browser/chat-input-widget';
import { GenericCapabilitySelections } from '@theia/ai-core';
import {
    conversationToSummary,
    createConversation,
    getConversation,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import type { QaapTranscriptUserImagePreview } from '../common/qaap-transcript-user-image-preview';
import { messageRequestsDevPreview } from '../common/qaap-transcript-preview-offer';
import {
    fetchAgentTaskListAll,
    mergeAgentTaskAgentOptions,
    readStoredAgent,
    resolveAgentModelForSubmit,
    resolveBackendAgentForTurn,
    writeStoredAgent,
    type QaapAgentTaskListSnapshot,
    type QaapCreateAgentTaskQaiqModel,
} from '../common/qaap-agent-task-client';
import { localizeMissingCodingAgentMessage } from '../common/qaap-agent-failure-message';
import { shouldRouteSubmitToTheiaCoder } from '../common/qaap-agent-submit-routing';
import { reportQaapClientError } from '../common/qaap-client-error-report';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { applyBackendInteractionModeToPrompt } from '../common/qaap-sticky-composer-mode';
import { reconcileAgentApprovalPolicyId, type QaapAgentApprovalPolicyId } from '../common/qaap-sticky-composer-approval-policy';
import { reconcileAgentToolApprovalRules } from '../common/qaap-agent-tool-approval-rules';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import type { QaapBackgroundContextProvider } from './qaap-background-context-provider';
import type { MobileWorkHubSessionsSidebar } from './mobile-work-hub-sessions-sidebar';
import { MobileSnackbar } from './mobile-snackbar';

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
    projectBootstrap?: import('./qaap-project-bootstrap-service').QaapProjectBootstrapService;
    transcriptSheetUi: import('./mobile-projects-transcript-sheet-ui').MobileProjectsTranscriptSheetUi;
    transcriptLiveUi: import('./mobile-projects-transcript-live-ui').MobileProjectsTranscriptLiveUi;
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

export interface QaapProjectChatSessionCreated {
    readonly summary: QaapAgentConversationSummaryDTO;
    readonly outbound: string;
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
    async submitBackgroundAgentTask(
        project: MobileProjectEntry,
        draft: string,
        options: {
            openConversation?: boolean;
            forceVps?: boolean;
            selectedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
            /** Run the task in a fresh isolated git worktree instead of the project's working tree. */
            worktree?: boolean;
            agentModel?: QaapCreateAgentTaskQaiqModel;
            imagePreviews?: readonly QaapTranscriptUserImagePreview[];
        } = {},
    ): Promise<QaapAgentConversationSummaryDTO | undefined> {
        if (this.backgroundSubmitInFlightByProjectId.has(project.id)) {
            return undefined;
        }
        this.backgroundSubmitInFlightByProjectId.add(project.id);
        try {
            return await this.submitBackgroundAgentTaskInner(project, draft, options);
        } finally {
            this.backgroundSubmitInFlightByProjectId.delete(project.id);
        }
    }

    protected async submitBackgroundAgentTaskInner(
        project: MobileProjectEntry,
        draft: string,
        options: {
            openConversation?: boolean;
            forceVps?: boolean;
            selectedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
            /** Run the task in a fresh isolated git worktree instead of the project's working tree. */
            worktree?: boolean;
            agentModel?: QaapCreateAgentTaskQaiqModel;
            imagePreviews?: readonly QaapTranscriptUserImagePreview[];
        } = {},
    ): Promise<QaapAgentConversationSummaryDTO | undefined> {
        try {
            const cwd = await this.ensureInlineComposerCwd(project);
            if (!cwd) {
                // No usable repository path (snackbar already explained why). Roll the
                // optimistic paint back or it lingers as a phantom "streaming" conversation.
                this.host.rollbackTranscriptOptimisticSubmit?.();
                return undefined;
            }
            const { summary, outbound } = await this.createProjectChatSession(project, cwd, draft, options);
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
    async createProjectChatSession(
        project: MobileProjectEntry,
        cwd: string,
        draft: string,
        options: {
            forceVps?: boolean;
            selectedAgentId?: string;
            modeId?: string;
            autoApprove?: boolean;
            approvalPolicyId?: string;
            toolApprovalRules?: import('../common/qaap-agent-tool-approval-rules').QaapAgentToolApprovalRules;
            capabilityOverrides?: Record<string, boolean>;
            genericCapabilitySelections?: GenericCapabilitySelections;
            variables?: ReturnType<AIChatInputWidget['getAllVariablesForRequest']>;
            worktree?: boolean;
            agentModel?: QaapCreateAgentTaskQaiqModel;
            latencyMarks?: import('../common/qaap-agent-conversation-client').QaapPostConversationMessageOptions['latencyMarks'];
        },
    ): Promise<QaapProjectChatSessionCreated> {
        const useWorktree = this.resolveWorktreeForSession(cwd, options.worktree);
        if (useWorktree && options.worktree !== true) {
            MobileSnackbar.show(
                nls.localize(
                    'qaap/mobileProjects/autoWorktree',
                    'Running in an isolated worktree so agents do not conflict.',
                ),
                { duration: 2200 },
            );
        }
        const agent = await this.boundedSubmitStage(
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
            message: outbound,
            interactionModeId: options.modeId,
            approvalPolicyId,
            toolApprovalRules,
            latencyMarks: options.latencyMarks,
            ...(useWorktree ? { worktree: true } : {}),
            ...(contextPreamble ? { contextPreamble } : {}),
            ...(agentModel ? { agentModel, qaiqModel: agentModel } : {}),
            ...(options.autoApprove === false
                ? { autoApprove: false }
                : options.autoApprove === true
                    ? { autoApprove: true }
                    : {}),
        }, createController.signal), 60_000, 'creating the conversation', () => createController.abort());
        const summary = conversationToSummary(conversation);
        this.host.conversations?.recordSnapshot(summary);
        return { summary, outbound };
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
    /**
     * When another agent is already streaming in the same repo, default to an isolated worktree
     * so parallel agents do not stomp the same working tree.
     */
    resolveWorktreeForSession(cwd: string, explicitWorktree?: boolean): boolean {
        if (explicitWorktree === true || explicitWorktree === false) {
            return explicitWorktree;
        }
        if ((this.host.conversations?.getStreamingCountForCwd(cwd) ?? 0) > 0) {
            return true;
        }
        // A QUEUED task (per-user concurrency cap) is not streaming yet but WILL write to this
        // tree the moment a slot frees up — treat it as a collision too, or two submits in quick
        // succession share the same working tree. (Paused-on-approval turns keep their process
        // alive and stay 'streaming', so they are already covered above.)
        return (this.host.activeTasks?.getTasksForCwd(cwd) ?? [])
            .some(task => task.state === 'running' || task.state === 'queued');
    }
    shouldUseTheiaCoder(content: string, selectedAgentId?: string, options: { forceVps?: boolean; isLegacyTheiaChat?: boolean } = {}): boolean {
        return shouldRouteSubmitToTheiaCoder({
            draft: content,
            selectedAgentId,
            forceVps: options.forceVps,
            isLegacyTheiaChat: options.isLegacyTheiaChat,
        });
    }
    async loadBackendAgentSnapshot(): Promise<QaapAgentTaskListSnapshot> {
        this.host.activeTasks?.start();
        try {
            const snapshot = await fetchAgentTaskListAll();
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

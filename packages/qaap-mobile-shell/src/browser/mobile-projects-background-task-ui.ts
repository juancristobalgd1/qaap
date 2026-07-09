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
    QAAP_COMPOSER_DEFAULT_AGENT_ID,
    readStoredAgent,
    resolveAgentModelForSubmit,
    resolveBackendAgentForTurn,
    writeStoredAgent,
    type QaapAgentTaskListSnapshot,
    type QaapCreateAgentTaskQaiqModel,
} from '../common/qaap-agent-task-client';
import { shouldRouteSubmitToTheiaCoder } from '../common/qaap-agent-submit-routing';
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
}

export interface QaapProjectChatSessionCreated {
    readonly summary: QaapAgentConversationSummaryDTO;
    readonly outbound: string;
}

export class MobileProjectsBackgroundTaskUi {
    protected readonly backgroundSubmitInFlightByProjectId = new Set<string>();

    constructor(protected readonly host: MobileProjectsBackgroundTaskHost) { }

    async ensureInlineComposerCwd(project: MobileProjectEntry): Promise<string | undefined> {
        // Reuse the open workspace path ONLY when the tapped project IS that workspace. Otherwise the
        // tapped project has its own per-user repository path — falling back to the workspace root
        // (`/workspace`) here sent a container cwd the server rejects (403/400), stalling the agent.
        const workspaceCwd = this.host.projectsService.getCurrentWorkspaceCwd();
        if (workspaceCwd && this.host.projectsService.projectMatchesCurrentWorkspace(project)) {
            this.host.preparedCwdByProjectId.set(project.id, workspaceCwd);
            return workspaceCwd;
        }
        let cwd = this.host.projectsService.getProjectCwd(project);
        if (!cwd && project.github) {
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/preparingRepo', 'Preparing {0}…', project.name),
                { kind: 'loading' }
            );
            cwd = await this.host.projectsService.prepareProjectCwd(project);
            MobileSnackbar.dismiss();
        }
        if (!cwd) {
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/runTaskNoCwd', 'Open or clone this project before running a background task.'),
                { duration: 2800 }
            );
            return undefined;
        }
        this.host.preparedCwdByProjectId.set(project.id, cwd);
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
    ): Promise<void> {
        if (this.backgroundSubmitInFlightByProjectId.has(project.id)) {
            return;
        }
        this.backgroundSubmitInFlightByProjectId.add(project.id);
        try {
            await this.submitBackgroundAgentTaskInner(project, draft, options);
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
    ): Promise<void> {
        const cwd = await this.ensureInlineComposerCwd(project);
        if (!cwd) {
            return;
        }
        try {
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
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.host.messageService?.error(nls.localize(
                'qaap/mobileProjects/taskStartFailed',
                'Could not start task: {0}',
                detail
            ));
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
        const agent = await this.selectBackendConversationAgent(cwd, draft, options.selectedAgentId ?? QAAP_COMPOSER_DEFAULT_AGENT_ID);
        const outbound = await this.resolveOutboundMessage(draft, options);
        const agentModel = resolveAgentModelForSubmit(agent, cwd, options.agentModel);
        const approvalPolicyId = (options.approvalPolicyId
            ?? reconcileAgentApprovalPolicyId(undefined, cwd)) as QaapAgentApprovalPolicyId;
        const toolApprovalRules = options.toolApprovalRules
            ?? reconcileAgentToolApprovalRules(approvalPolicyId, cwd, undefined);
        const contextPreamble = await this.host.backgroundContext?.resolve({
            text: draft,
            variables: options.variables,
        });
        const conversation = await createConversation({
            cwd,
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
        });
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
        return (this.host.conversations?.getStreamingCountForCwd(cwd) ?? 0) > 0;
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
                } else {
                    this.host.renderList();
                }
            }
        }, 1400);
    }
}

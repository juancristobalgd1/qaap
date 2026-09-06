// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import URI from '@theia/core/lib/common/uri';
import { ChatAgentService } from '@theia/ai-chat/lib/common/chat-agent-service';
import { ChatModel, ChatService } from '@theia/ai-chat';
import {
    THEIA_CODER_AGENT_ID,
    agentUsesSettingsModelCatalog,
    readStoredAgentModel,
    resolveExplicitAgentForSubmit,
} from '../common/qaap-agent-task-client';
import {
    QAAP_AI_FEATURES_SETTINGS_QUERY,
    agentNeedsSettingsApiKeyPath,
    localizeAddApiKeyInSettingsCta,
} from '../common/qaap-agent-auth-login';
import { hasAnyConfiguredByokCredential } from '../common/qaap-qaiq-byok-provider-registry';
import {
    describeComposerInteractionMode,
    reconcileComposerModeId,
    resolveComposerModeLabel,
    resolveStickyComposerModes,
} from '../common/qaap-sticky-composer-mode';
import {
    agentSupportsApprovalPolicy,
    reconcileAgentApprovalPolicyId,
    resolveComposerAutoApprove,
} from '../common/qaap-sticky-composer-approval-policy';
import {
    reconcileAgentToolApprovalRules,
} from '../common/qaap-agent-tool-approval-rules';
import {
    composerContextRequests,
    disposeComposerContextEntries,
    revokeComposerContextPreview,
} from '../common/qaap-composer-context-entry';
import {
    bindContextUsageIndicator,
    isContextUsageIndicatorEnabled,
    resolveContextUsageIndicatorState,
    resolveContextUsageWarningThreshold,
    resolveContextUsageWarningThresholdPercentage,
    resolveVpsContextUsageIndicatorState,
} from './qaap-chat-context-usage-indicator';
import {
    resolveChatModelContextUsageBreakdown,
    resolveVpsContextUsageBreakdown,
} from './qaap-chat-context-usage-panel';
import type { QaapAgentConversationSummaryDTO, QaapAgentConversationDTO } from '../common/qaap-agent-conversation-client';
import type { QaapAgentApprovalPolicyId } from '../common/qaap-sticky-composer-approval-policy';
import type { QaapAgentToolApprovalRules } from '../common/qaap-agent-tool-approval-rules';
import type { StickyComposerContextEntry } from '../common/qaap-composer-context-entry';
import type { QaapComposerSurface } from '../common/qaap-composer-surface';
import type { MobileProjectEntry, MobileProjectFilter } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import { MobileSnackbar } from './mobile-snackbar';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';
import { createStickyComposerImprovePromptHandler } from './qaap-composer-prompt-improve-handler';
import type { QaapComposerPromptImprover } from './qaap-composer-prompt-improver';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import {
    executeStickyComposerSlashAction,
    openComposerMcpConfigurationSheet,
} from '../common/qaap-sticky-composer-slash-actions';
import type { StickyComposerSlashActionId } from '../common/qaap-sticky-composer-slash-menu';
import {
    installMcpMarketplacePlugin,
    readInstalledMcpServerSlugs,
    removeMcpServer,
} from '../common/qaap-mcp-plugin-install';
import { readProjectComposerDraft, writeProjectComposerDraft } from '../common/qaap-project-composer-draft';
import {
    reconcileModelCapabilityLevel,
} from '../common/qaap-sticky-composer-model-capability';
import type { ModelCapabilityLevelValue } from '../common/qaap-sticky-composer-model-capability';
import { parkWorkingControlFromAncestor } from './qaap-sticky-composer-working-agents-popover';

export interface MobileProjectsStickyComposerRenderHost {
    root: HTMLElement;
    stickyComposerHost: HTMLElement;
    stickyComposerContextUsageDispose: Disposable;
    stickyComposerContextUsageSheet: HTMLElement | undefined;
    projects: MobileProjectEntry[];
    filter: MobileProjectFilter;
    homeMode: boolean;
    hubView: import('./mobile-projects-types').MobileProjectsHubView;
    agentsHubShellActive: boolean;
    agentsHubInlineActive: boolean;
    agentsHubInlineChatHost: HTMLElement | undefined;
    agentsHubInlineExecutionRoot: HTMLElement | undefined;
    transcriptChatHost: HTMLElement | undefined;
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptComposerDraft: string;
    openAiConfigurationSheet?: (tabId?: string) => Promise<void>;
    openPreferencesSheet?: (query?: string) => Promise<void>;
    closeAgentsHubSession(): void;
    onForkConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
    transcriptComposerMountKey: string | undefined;
    transcriptComposerHost: HTMLElement | undefined;
    transcriptComposerProject: MobileProjectEntry | undefined;
    transcriptComposerSummary: QaapAgentConversationSummaryDTO | undefined;
    stickyComposerContext: StickyComposerContextEntry[];
    stickyComposerFilesExpanded: boolean;
    stickyComposerDraft: string;
    stickyComposerSurface: QaapComposerSurface;
    stickyComposerModeId: string | undefined;
    stickyComposerCapabilityLevel: ModelCapabilityLevelValue | undefined;
    stickyComposerApprovalPolicyId: QaapAgentApprovalPolicyId | undefined;
    stickyComposerToolApprovalRules: QaapAgentToolApprovalRules | undefined;
    stickyComposerBackendAgents: import('../common/qaap-agent-task-client').QaapAgentTaskAgentOption[];
    transcriptComposerBackendAgents: import('../common/qaap-agent-task-client').QaapAgentTaskAgentOption[];
    stickyComposerPinnedAgentId: string | undefined;
    preparedCwdByProjectId: Map<string, string>;
    chatService?: ChatService;
    chatServiceSessionSummariesByProjectId: Map<string, QaapAgentConversationSummaryDTO[]>;
    chatAgentService?: ChatAgentService;
    conversations?: MobileProjectsConversations;
    readPreference?: (key: string) => unknown;
    preferenceService?: PreferenceService;
    getComposerVariables?: unknown;
    getComposerSkills?: () => readonly { readonly name: string; readonly description?: string }[];
    hubQueryUi: import('./mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    resolveAgentsHubShellProject(): MobileProjectEntry | undefined;
    resolveAgentsHubShellSummary(project: MobileProjectEntry): QaapAgentConversationSummaryDTO | undefined;
    updateNewFabVisibility(): void;
    submitBackgroundAgentTask(project: MobileProjectEntry, draft: string, options: Record<string, unknown>): Promise<void>;
    executionSurfaceTabsUi: import('./mobile-projects-execution-surface-tabs-ui').MobileProjectsExecutionSurfaceTabsUi;
    transcriptComposerUi: MobileProjectsTranscriptComposerUi;
    transcriptStickyComposerUi: MobileProjectsTranscriptStickyComposerUi;
    composerHeaderUi: import('./mobile-projects-composer-header-ui').MobileProjectsComposerHeaderUi;
    stickyComposerSheetsUi: import('./mobile-projects-sticky-composer-sheets-ui').MobileProjectsStickyComposerSheetsUi;
    stickyComposerAgentsUi: import('./mobile-projects-sticky-composer-agents-ui').MobileProjectsStickyComposerAgentsUi;
    stickyComposerContextUi: import('./mobile-projects-sticky-composer-context-ui').MobileProjectsStickyComposerContextUi;
    stickyComposerColumnUi: import('./mobile-projects-sticky-composer-column-ui').MobileProjectsStickyComposerColumnUi;
    stickyComposerWorkspaceUi: import('./mobile-projects-sticky-composer-workspace-ui').MobileProjectsStickyComposerWorkspaceUi;
    isProjectDetailView(): boolean;
    projectsService: MobileProjectsService;
    transcriptComposerSendRefresh: (() => void) | undefined;
    composerPromptImprover?: QaapComposerPromptImprover;
    handleComposerContextItemRemoved(entry: StickyComposerContextEntry): void;
    updateWorkingPillChrome(): void;
}

export class MobileProjectsStickyComposerRenderUi {
    constructor(protected readonly host: MobileProjectsStickyComposerRenderHost) { }

    /** Tracks whether the real (non-placeholder) home-repos composer is currently mounted, to drive autofocus-on-ready. */
    protected reposComposerMounted = false;

    /**
     * Pending re-checks that re-assert focus on the sticky composer textarea shortly after the initial
     * mount, to withstand the Theia shell boot sequence stealing focus back to `document.body` right
     * after the composer is first focused. Cleared whenever the composer re-renders/unmounts.
     */
    protected stickyComposerFocusRetentionTimers: Array<ReturnType<typeof setTimeout>> = [];

    protected readStickyComposerDraft(project: MobileProjectEntry): string {
        return readProjectComposerDraft(project.id, this.host.stickyComposerDraft);
    }

    protected writeStickyComposerDraft(project: MobileProjectEntry, value: string): void {
        this.host.stickyComposerDraft = value;
        writeProjectComposerDraft(project.id, value);
    }

    /**
     * Minimal disabled placeholder rendered while the home-repos composer surface is eligible but the
     * project has not resolved yet (avoids a 5-8s window with zero composer mounted).
     */
    protected renderStickyComposerLoadingPlaceholder(): void {
        const column = document.createElement('div');
        column.className = 'theia-mobile-projects-sticky-composer-column theia-mod-loading';
        const inputPanel = document.createElement('div');
        inputPanel.className = 'theia-mobile-projects-sticky-composer-input-wrap theia-mobile-projects-sticky-composer-input-panel theia-mod-loading';
        const input = document.createElement('textarea');
        input.className = 'theia-mobile-projects-sticky-composer-input theia-mod-loading';
        input.rows = 2;
        input.setAttribute('rows', '2');
        input.disabled = true;
        input.placeholder = nls.localize('qaap/mobileProjects/stickyComposerLoadingProject', 'Loading project…');
        inputPanel.append(input);
        column.append(inputPanel);
        parkWorkingControlFromAncestor(this.host.stickyComposerHost);
        this.host.stickyComposerHost.replaceChildren(column);
        this.host.stickyComposerHost.hidden = false;
        this.host.root.classList.add('theia-mod-sticky-composer');
    }

    handleStickyComposerSlashAction(actionId: StickyComposerSlashActionId, prompt: string): Promise<void> {
        return executeStickyComposerSlashAction(actionId, prompt, {
            forkConversation: async () => {
                const project = this.host.transcriptOpenProject
                    ?? this.host.transcriptComposerProject
                    ?? this.host.resolveAgentsHubShellProject();
                const summary = this.host.transcriptOpenSummary ?? this.host.transcriptComposerSummary;
                if (project && summary) {
                    await this.host.onForkConversation(project, summary);
                }
            },
            startNewAgentWithPrompt: nextPrompt => {
                if (
                    this.host.agentsHubInlineActive
                    && this.host.transcriptOpenSummary
                    && !isAgentsHubIdleConversationSummary(this.host.transcriptOpenSummary)
                ) {
                    this.host.closeAgentsHubSession();
                    this.host.transcriptComposerDraft = nextPrompt;
                    this.renderStickyComposer();
                    return;
                }
                if (
                    this.host.transcriptComposerSummary
                    && !isAgentsHubIdleConversationSummary(this.host.transcriptComposerSummary)
                ) {
                    this.host.transcriptComposerDraft = nextPrompt;
                    this.host.transcriptStickyComposerUi.remountTranscriptStickyComposer();
                    return;
                }
                this.host.stickyComposerDraft = nextPrompt;
                this.renderStickyComposer();
            },
        });
    }

    resolveInstalledMcpServerSlugs(): readonly string[] {
        if (!this.host.preferenceService) {
            return [];
        }
        return [...readInstalledMcpServerSlugs(this.host.preferenceService)];
    }

    async handleInstallMcpPlugin(pluginId: string): Promise<void> {
        if (!this.host.preferenceService) {
            return;
        }
        const plugin = await installMcpMarketplacePlugin(pluginId, this.host.preferenceService);
        if (plugin) {
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/mcpPluginInstalled', 'Added {0}', plugin.name),
                { duration: 2400 },
            );
        }
    }

    async handleRemoveMcpServer(slug: string): Promise<void> {
        if (!this.host.preferenceService) {
            return;
        }
        const removed = await removeMcpServer(slug, this.host.preferenceService);
        if (removed) {
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/mcpPluginRemoved', 'Removed {0}', slug),
                { duration: 2400 },
            );
        }
    }

    handleBrowseMcpMarketplace(): Promise<void> | undefined {
        return openComposerMcpConfigurationSheet(this.host.openAiConfigurationSheet);
    }

    resolveProjectTheiaChatModel(project: MobileProjectEntry): ChatModel | undefined {
        if (!this.host.chatService) {
            return undefined;
        }
        const summaries = this.host.chatServiceSessionSummariesByProjectId.get(project.id) ?? [];
        for (let i = summaries.length - 1; i >= 0; i--) {
            const sessionId = summaries[i].sessionId;
            if (!sessionId) {
                continue;
            }
            const model = this.host.chatService.getSession(sessionId)?.model;
            if (model) {
                return model;
            }
        }
        return undefined;
    }

    protected createImprovePromptHandler(
        cwd: string | undefined,
        resolveAgentId: () => string,
    ): ((context: import('./qaap-composer-prompt-improve-handler').StickyComposerImprovePromptContext) => void) | undefined {
        if (!this.host.composerPromptImprover) {
            return undefined;
        }
        return createStickyComposerImprovePromptHandler({
            improver: this.host.composerPromptImprover,
            resolveAgentId,
            resolveAgentModel: () => readStoredAgentModel(cwd, resolveAgentId()),
            resolveCwd: () => cwd,
        });
    }

    renderStickyComposer(): void {
        this.clearStickyComposerFocusRetention();
        this.host.stickyComposerContextUsageDispose.dispose();
        const filtered = this.host.hubQueryUi.applySearch(this.host.hubQueryUi.applyFilter(this.host.projects, this.host.filter));
        const project = this.host.composerHeaderUi.resolveStickyComposerProject(filtered);
        if (this.host.agentsHubShellActive) {
            this.reposComposerMounted = false;
            const shellProject = this.host.resolveAgentsHubShellProject();
            const shellSummary = shellProject ? this.host.resolveAgentsHubShellSummary(shellProject) : undefined;
            let chatHost = this.host.agentsHubInlineChatHost ?? this.host.transcriptChatHost;
            // Recovery: if agentsHubInlineChatHost is stale (detached), try to re-sync from the
            // live DOM before giving up and hiding the composer. This happens when scroll.replaceChildren()
            // removes the execution root without clearing agentsHubInlineChatHost (e.g. between the
            // initial empty-projects render and the post-load re-render).
            if (!chatHost?.isConnected && this.host.agentsHubInlineExecutionRoot?.isConnected) {
                const liveChatHost = this.host.agentsHubInlineExecutionRoot
                    .querySelector<HTMLElement>('.theia-mobile-agent-transcript-real-chat');
                if (liveChatHost?.isConnected) {
                    this.host.agentsHubInlineChatHost = liveChatHost;
                    this.host.transcriptChatHost = liveChatHost;
                    chatHost = liveChatHost;
                }
            }
            const showMessagesComposer = shellProject
                ? this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(shellProject) === 'messages'
                : false;
            const showComposer = !!(shellProject && shellSummary && chatHost?.isConnected && showMessagesComposer);
            this.host.stickyComposerHost.hidden = !showComposer;
            this.host.root.classList.toggle('theia-mod-sticky-composer', showComposer);
            if (showComposer) {
                const mountKey = `${shellProject!.id}|${shellSummary!.id}`;
                const composerStable = this.host.transcriptComposerMountKey === mountKey
                    && this.host.transcriptComposerHost === this.host.stickyComposerHost
                    && this.host.stickyComposerHost.childElementCount > 0;
                if (!composerStable) {
                    parkWorkingControlFromAncestor(this.host.stickyComposerHost);
                    this.host.stickyComposerHost.replaceChildren();
                    if (this.host.transcriptComposerBackendAgents.length === 0) {
                        void this.host.transcriptComposerUi.refreshTranscriptComposerAgents(shellProject!);
                    }
                    this.host.transcriptStickyComposerUi.mountTranscriptStickyComposer(this.host.stickyComposerHost, shellProject!, shellSummary!, chatHost!);
                } else {
                    this.host.transcriptComposerSendRefresh?.();
                    this.host.transcriptStickyComposerUi.syncTranscriptComposerQuickActionsVisibility(
                        this.host.stickyComposerHost,
                        shellSummary!,
                    );
                }
                this.host.updateWorkingPillChrome();
            } else {
                this.host.transcriptComposerMountKey = undefined;
                parkWorkingControlFromAncestor(this.host.stickyComposerHost);
                this.host.stickyComposerHost.replaceChildren();
            }
            this.host.composerHeaderUi.syncHeaderComposerSurfacePicker();
            this.host.updateNewFabVisibility();
            window.requestAnimationFrame(() => this.host.composerHeaderUi.updateStickyComposerFabLift());
            return;
        }
        const activeElementBeforeRender = document.activeElement;
        const focusEligibleBeforeMount = !activeElementBeforeRender
            || activeElementBeforeRender === document.body
            || (activeElementBeforeRender instanceof HTMLElement && activeElementBeforeRender.classList.contains('theia-mod-loading'));
        this.host.transcriptComposerMountKey = undefined;
        parkWorkingControlFromAncestor(this.host.stickyComposerHost);
        this.host.stickyComposerHost.replaceChildren();
        const surfaceEligible = this.host.homeMode && !!this.host.conversations && this.host.hubView === 'repos';
        const showReposComposer = surfaceEligible && !!project;
        const showSurface = showReposComposer;
        const showComposer = showSurface
            && (!this.host.isProjectDetailView() || (project && this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(project) === 'messages'));
        this.host.stickyComposerHost.hidden = !showComposer;
        this.host.root.classList.toggle('theia-mod-sticky-composer', showComposer);
        if (!showSurface || !project) {
            this.host.stickyComposerSheetsUi.closeStickyComposerSheets();
            this.reposComposerMounted = false;
            if (surfaceEligible && !project) {
                this.renderStickyComposerLoadingPlaceholder();
            }
            return;
        }

        void this.host.stickyComposerAgentsUi.refreshStickyComposerAgents(project);

        const cwd = this.host.projectsService.getProjectCwd(project) ?? this.host.preparedCwdByProjectId.get(project.id);
        this.host.stickyComposerSurface = 'task';
        const isChatSurface = false;
        const canRunTask = !!project && (!!cwd || !!project.github);
        const canRunChat = !!this.host.chatService && !!project;
        const canSubmit = isChatSurface ? canRunChat : canRunTask;
        const pinnedId = this.host.stickyComposerAgentsUi.resolveStickyComposerPinnedAgentId(project);
        const modes = resolveStickyComposerModes(pinnedId, this.host.chatAgentService);
        this.host.stickyComposerModeId = reconcileComposerModeId(
            this.host.stickyComposerModeId,
            modes,
            cwd,
        );
        this.host.stickyComposerCapabilityLevel = reconcileModelCapabilityLevel(
            this.host.stickyComposerCapabilityLevel,
            cwd,
        );
        const showApprovalPolicy = agentSupportsApprovalPolicy(pinnedId);
        let capabilityTriggerRefresh: (() => void) | undefined;
        if (showApprovalPolicy) {
            this.host.stickyComposerApprovalPolicyId = reconcileAgentApprovalPolicyId(
                this.host.stickyComposerApprovalPolicyId,
                cwd,
            );
            this.host.stickyComposerToolApprovalRules = reconcileAgentToolApprovalRules(
                this.host.stickyComposerApprovalPolicyId,
                cwd,
                this.host.stickyComposerToolApprovalRules,
            );
        } else {
            this.host.stickyComposerApprovalPolicyId = undefined;
            this.host.stickyComposerToolApprovalRules = undefined;
        }

        const column = this.host.stickyComposerColumnUi.buildStickyComposerColumn({
            project,
            composerCwd: cwd,
            surface: this.host.stickyComposerSurface,
            agentLocked: isChatSurface,
            getContext: () => this.host.stickyComposerContext,
            clearContext: () => {
                disposeComposerContextEntries(this.host.stickyComposerContext);
                this.host.stickyComposerContext = [];
                this.renderStickyComposer();
            },
            removeContextItem: index => {
                const entry = this.host.stickyComposerContext[index];
                revokeComposerContextPreview(entry);
                this.host.stickyComposerContext.splice(index, 1);
                this.host.handleComposerContextItemRemoved(entry);
                this.renderStickyComposer();
            },
            formatContextChip: item => this.host.stickyComposerContextUi.formatComposerContextEntry(item),
            filesExpanded: this.host.stickyComposerFilesExpanded,
            onFilesExpandedChange: expanded => { this.host.stickyComposerFilesExpanded = expanded; },
            getDraft: () => this.readStickyComposerDraft(project),
            setDraft: value => { this.writeStickyComposerDraft(project, value); },
            resolveAgentLabel: () => this.host.stickyComposerAgentsUi.resolveStickyComposerAgentLabel(project),
            resolveAgentId: () => this.host.stickyComposerAgentsUi.resolveStickyComposerPinnedAgentId(project),
            modes,
            resolveModeLabel: () => resolveComposerModeLabel(modes, this.host.stickyComposerModeId),
            resolveModeId: () => this.host.stickyComposerModeId,
            onOpenModeSheet: modes.length > 1
                ? anchor => { this.host.stickyComposerSheetsUi.openStickyComposerModeSheet(project, modes, anchor); }
                : undefined,
            approvalPolicyId: showApprovalPolicy ? this.host.stickyComposerApprovalPolicyId : undefined,
            onOpenApprovalPolicySheet: showApprovalPolicy
                ? anchor => {
                    this.host.stickyComposerSheetsUi.openStickyComposerApprovalPolicySheet(
                        project,
                        this.host.stickyComposerAgentsUi.resolveStickyComposerAgentLabel(project),
                        anchor,
                    );
                }
                : undefined,
            canSubmit,
            onImprovePrompt: this.createImprovePromptHandler(
                cwd,
                () => this.host.stickyComposerAgentsUi.resolveStickyComposerPinnedAgentId(project),
            ),
            onAttach: anchor => { void this.host.stickyComposerContextUi.onStickyComposerAttach(project, anchor); },
            onDropFiles: (files, uploadTargetDir) => {
                const targetDir = uploadTargetDir ?? project.uri
                    ?? (cwd ? new URI().withScheme('file').withPath(cwd) : undefined);
                console.log('[qaap-drop] onDropFiles called', { fileCount: files.length, targetDir: targetDir?.toString(), projectUri: project.uri?.toString(), cwd });
                this.host.stickyComposerContextUi.dropStickyComposerFiles(project, files, targetDir);
            },
            onOpenAgentSheet: isChatSurface
                ? () => { /* Chat is Coder-only */ }
                : anchor => { this.host.stickyComposerSheetsUi.openStickyComposerAgentSheet(project, anchor); },
            onSubmit: draft => {
                if (this.host.stickyComposerContextUi.hasPendingComposerAttachments()) {
                    this.host.stickyComposerContextUi.notifyPendingComposerAttachments();
                    return;
                }
                const resolvedPinnedId = isChatSurface
                    ? THEIA_CODER_AGENT_ID
                    : this.host.stickyComposerAgentsUi.resolveStickyComposerPinnedAgentId(project);
                const selectedAgentId = isChatSurface
                    ? THEIA_CODER_AGENT_ID
                    : resolveExplicitAgentForSubmit(draft, {
                        pinnedChatAgentId: resolvedPinnedId,
                    }) ?? resolvedPinnedId;
                const variables = composerContextRequests(this.host.stickyComposerContext);
                const modeId = this.host.stickyComposerModeId;
                const autoApprove = resolveComposerAutoApprove(
                    showApprovalPolicy,
                    this.host.stickyComposerApprovalPolicyId,
                    cwd,
                );
                disposeComposerContextEntries(this.host.stickyComposerContext);
                this.host.stickyComposerContext = [];
                const submitOptions = {
                    openConversation: true,
                    selectedAgentId,
                    modeId,
                    variables: variables.length > 0 ? variables : undefined,
                    autoApprove,
                };
                const done = this.host.submitBackgroundAgentTask(project, draft, {
                    ...submitOptions,
                    forceVps: true,
                    worktree: this.host.stickyComposerWorkspaceUi.resolveComposerWorkspaceDestination(project) === 'worktree',
                    approvalPolicyId: showApprovalPolicy
                        ? reconcileAgentApprovalPolicyId(this.host.stickyComposerApprovalPolicyId, cwd)
                        : undefined,
                    toolApprovalRules: showApprovalPolicy
                        ? this.host.stickyComposerToolApprovalRules
                        : undefined,
                    agentModel: readStoredAgentModel(cwd, selectedAgentId),
                });
                void done.finally(() => this.renderStickyComposer());
            },
            onSubmitBlocked: () => {
                if (this.host.stickyComposerContextUi.hasPendingComposerAttachments()) {
                    this.host.stickyComposerContextUi.notifyPendingComposerAttachments();
                    return;
                }
                if (isChatSurface && !this.host.chatService) {
                    MobileSnackbar.show(
                        nls.localize('qaap/mobileProjects/agentInputUnavailable', 'Agent input is unavailable.'),
                        { duration: 2400 },
                    );
                    return;
                }
                MobileSnackbar.show(
                    isChatSurface
                        ? nls.localize('qaap/mobileProjects/stickyComposerNoChat', 'Open this project in the workspace to start a local chat.')
                        : nls.localize('qaap/mobileProjects/stickyComposerNoProject', 'Add or open a repository first.'),
                    { duration: 2400 },
                );
            },
            afterInputChange: () => { /* sticky draft persisted in setDraft */ },
            getMentionOptions: () => this.host.stickyComposerContextUi.resolveComposerMentionOptions(this.host.stickyComposerBackendAgents, isChatSurface),
            getVariableOptions: this.host.getComposerVariables
                ? () => this.host.stickyComposerContextUi.resolveComposerVariableOptions()
                : undefined,
            getSkillOptions: this.host.getComposerSkills
                ? () => this.host.stickyComposerContextUi.resolveComposerSkillOptions()
                : undefined,
            getSlashMenuSections: () => this.host.stickyComposerContextUi.resolveComposerSlashMenuSections(),
            onSlashAction: (actionId, prompt) => this.handleStickyComposerSlashAction(actionId, prompt),
            getInstalledMcpServerSlugs: () => this.resolveInstalledMcpServerSlugs(),
            onInstallMcpPlugin: pluginId => this.handleInstallMcpPlugin(pluginId),
            onRemoveMcpServer: slug => this.handleRemoveMcpServer(slug),
            onBrowseMcpMarketplace: () => this.handleBrowseMcpMarketplace(),
            getSkillNames: this.host.getComposerSkills
                ? () => this.host.getComposerSkills!().map(skill => skill.name)
                : undefined,
            inputPlaceholder: isChatSurface
                ? nls.localize('qaap/mobileProjects/stickyComposerNewChat', 'Message the workspace agent…')
                : nls.localize('qaap/mobileProjects/stickyComposerNewTask', 'Delegate a task…'),
            sendLabel: isChatSurface
                ? nls.localize('qaap/mobileProjects/chatSend', 'Send')
                : nls.localize('qaap/mobileProjects/taskCreate', 'Create'),
            resolveCapabilityLevel: () => this.host.stickyComposerCapabilityLevel
                ?? reconcileModelCapabilityLevel(undefined, cwd),
            onOpenCapabilityPopover: anchor => {
                this.host.stickyComposerSheetsUi.openStickyComposerModelCapabilityPopover({
                    anchor,
                    cwd,
                    resolveLevel: () => this.host.stickyComposerCapabilityLevel
                        ?? reconcileModelCapabilityLevel(undefined, cwd),
                    assignLevel: level => { this.host.stickyComposerCapabilityLevel = level; },
                    onCommit: () => capabilityTriggerRefresh?.(),
                });
            },
            onCapabilityTriggerMounted: refresh => { capabilityTriggerRefresh = refresh; },
            onContextUsageBadgeMounted: badge => {
                this.host.stickyComposerContextUsageDispose = this.mountStickyComposerContextUsage(
                    badge,
                    () => isChatSurface
                        ? (() => {
                            const chatModel = this.resolveProjectTheiaChatModel(project);
                            return chatModel ? { chatModel } : undefined;
                        })()
                        : undefined,
                );
            },
            onOpenContextUsageSheet: anchor => {
                this.host.stickyComposerSheetsUi.openStickyComposerContextUsageSheet(
                    () => {
                        if (isChatSurface) {
                            const chatModel = this.resolveProjectTheiaChatModel(project);
                            if (chatModel) {
                                return resolveChatModelContextUsageBreakdown(chatModel);
                            }
                        }
                        return resolveVpsContextUsageBreakdown(undefined);
                    },
                    document.body.classList.contains('theia-mobile-mod-workhub-composer-header')
                    || document.body.classList.contains('theia-mobile-mod-workhub-no-bottom-chrome'),
                    anchor,
                );
            },
        });
        const modeHint = describeComposerInteractionMode(this.host.stickyComposerModeId);
        if (modeHint) {
            const modeBanner = document.createElement('div');
            modeBanner.className = 'theia-mobile-sticky-composer-mode-banner';
            modeBanner.textContent = modeHint;
            this.host.stickyComposerHost.append(modeBanner);
        }
        const pinnedAgentId = this.host.stickyComposerPinnedAgentId;
        if (
            this.host.openPreferencesSheet
            && agentNeedsSettingsApiKeyPath(pinnedAgentId)
            && agentUsesSettingsModelCatalog(pinnedAgentId)
            && !hasAnyConfiguredByokCredential(key => this.host.readPreference?.(key))
        ) {
            const keyBanner = document.createElement('div');
            keyBanner.className = 'theia-mobile-sticky-composer-mode-banner theia-mobile-sticky-composer-api-key-banner';
            const keyText = document.createElement('span');
            keyText.textContent = nls.localize(
                'qaap/mobileProjects/stickyComposerNeedApiKey',
                'This agent needs an API key in Settings before it can run.',
            );
            const keyBtn = document.createElement('button');
            keyBtn.type = 'button';
            keyBtn.className = 'theia-mobile-sticky-composer-api-key-banner-action';
            keyBtn.textContent = localizeAddApiKeyInSettingsCta();
            keyBtn.addEventListener('click', () => {
                void this.host.openPreferencesSheet?.(QAAP_AI_FEATURES_SETTINGS_QUERY);
            });
            keyBanner.append(keyText, keyBtn);
            this.host.stickyComposerHost.append(keyBanner);
        }
        this.host.stickyComposerHost.append(column);
        this.host.updateWorkingPillChrome();
        const becameMounted = showComposer && !this.reposComposerMounted;
        this.reposComposerMounted = showComposer;
        if (becameMounted && focusEligibleBeforeMount) {
            window.requestAnimationFrame(() => {
                const textarea = column.querySelector<HTMLTextAreaElement>('.theia-mobile-projects-sticky-composer-input');
                textarea?.focus();
                this.scheduleStickyComposerFocusRetention(textarea ?? undefined);
            });
        }
        this.host.composerHeaderUi.syncHeaderComposerSurfacePicker();
        this.host.updateNewFabVisibility();
        window.requestAnimationFrame(() => this.host.composerHeaderUi.updateStickyComposerFabLift());
    }
    /**
     * Cancels any pending sticky-composer focus re-checks scheduled by {@link scheduleStickyComposerFocusRetention}.
     * Called at the start of every render so a re-render (which rebuilds/removes the composer column) never
     * leaves a stale timer pointing at a disconnected textarea.
     */
    protected clearStickyComposerFocusRetention(): void {
        for (const timer of this.stickyComposerFocusRetentionTimers) {
            clearTimeout(timer);
        }
        this.stickyComposerFocusRetentionTimers = [];
    }

    /**
     * The Theia shell boot sequence can steal focus back to `document.body` shortly after the sticky
     * composer textarea receives its initial autofocus (e.g. layout restoration finishing after the
     * composer mounts). Re-assert focus a couple of times while the app settles, but only when nothing
     * else legitimately holds focus (never steal focus from a real input, including one the user has
     * started typing into) and the textarea is still connected and enabled. Stops after the first
     * successful re-focus or once both checks have run (~3s after mount).
     */
    protected scheduleStickyComposerFocusRetention(textarea: HTMLTextAreaElement | undefined): void {
        if (!textarea) {
            return;
        }
        const reassertFocus = (): void => {
            const activeElement = document.activeElement;
            const focusWasStolen = !activeElement || activeElement === document.body;
            if (!focusWasStolen || !textarea.isConnected || textarea.disabled) {
                this.clearStickyComposerFocusRetention();
                return;
            }
            textarea.focus();
            if (document.activeElement === textarea) {
                this.clearStickyComposerFocusRetention();
            }
        };
        this.stickyComposerFocusRetentionTimers.push(setTimeout(reassertFocus, 1000));
        this.stickyComposerFocusRetentionTimers.push(setTimeout(reassertFocus, 3000));
    }

    mountStickyComposerContextUsage(
        badge: HTMLButtonElement,
        resolveTarget: () => {
            readonly summary?: QaapAgentConversationSummaryDTO;
            readonly chatModel?: ChatModel;
            readonly full?: QaapAgentConversationDTO;
        } | undefined,
    ): Disposable {
        const enabled = isContextUsageIndicatorEnabled(this.host.readPreference);
        const thresholdPercent = resolveContextUsageWarningThresholdPercentage(this.host.readPreference);
        const theiaThreshold = resolveContextUsageWarningThreshold(this.host.readPreference);
        const subscribe = (onRefresh: () => void): Disposable => {
            const disposables = new DisposableCollection();
            const target = resolveTarget();
            const conversationId = target?.summary?.id;
            const conversations = this.host.conversations;
            if (conversations && conversationId && !target?.chatModel) {
                disposables.push(conversations.threadStore.subscribe(
                    () => onRefresh(),
                    snapshot => snapshot.summariesById.get(conversationId)?.contextUsage,
                    conversationId,
                ));
                disposables.push(conversations.threadStore.subscribe(
                    () => onRefresh(),
                    snapshot => snapshot.document?.contextUsage,
                    conversationId,
                ));
            } else if (conversations) {
                disposables.push(conversations.onDidChangeDetail(change => {
                    if (change.kind === 'snapshot'
                        || change.conversationId === conversationId
                        || !conversationId) {
                        onRefresh();
                    }
                }));
            }
            const model = target?.chatModel;
            if (model) {
                disposables.push(model.onDidChange(onRefresh));
            }
            return disposables;
        };
        const indicatorDisposable = bindContextUsageIndicator(
            badge,
            () => {
                const target = resolveTarget();
                if (target?.chatModel) {
                    return resolveContextUsageIndicatorState(target.chatModel, {
                        enabled,
                        threshold: theiaThreshold,
                        showWhenEmpty: true,
                    });
                }
                return resolveVpsContextUsageIndicatorState(target?.summary, {
                    enabled,
                    threshold: theiaThreshold,
                    showWhenEmpty: true,
                    thresholdPercentBasis: thresholdPercent,
                }, target?.full);
            },
            subscribe,
        );
        return indicatorDisposable;
    }
}


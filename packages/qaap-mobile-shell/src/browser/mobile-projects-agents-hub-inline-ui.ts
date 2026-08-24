// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import {
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import {
    buildAgentsHubIdleConversationSummary,
    isAgentsHubIdleConversationSummary,
    QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID,
    QAAP_AGENTS_HUB_LANDING_ENABLED,
} from '../common/qaap-agents-hub-landing';
import { appendOptimisticPendingUserMessage } from '../common/qaap-transcript-sse-delta';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import type { QaapTranscriptUserImagePreview } from '../common/qaap-transcript-user-image-preview';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectsTranscriptUi } from './mobile-projects-transcript-ui';
import type { MobileProjectsTranscriptComposerUi } from './mobile-projects-transcript-composer-ui';
import type { MobileProjectsTranscriptStickyComposerUi } from './mobile-projects-transcript-sticky-composer-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptLiveUi } from './mobile-projects-transcript-live-ui';
import type { MobileProjectsTranscriptMessagesUi } from './mobile-projects-transcript-messages-ui';
import type { MobileProjectsTranscriptSheetUi } from './mobile-projects-transcript-sheet-ui';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectsTasksHubUi } from './mobile-projects-tasks-hub-ui';
import { disposeComposerContextEntries, type StickyComposerContextEntry } from '../common/qaap-composer-context-entry';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { startGithubOAuth } from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';

/** Panel surface for the Agents Hub inline execution shell (tasks landing). */
export interface MobileProjectsAgentsHubInlineHost {
    homeMode: boolean;
    hubView: import('./mobile-projects-types').MobileProjectsHubView;
    visible: boolean;
    scroll: HTMLElement;
    root: HTMLElement;
    projects: MobileProjectEntry[];
    readQaapSignedIn?: () => boolean;
    tasksFirstLoadPending: boolean;
    agentsHubLegacyInbox: boolean;
    agentsHubSelectedProjectId: string | undefined;
    agentsHubShellActive: boolean;
    agentsHubInlineActive: boolean;
    agentsHubInlineChatHost: HTMLElement | undefined;
    agentsHubInlineTranscriptRoot: HTMLElement | undefined;
    agentsHubInlineExecutionRoot: HTMLElement | undefined;
    agentsHubInlineTabStrip: HTMLElement | undefined;
    replacingTranscriptSheet: boolean;
    transcriptOpenSummaryId: string | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptSheet: HTMLElement | undefined;
    transcriptTabStrip: HTMLElement | undefined;
    sessionsSidebar: { isVisible(): boolean; refreshList(options?: { force?: boolean }): void; scheduleRefreshList(): void } | undefined;
    transcriptLastStatus: QaapAgentConversationSummaryDTO['status'] | undefined;
    transcriptLastFingerprint: string | undefined;
    transcriptLastConv: QaapAgentConversationDTO | undefined;
    transcriptConversationCache: Map<string, QaapAgentConversationDTO>;
    transcriptLastSseDeltaAt: number | undefined;
    transcriptLastStreamProgressAt: number | undefined;
    transcriptLastSemanticProgressKey: string | undefined;
    transcriptChatHost: HTMLElement | undefined;
    transcriptReviewHost: HTMLElement | undefined;
    transcriptPreviewHost: HTMLElement | undefined;
    transcriptFilesHost: HTMLElement | undefined;
    transcriptTerminalHost: HTMLElement | undefined;
    transcriptComposerHost: HTMLElement | undefined;
    transcriptComposerProject: MobileProjectEntry | undefined;
    transcriptComposerSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptComposerMountKey: string | undefined;
    transcriptComposerContext: StickyComposerContextEntry[];
    transcriptComposerPinnedAgentId: string | undefined;
    transcriptComposerAgentModel: import('../common/qaap-agent-task-client').QaapCreateAgentTaskQaiqModel | undefined;
    transcriptComposerModeId: string | undefined;
    transcriptComposerApprovalPolicyId: import('../common/qaap-sticky-composer-approval-policy').QaapAgentApprovalPolicyId | undefined;
    transcriptComposerPrefsConvId: string | undefined;
    transcriptComposerDraft: string;
    transcriptComposerDraftPersistTimer: number | undefined;
    transcriptComposerPrefsPersistTimer: number | undefined;
    transcriptUserScrollPinDispose: Disposable;
    transcriptTheiaSessionByConversationId: Map<string, string>;
    transcriptUi: MobileProjectsTranscriptUi;
    tasksHubUi: MobileProjectsTasksHubUi;
    headerExecutionTabsHost: HTMLElement;
    headerPreviewRunHost: HTMLElement;
    headerFilesMoreHost: HTMLElement;
    headerViewModeSwitchHost: HTMLElement;
    preparedCwdByProjectId: Map<string, string>;
    projectsService: MobileProjectsService;

    transcriptSheetUi: MobileProjectsTranscriptSheetUi;
    executionSurfaceTabsUi: MobileProjectsExecutionSurfaceTabsUi;
    transcriptComposerUi: MobileProjectsTranscriptComposerUi;
    transcriptStickyComposerUi: MobileProjectsTranscriptStickyComposerUi;
    transcriptHeaderUi: MobileProjectsTranscriptHeaderUi;
    transcriptLiveUi: MobileProjectsTranscriptLiveUi;
    transcriptMessagesUi: MobileProjectsTranscriptMessagesUi;
    transcriptSurfacesUi: import('./mobile-projects-transcript-surfaces-ui').MobileProjectsTranscriptSurfacesUi;
    renderHeader(): void;
    renderSubtitle(): void;
    renderList(): void;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    detachTranscriptReviewWidget(): void;
    disposeTranscriptEmbeddedPreview(): void;
    notifyWorkspaceHubBottomBarRefresh(): void;
    resolveHomePinnedProject(): MobileProjectEntry | undefined;
    updateTasksAttentionChrome(): void;
    conversationsForProject(project: MobileProjectEntry): QaapAgentConversationSummaryDTO[];
    conversations?: import('./mobile-projects-conversations').MobileProjectsConversations;
    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    onNewClick(): Promise<void>;
    onStartNewProject(): Promise<void>;
    onOpenLocalWorkspaceFolder(): Promise<void>;
}

/** Agents Hub inline transcript shell: open/close session, execution surfaces, idle chat. */
export class MobileProjectsAgentsHubInlineUi {

    constructor(protected readonly host: MobileProjectsAgentsHubInlineHost) { }

    protected agentsHubExecutionHeaderProjectId: string | undefined;

    shouldPreserveAgentsHubInlineTranscriptShell(): boolean {
        return this.host.hubView === 'tasks'
            && this.shouldUseAgentsHubLanding()
            && this.host.agentsHubInlineActive
            && !!this.host.transcriptOpenSummaryId
            && !!this.host.agentsHubInlineExecutionRoot?.isConnected
            && this.host.agentsHubInlineExecutionRoot.parentElement === this.host.scroll;
    }

    /** Keep Plan/Preview/Files surfaces mounted while a non-chat execution tab is active. */
    shouldPreserveAgentsHubToolSurface(): boolean {
        if (this.host.hubView !== 'tasks' || !this.shouldUseAgentsHubLanding() || !this.host.agentsHubShellActive) {
            return false;
        }
        const project = this.resolveAgentsHubShellProject();
        if (!project || !this.host.agentsHubInlineExecutionRoot?.isConnected) {
            return false;
        }
        return this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(project) !== 'messages';
    }

    /** Keep the Agents Hub execution shell mounted during SSE ticks (idle or transcript open). */
    shouldPreserveAgentsHubExecutionShell(): boolean {
        return this.host.hubView === 'tasks'
            && this.shouldUseAgentsHubLanding()
            && this.host.agentsHubShellActive
            && !!this.host.agentsHubInlineExecutionRoot?.isConnected
            && this.host.agentsHubInlineExecutionRoot.parentElement === this.host.scroll;
    }

    /** SSE ticks while a transcript is open should not rebuild the whole Work Hub list. */
    shouldSkipFullRenderListOnConversationTick(): boolean {
        if (this.host.transcriptSheet && this.host.transcriptOpenSummaryId) {
            return true;
        }
        if (this.shouldPreserveAgentsHubExecutionShell()) {
            return true;
        }
        return this.host.hubView === 'tasks'
            && this.shouldUseAgentsHubLanding()
            && !!this.host.transcriptOpenSummaryId
            && (this.host.agentsHubInlineActive || !!this.host.transcriptSheet);
    }

    refreshWorkHubConversationChrome(): void {
        if (this.host.sessionsSidebar?.isVisible()) {
            this.host.sessionsSidebar.scheduleRefreshList();
        }
        const project = this.resolveAgentsHubShellProject();
        const summary = this.host.transcriptOpenSummary;
        if (project && summary && this.host.agentsHubInlineActive) {
            const latest = this.host.conversationIndexUi.findSummaryById(summary.id) ?? summary;
            const headerChanged = latest.status !== summary.status
                || latest.title !== summary.title
                || !!latest.priority !== !!summary.priority;
            this.host.transcriptOpenSummary = latest;
            if (headerChanged) {
                this.syncAgentsHubInlineExecutionHeader(project, latest);
            }
        }
        this.host.updateTasksAttentionChrome();
        this.host.transcriptHeaderUi.refreshTranscriptExecutionChrome();
    }

    shouldUseAgentsHubLanding(): boolean {
        return QAAP_AGENTS_HUB_LANDING_ENABLED
            && this.host.homeMode
            && this.host.hubView === 'tasks'
            && !this.host.agentsHubLegacyInbox;
    }

    resolveAgentsHubShellProject(): MobileProjectEntry | undefined {
        const openSummary = this.host.transcriptOpenSummary;
        const hasLiveTranscript = this.host.agentsHubInlineActive
            && this.host.transcriptOpenProject
            && openSummary
            && !isAgentsHubIdleConversationSummary(openSummary);
        if (hasLiveTranscript) {
            return this.host.transcriptOpenProject;
        }
        if (this.host.agentsHubSelectedProjectId) {
            const selected = this.host.projects.find(project => project.id === this.host.agentsHubSelectedProjectId);
            if (selected) {
                return selected;
            }
        }
        const fromWorkspace = this.host.projectsService.resolveCurrentWorkspaceProject(this.host.projects);
        if (fromWorkspace) {
            return fromWorkspace;
        }
        return this.host.transcriptOpenProject ?? this.host.resolveHomePinnedProject();
    }

    resolveAgentsHubShellSummary(project: MobileProjectEntry): QaapAgentConversationSummaryDTO {
        // Skip an open summary whose cwd is the multi-repo CONTAINER (a stale server DTO from
        // before the container guard): the composer warm, follow-up create and stop/retry all
        // inherit summary.cwd, so passing it through re-leaks `/workspace` to the backend.
        if (this.host.transcriptOpenSummary && !isQaapWorkspaceContainerPath(this.host.transcriptOpenSummary.cwd)) {
            return this.host.transcriptOpenSummary;
        }
        const active = this.host.conversationsForProject(project)
            .find(summary => summary.status === 'streaming' && !isAgentsHubIdleConversationSummary(summary));
        if (active) {
            return active;
        }
        const cwd = this.resolveAgentsHubShellCwd(project);
        return buildAgentsHubIdleConversationSummary(cwd ?? '');
    }

    /** Filesystem cwd for the Agents hub idle shell — never a display name such as "Mockup". */
    protected resolveAgentsHubShellCwd(project: MobileProjectEntry): string | undefined {
        const fromProject = this.host.projectsService.getProjectCwd(project)
            ?? this.host.preparedCwdByProjectId.get(project.id);
        if (fromProject) {
            return fromProject;
        }
        const workspaceCwd = this.host.projectsService.getCurrentWorkspaceCwd();
        if (
            workspaceCwd
            && !isQaapWorkspaceContainerPath(workspaceCwd)
            && this.host.projectsService.projectMatchesCurrentWorkspace(project)
        ) {
            return workspaceCwd;
        }
        return this.host.conversations?.findConversationsForProject(project)
            .map(summary => summary.cwd)
            .find(known => !!known && !isQaapWorkspaceContainerPath(known));
    }

    renderAgentsHubExecutionShell(): void {
        const project = this.resolveAgentsHubShellProject();
        if (!project) {
            if (this.host.tasksFirstLoadPending) {
                this.host.agentsHubShellActive = false;
                const root = document.createElement('div');
                root.className = 'theia-mobile-tasks-hub-root theia-mod-agents-loading';
                root.append(this.host.tasksHubUi.createTasksLoadingState());
                this.host.scroll.append(root);
                this.host.updateTasksAttentionChrome();
                this.host.renderSubtitle();
                return;
            }
            this.host.agentsHubShellActive = false;
            const note = document.createElement('div');
            note.className = 'theia-mobile-agent-transcript-empty theia-mod-no-project';
            note.append(this.createAgentsHubNoProjectOnboarding());
            this.host.scroll.append(note);
            this.host.updateTasksAttentionChrome();
            this.host.renderSubtitle();
            return;
        }
        const summary = this.resolveAgentsHubShellSummary(project);
        this.ensureAgentsHubExecutionShell(project, summary);
    }

    protected ensureAgentsHubExecutionShell(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): HTMLElement | undefined {
        this.host.agentsHubShellActive = true;
        if (
            this.host.agentsHubInlineExecutionRoot?.isConnected
            && this.host.agentsHubInlineChatHost?.isConnected
        ) {
            this.applyAgentsHubExecutionPanelSizing(this.host.agentsHubInlineExecutionRoot);
            const liveTranscriptOpen = this.host.agentsHubInlineActive && !!this.host.transcriptOpenSummaryId;
            if (!liveTranscriptOpen) {
                this.renderAgentsHubShellChat(this.host.agentsHubInlineChatHost, project, summary);
            }
            this.syncAgentsHubInlineExecutionHeader(project, summary);
            this.host.updateTasksAttentionChrome();
            this.host.renderSubtitle();
            void this.host.transcriptComposerUi.refreshTranscriptComposerAgents(project);
            this.host.stickyComposerRenderUi.renderStickyComposer();
            if (liveTranscriptOpen) {
                this.host.transcriptLiveUi.ensureTranscriptConversationRefresh();
            }
            return this.host.agentsHubInlineChatHost;
        }
        const executionRoot = document.createElement('div');
        executionRoot.className = 'theia-mobile-agents-hub-inline-execution';
        this.applyAgentsHubExecutionPanelSizing(executionRoot);
        this.host.agentsHubInlineExecutionRoot = executionRoot;

        if (!this.host.transcriptReviewHost) {
            const surfaces = this.host.transcriptSheetUi.createTranscriptSheetSurfaceHosts();
            this.host.transcriptReviewHost = surfaces.reviewHost;
            this.host.transcriptPreviewHost = surfaces.previewHost;
            this.host.transcriptFilesHost = surfaces.filesHost;
            this.host.transcriptTerminalHost = surfaces.terminalHost;
        }
        executionRoot.append(
            this.host.transcriptReviewHost!,
            this.host.transcriptPreviewHost!,
            this.host.transcriptFilesHost!,
            this.host.transcriptTerminalHost!,
        );

        const transcriptRoot = document.createElement('div');
        transcriptRoot.className = 'theia-mobile-agents-hub-inline-transcript';
        this.host.agentsHubInlineTranscriptRoot = transcriptRoot;
        const chatHost = document.createElement('div');
        chatHost.className = 'theia-mobile-agent-transcript-real-chat';
        this.host.agentsHubInlineChatHost = chatHost;
        this.host.transcriptChatHost = chatHost;
        if (!(this.host.agentsHubInlineActive && this.host.transcriptOpenSummaryId)) {
            this.renderAgentsHubShellChat(chatHost, project, summary);
        }
        transcriptRoot.append(chatHost);
        executionRoot.append(transcriptRoot);
        this.host.scroll.append(executionRoot);

        this.host.updateTasksAttentionChrome();
        this.host.renderSubtitle();
        this.syncAgentsHubInlineExecutionHeader(project, summary);
        void this.host.transcriptComposerUi.refreshTranscriptComposerAgents(project);
        this.host.stickyComposerRenderUi.renderStickyComposer();
        if (this.host.agentsHubInlineActive && this.host.transcriptOpenSummaryId) {
            this.host.transcriptLiveUi.ensureTranscriptConversationRefresh();
        }
        return chatHost;
    }

    protected applyAgentsHubExecutionPanelSizing(executionRoot: HTMLElement): void {
        // Only set width/maxWidth via inline styles. Alignment (align-items,
        // align-self, margin) is controlled entirely by CSS so the sessions
        // sidebar open/closed state can override it without fighting inline styles.
        this.host.scroll.style.width = '100%';
        this.host.scroll.style.maxWidth = '100%';
        executionRoot.style.width = '100%';
        executionRoot.style.maxWidth = '100%';
    }

    protected createAgentsHubNoProjectOnboarding(): HTMLElement {
        const root = document.createElement('div');
        root.className = 'theia-mobile-agents-hub-onboarding';

        const mark = document.createElement('span');
        mark.className = 'theia-mobile-agents-hub-onboarding-mark codicon codicon-repo';
        mark.setAttribute('aria-hidden', 'true');

        const title = document.createElement('p');
        title.className = 'theia-mobile-agents-hub-onboarding-title';
        title.textContent = nls.localize('qaap/agentsHub/noProjectsTitle', 'Add your first project');

        const hint = document.createElement('p');
        hint.className = 'theia-mobile-agents-hub-onboarding-hint';
        hint.textContent = nls.localize(
            'qaap/agentsHub/noProjects',
            'Connect a GitHub repository to start working with an agent.',
        );

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-agents-hub-onboarding-actions';

        const newProject = document.createElement('button');
        newProject.type = 'button';
        newProject.className = 'theia-mobile-agents-hub-onboarding-btn theia-mod-primary';
        const newProjectIcon = document.createElement('span');
        newProjectIcon.className = 'codicon codicon-repo theia-mobile-agents-hub-onboarding-btn-icon';
        newProjectIcon.setAttribute('aria-hidden', 'true');
        const newProjectLabel = document.createElement('span');
        newProjectLabel.className = 'theia-mobile-agents-hub-onboarding-btn-label';
        newProjectLabel.textContent = nls.localize('qaap/mobileOpenRepo/startNewProject', 'Start new project');
        newProject.append(newProjectIcon, newProjectLabel);
        newProject.addEventListener('click', () => { void this.host.onStartNewProject(); });

        const addRepo = document.createElement('button');
        addRepo.type = 'button';
        addRepo.className = 'theia-mobile-agents-hub-onboarding-btn theia-mod-ghost';
        const addRepoIcon = document.createElement('span');
        addRepoIcon.className = 'codicon codicon-repo-clone theia-mobile-agents-hub-onboarding-btn-icon';
        addRepoIcon.setAttribute('aria-hidden', 'true');
        const addRepoLabel = document.createElement('span');
        addRepoLabel.className = 'theia-mobile-agents-hub-onboarding-btn-label';
        addRepoLabel.textContent = nls.localize('qaap/mobileProjects/newRepository', 'Add repository');
        addRepo.append(addRepoIcon, addRepoLabel);
        addRepo.addEventListener('click', () => { void this.host.onNewClick(); });

        if (!this.isAgentsHubSignedIn()) {
            hint.textContent = nls.localize(
                'qaap/agentsHub/noProjectsSignIn',
                'Sign in with GitHub to see your repositories and agent sessions.',
            );
            newProject.classList.remove('theia-mod-primary');
            newProject.classList.add('theia-mod-ghost');
            actions.append(this.createAgentsHubGithubSignInButton());
        }
        actions.append(newProject, addRepo);

        root.append(mark, title, hint, actions);
        return root;
    }

    protected isAgentsHubSignedIn(): boolean {
        return this.host.readQaapSignedIn?.() ?? readQaapSignedIn();
    }

    protected createAgentsHubGithubSignInButton(): HTMLButtonElement {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theia-mobile-agents-hub-onboarding-btn theia-mod-primary theia-mobile-agents-hub-signin-btn';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-github theia-mobile-agents-hub-onboarding-btn-icon';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agents-hub-onboarding-btn-label';
        label.textContent = nls.localize('qaap/agentsHub/signIn', 'Sign in with GitHub');
        btn.append(icon, label);
        btn.addEventListener('click', () => startGithubOAuth());
        return btn;
    }

    /** Same transcript host for idle and active sessions; idle shows starter chips in the scroll area. */
    renderAgentsHubShellChat(
        chatHost: HTMLElement,
        _project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        const activeSummary = this.host.agentsHubInlineActive && this.host.transcriptOpenSummary
            ? this.host.transcriptOpenSummary
            : summary;
        const cachedRaw = this.host.agentsHubInlineActive
            && this.host.transcriptLastConv
            && this.host.transcriptLastConv.id === activeSummary.id
            ? this.host.transcriptLastConv
            : this.host.transcriptLiveUi.peekCachedOpenTranscript(activeSummary.id)
            ?? this.host.transcriptConversationCache.get(activeSummary.id);
        const cached = cachedRaw && this.host.transcriptLiveUi.isTrustedOpenTranscriptCache(cachedRaw, activeSummary)
            ? cachedRaw
            : undefined;
        const conv = cached
            ?? (activeSummary.status === 'streaming' && !isAgentsHubIdleConversationSummary(activeSummary)
                ? this.buildAgentsHubWorkingConversation(activeSummary)
                : this.host.transcriptSheetUi.summaryToTranscriptPlaceholder(activeSummary));
        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
    }

    protected buildAgentsHubWorkingConversation(summary: QaapAgentConversationSummaryDTO): QaapAgentConversationDTO {
        const placeholder = this.host.transcriptSheetUi.summaryToTranscriptPlaceholder(summary);
        return {
            ...placeholder,
            status: 'streaming',
            updatedAt: Math.max(placeholder.updatedAt, summary.updatedAt),
        };
    }

    buildOptimisticSubmitConversation(
        summary: QaapAgentConversationSummaryDTO,
        outbound: string,
        agentId?: string,
        imagePreviews?: readonly QaapTranscriptUserImagePreview[],
        contentOverride?: string,
    ): QaapAgentConversationDTO {
        const trimmed = outbound.trim();
        const cachedMessages = this.host.transcriptLastConv?.id === summary.id
            ? this.host.transcriptLastConv.messages
            : [];
        const pendingUserMessage = {
            id: `pending-user-${Date.now()}`,
            role: 'user' as const,
            // contentOverride carries the resolved outbound (attachment preamble included) so
            // context cards render on the optimistic row exactly like on the persisted row.
            content: contentOverride?.trim() || trimmed,
            createdAt: Date.now(),
            ...(imagePreviews?.length ? { optimisticImagePreviews: imagePreviews } : {}),
        };
        return {
            id: summary.id,
            cwd: summary.cwd,
            agentId: agentId ?? summary.agentId,
            title: trimmed.slice(0, 120) || summary.title,
            status: 'streaming',
            createdAt: summary.createdAt ?? Date.now(),
            updatedAt: Date.now(),
            messages: appendOptimisticPendingUserMessage(cachedMessages, pendingUserMessage),
        };
    }

    seedTranscriptOptimisticConversation(conv: QaapAgentConversationDTO): void {
        this.host.transcriptConversationCache.set(conv.id, conv);
        this.host.transcriptLastConv = conv;
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptLiveUi.seedTranscriptSemanticProgressClock();
    }

    seedTranscriptOptimisticSubmit(
        summary: QaapAgentConversationSummaryDTO,
        outbound: string,
        agentId?: string,
        imagePreviews?: readonly QaapTranscriptUserImagePreview[],
    ): void {
        this.seedTranscriptOptimisticConversation(
            this.buildOptimisticSubmitConversation(summary, outbound, agentId, imagePreviews),
        );
    }

    /**
     * Roll back a pre-create idle-submit optimistic paint after the server REJECTED the create
     * (e.g. 400 needs-project for a container cwd). Without this the optimistic "streaming"
     * conversation lingers under the idle id with no real task behind it, the stream-health
     * watchdog eventually shows "didn't respond in time", and Cancel/Retry/Stop have nothing
     * to act on. Only the idle placeholder is evicted — real conversations are untouched.
     */
    rollbackAgentsHubIdleSubmitOptimistic(): void {
        this.host.transcriptConversationCache.delete(QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID);
        if (this.host.transcriptLastConv?.id === QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID) {
            this.host.transcriptLastConv = undefined;
        }
        this.host.transcriptLastFingerprint = undefined;
        // Repaint only when the inline shell is mounted — ensureAgentsHubExecutionShell then takes
        // its reuse branch (no new root is appended to the scroll host).
        if (this.host.agentsHubInlineExecutionRoot?.isConnected && this.host.agentsHubInlineChatHost?.isConnected) {
            this.renderAgentsHubExecutionShell();
        }
    }

    renderAgentsHubIdleSubmitOptimistic(
        chatHost: HTMLElement,
        summary: QaapAgentConversationSummaryDTO,
        draft: string,
        agentId: string,
        imagePreviews?: readonly QaapTranscriptUserImagePreview[],
        contentOverride?: string,
    ): void {
        const outbound = draft.trim();
        if (!outbound && !imagePreviews?.length) {
            return;
        }
        const conv = this.buildOptimisticSubmitConversation(summary, outbound, agentId, imagePreviews, contentOverride);
        this.host.transcriptMessagesUi.renderTranscriptMessages(chatHost, conv);
        this.seedTranscriptOptimisticConversation(conv);
    }

    syncAgentsHubInlineExecutionHeader(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        const activeTab = this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(project);
        this.syncAgentsHubInlineSurfaceMode(activeTab);
        const projectChanged = this.agentsHubExecutionHeaderProjectId !== project.id;
        this.agentsHubExecutionHeaderProjectId = project.id;
        const existingStrip = this.host.agentsHubInlineTabStrip;
        if (existingStrip?.isConnected
            && !projectChanged
            && this.host.transcriptOpenSummaryId === summary.id) {
            this.host.executionSurfaceTabsUi.refreshExecutionSurfaceTabStripState(existingStrip, activeTab);
            this.host.executionSurfaceTabsUi.restoreActiveExecutionSurface(project, summary);
            this.host.executionSurfaceTabsUi.syncExecutionSurfaceChrome(project);
            this.host.transcriptSurfacesUi.syncHeaderPreviewRunButton(project, summary);
            this.host.root.classList.add('theia-mod-agents-hub-inline-active');
            this.host.root.classList.add('theia-mod-agents-hub-shell-active');
            return;
        }
        const tabStrip = this.host.executionSurfaceTabsUi.buildTranscriptTabStrip(project, summary);
        this.host.headerExecutionTabsHost.hidden = false;
        this.host.headerExecutionTabsHost.replaceChildren(tabStrip);
        this.host.agentsHubInlineTabStrip = tabStrip;
        this.host.transcriptTabStrip = tabStrip;
        this.host.executionSurfaceTabsUi.refreshExecutionSurfaceTabStripState(tabStrip, activeTab);
        this.host.executionSurfaceTabsUi.restoreActiveExecutionSurface(project, summary);
        this.host.executionSurfaceTabsUi.syncExecutionSurfaceChrome(project);
        this.host.transcriptSurfacesUi.syncHeaderPreviewRunButton(project, summary);
        this.host.root.classList.add('theia-mod-agents-hub-inline-active');
        this.host.root.classList.add('theia-mod-agents-hub-shell-active');
    }

    protected syncAgentsHubInlineSurfaceMode(activeTab: string): void {
        const isMessages = activeTab === 'messages';
        this.host.root.classList.toggle('theia-mod-project-surface-chat', isMessages);
        this.host.root.classList.toggle('theia-mod-project-surface-tools', !isMessages);
    }

    teardownAgentsHubExecutionShell(): void {
        this.host.agentsHubShellActive = false;
        this.host.agentsHubInlineActive = false;
        this.clearAgentsHubInlineExecutionChrome();
        this.host.agentsHubInlineChatHost = undefined;
        this.host.agentsHubInlineTranscriptRoot = undefined;
        this.host.transcriptChatHost = undefined;
        this.host.detachTranscriptReviewWidget();
        this.host.transcriptReviewHost = undefined;
        this.host.transcriptPreviewHost = undefined;
        this.agentsHubExecutionHeaderProjectId = undefined;
        this.host.disposeTranscriptEmbeddedPreview();
        this.host.transcriptFilesHost = undefined;
        this.host.transcriptTerminalHost = undefined;
        this.host.transcriptUserScrollPinDispose.dispose();
        this.host.transcriptUserScrollPinDispose = Disposable.NULL;
    }

    clearAgentsHubInlineExecutionChrome(): void {
        this.host.root.classList.remove('theia-mod-agents-hub-inline-active');
        this.host.root.classList.remove('theia-mod-agents-hub-shell-active');
        this.host.agentsHubInlineExecutionRoot = undefined;
        this.host.agentsHubInlineTabStrip = undefined;
        this.host.agentsHubInlineTranscriptRoot = undefined;
        this.host.headerExecutionTabsHost.hidden = true;
        this.host.headerExecutionTabsHost.replaceChildren();
        this.host.transcriptSurfacesUi.hideHeaderPreviewRunButton();
        this.host.headerPreviewRunHost.replaceChildren();
        this.host.transcriptSurfacesUi.hideHeaderFilesMoreButton();
        this.host.headerFilesMoreHost.replaceChildren();
        this.host.transcriptSurfacesUi.hideHeaderViewModeSwitch();
        this.host.headerViewModeSwitchHost.replaceChildren();
        if (this.host.transcriptReviewHost) {
            this.host.transcriptReviewHost.remove();
            this.host.transcriptPreviewHost?.remove();
            this.host.transcriptFilesHost?.remove();
            this.host.transcriptTerminalHost?.remove();
        }
        this.host.transcriptReviewHost = undefined;
        this.host.transcriptPreviewHost = undefined;
        this.host.transcriptFilesHost = undefined;
        this.host.transcriptTerminalHost = undefined;
        this.agentsHubExecutionHeaderProjectId = undefined;
    }

    protected isSameInlineTranscriptOpen(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): boolean {
        return this.host.agentsHubInlineActive
            && this.host.agentsHubShellActive
            && this.host.transcriptOpenSummaryId === summary.id
            && this.host.transcriptOpenProject?.id === project.id
            && !!this.host.agentsHubInlineExecutionRoot?.isConnected
            && !!this.host.agentsHubInlineChatHost?.isConnected;
    }

    /**
     * Merge the fresh summary status into a cached conversation document so the
     * inline transcript never shows a stale streaming/idle indicator on reopen.
     */
    protected syncCachedConversationStatus(
        conv: QaapAgentConversationDTO | undefined,
        summary: QaapAgentConversationSummaryDTO,
    ): QaapAgentConversationDTO | undefined {
        if (!conv || conv.status === summary.status) {
            return conv;
        }
        return { ...conv, status: summary.status, updatedAt: Math.max(conv.updatedAt, summary.updatedAt) };
    }

    async openAgentsHubInlineTranscript(
        project: MobileProjectEntry,
        summary: QaapAgentConversationSummaryDTO,
    ): Promise<void> {
        if (this.isSameInlineTranscriptOpen(project, summary)) {
            return;
        }
        const previousProject = this.host.transcriptOpenProject;
        const previousSummary = this.host.transcriptOpenSummary;
        if (this.host.transcriptLastConv) {
            this.host.transcriptConversationCache.set(this.host.transcriptLastConv.id, this.host.transcriptLastConv);
        }
        if (previousProject && previousSummary && previousSummary.id !== summary.id) {
            this.host.transcriptStickyComposerUi.flushTranscriptComposerDraft(previousSummary.id);
            void this.host.transcriptStickyComposerUi.flushTranscriptComposerPrefs(previousProject, previousSummary);
        }
        const cachedTargetConversation = this.host.transcriptLiveUi.peekCachedOpenTranscript(summary.id)
            ?? this.host.transcriptConversationCache.get(summary.id);
        if (this.host.agentsHubInlineActive) {
            this.host.replacingTranscriptSheet = true;
            this.closeAgentsHubSession();
            this.host.replacingTranscriptSheet = false;
        } else {
            this.host.replacingTranscriptSheet = true;
            this.host.transcriptSheetUi.closeTranscriptSheet();
            this.host.replacingTranscriptSheet = false;
        }
        this.host.agentsHubShellActive = true;
        this.host.agentsHubInlineActive = true;
        this.host.transcriptLastStatus = summary.status;
        this.host.transcriptOpenSummaryId = summary.id;
        this.host.transcriptOpenSummary = summary;
        this.host.transcriptOpenProject = project;
        this.host.transcriptComposerSummary = summary;
        this.host.transcriptLastConv = this.syncCachedConversationStatus(cachedTargetConversation, summary);
        this.host.transcriptLastFingerprint = undefined;
        if (this.host.visible) {
            this.host.renderHeader();
            this.host.renderSubtitle();
        }
        this.host.transcriptComposerPrefsConvId = undefined;
        this.host.transcriptComposerAgentModel = undefined;
        this.host.transcriptComposerMountKey = undefined;
        void this.host.transcriptComposerUi.refreshTranscriptComposerAgents(project);
        this.host.transcriptLiveUi.stopTranscriptLiveWatch();
        this.host.transcriptLastConv = this.syncCachedConversationStatus(cachedTargetConversation, summary);
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptLastSseDeltaAt = undefined;
        this.host.transcriptLiveUi.clearTranscriptSemanticProgressClock();
        const chatHost = this.ensureAgentsHubExecutionShell(project, summary);
        // Opening a real conversation (e.g. Annotate Send / first sticky submit) must land on
        // Messages — keeping Preview hid the user turn while the composer still showed working.
        const activeTab = isAgentsHubIdleConversationSummary(summary)
            ? this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(project)
            : 'messages';
        if (activeTab === 'messages') {
            this.host.executionSurfaceTabsUi.setExecutionSurfaceTab(project, 'messages');
        }
        this.host.executionSurfaceTabsUi.showOnlyExecutionSurfaceTab(activeTab);
        this.host.executionSurfaceTabsUi.mountTranscriptSurfaceTab(project, summary, activeTab);
        if (chatHost) {
            this.host.transcriptLiveUi.scheduleTranscriptConversationRefresh(project, summary, chatHost);
            this.renderAgentsHubShellChat(chatHost, project, summary);
            this.host.conversations?.prefetchDocument(summary.id);
        }
        this.host.stickyComposerRenderUi.renderStickyComposer();
    }

    /**
     * Clears optimistic/streaming transcript DOM on the idle Agents Hub shell (no inline session open).
     * Needed when "New agent" is tapped after an idle submit left a live activity row in the chat host.
     */
    resetAgentsHubIdleTranscriptShell(project: MobileProjectEntry): void {
        this.host.transcriptLiveUi.stopTranscriptLiveWatch();
        this.host.transcriptLastConv = undefined;
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptLiveUi.clearTranscriptSemanticProgressClock();
        this.host.transcriptLastSseDeltaAt = undefined;
        this.host.transcriptOpenSummaryId = undefined;
        this.host.transcriptOpenSummary = undefined;
        this.host.transcriptConversationCache.delete(QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID);
        this.host.transcriptUi.disposeList();
        const chatHost = this.host.agentsHubInlineChatHost;
        if (chatHost?.isConnected && this.host.agentsHubShellActive) {
            this.renderAgentsHubShellChat(
                chatHost,
                project,
                this.resolveAgentsHubShellSummary(project),
            );
        }
    }

    closeAgentsHubSession(): void {
        const closingProject = this.resolveAgentsHubShellProject();
        closingProject && this.host.executionSurfaceTabsUi.setExecutionSurfaceTab?.(closingProject, 'messages');
        if (this.host.transcriptLastConv) {
            this.host.transcriptConversationCache.set(this.host.transcriptLastConv.id, this.host.transcriptLastConv);
        }
        this.host.executionSurfaceTabsUi.closeExecutionTabOverflowMenu();
        this.host.transcriptComposerUi.closeTranscriptComposerSheets();
        this.host.transcriptComposerHost = undefined;
        this.host.transcriptComposerProject = undefined;
        this.host.transcriptComposerSummary = undefined;
        disposeComposerContextEntries(this.host.transcriptComposerContext);
        this.host.transcriptComposerContext = [];
        this.host.transcriptComposerPinnedAgentId = undefined;
        this.host.transcriptComposerAgentModel = undefined;
        this.host.transcriptComposerModeId = undefined;
        this.host.transcriptComposerApprovalPolicyId = undefined;
        this.host.transcriptComposerPrefsConvId = undefined;
        this.host.transcriptComposerDraft = '';
        if (this.host.transcriptComposerDraftPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerDraftPersistTimer);
            this.host.transcriptComposerDraftPersistTimer = undefined;
        }
        if (this.host.transcriptComposerPrefsPersistTimer !== undefined) {
            window.clearTimeout(this.host.transcriptComposerPrefsPersistTimer);
            this.host.transcriptComposerPrefsPersistTimer = undefined;
        }
        this.host.agentsHubInlineActive = false;
        this.host.transcriptOpenSummaryId = undefined;
        this.host.transcriptOpenSummary = undefined;
        this.host.transcriptOpenProject = undefined;
        this.host.transcriptLastFingerprint = undefined;
        this.host.transcriptLastConv = undefined;
        this.host.transcriptLastStatus = undefined;
        this.host.transcriptComposerMountKey = undefined;
        this.host.transcriptUi.disposeList();
        this.host.transcriptTheiaSessionByConversationId.clear();
        this.host.transcriptLiveUi.stopTranscriptLiveWatch();
        const chatHost = this.host.agentsHubInlineChatHost;
        const project = this.resolveAgentsHubShellProject();
        if (chatHost && project && this.host.agentsHubShellActive) {
            this.host.transcriptConversationCache.delete(QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID);
            this.renderAgentsHubShellChat(chatHost, project, this.resolveAgentsHubShellSummary(project));
        } else if (chatHost) {
            chatHost.replaceChildren();
        }
        if (this.host.visible) {
            this.host.renderHeader();
            this.host.renderSubtitle();
            if (!this.host.replacingTranscriptSheet) {
                this.host.renderList();
            }
        }
        if (!this.host.replacingTranscriptSheet) {
            this.host.notifyWorkspaceHubBottomBarRefresh();
        }
    }
}

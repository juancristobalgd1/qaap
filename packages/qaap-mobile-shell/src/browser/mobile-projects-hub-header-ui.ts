// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { scrollElementTo } from '../common/qaap-prefers-reduced-motion';
import { dismissQaapAccountMenu } from './qaap-workbench-account-menu';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { isAgentsHubIdleConversationSummary } from '../common/qaap-agents-hub-landing';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import { shouldShowTranscriptEmptyQuickActions } from '../common/qaap-transcript-turn-status';
import type { MobileProjectEntry, MobileProjectsHubView } from './mobile-projects-types';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptSheetUi } from './mobile-projects-transcript-sheet-ui';
import { layoutHeaderProjectClusterContents } from './mobile-projects-panel-chrome-ui';
import type { MobileProjectsPullRequestDetailTab } from './mobile-projects-pull-request-detail-ui';

export interface MobileProjectsHubHeaderHost {
    sessionsMenuBtn: HTMLButtonElement;
    headerProjectCluster: HTMLElement;
    headerProjectBtn: HTMLButtonElement;
    headerProjectLabelEl: HTMLSpanElement;
    headerConversationsBtn: HTMLButtonElement;
    headerNewChatBtn: HTMLButtonElement;
    headerOverflowMenuBtn: HTMLButtonElement;
    headerBackBtn: HTMLButtonElement;
    titleBlock: HTMLElement;
    titleEl: HTMLHeadingElement;
    titleAttentionEl: HTMLSpanElement;
    accountBtn: HTMLButtonElement;
    homeMode: boolean;
    hubView: MobileProjectsHubView;
    agentsHubInlineActive: boolean;
    agentsHubShellActive: boolean;
    transcriptOpenProject: MobileProjectEntry | undefined;
    transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    transcriptLastConv?: QaapAgentConversationDTO | undefined;
    projects: MobileProjectEntry[];
    pullRequestDetail?: import('@theia/qaap-adapters/lib/common/qaap-github-api-types').QaapGithubPullRequestSummary;
    pullRequestHeaderEl?: HTMLElement;

    isProjectDetailView(): boolean;
    isProjectDiffView(): boolean;
    shouldUseAgentsHubLanding(): boolean;
    resolveAgentsHubShellProject(): MobileProjectEntry | undefined;
    resolveHomePinnedProject(): MobileProjectEntry | undefined;
    cardMenuUi: {
        buildConversationMenu(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): HTMLElement;
        toggleCardMenu(card: HTMLElement, menu: HTMLElement, menuBtn: HTMLButtonElement): void;
    };
    conversationIndexUi: {
        conversationsForProject(project: MobileProjectEntry): QaapAgentConversationSummaryDTO[];
    };
    composerHeaderUi: import('./mobile-projects-composer-header-ui').MobileProjectsComposerHeaderUi;
    hubQueryUi: import('./mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    projectNavigationUi: import('./mobile-projects-project-navigation-ui').MobileProjectsProjectNavigationUi;
    transcriptHeaderUi: MobileProjectsTranscriptHeaderUi;
    transcriptSheetUi: MobileProjectsTranscriptSheetUi;
    executionSurfaceTabsUi: MobileProjectsExecutionSurfaceTabsUi;
    updateTasksAttentionChrome(): void;
    buildHomeGreeting(): string;
    scroll: HTMLElement;
    lastTitleTap: number;

    closeAgentsHubSession(): void;
    closeProjectDiffView(): void;
    closeProjectDetail(): void;
    openWorkHubSessionsSidebar(): void;
    isPullRequestsSidebarVisible?(): boolean;
    isPullRequestsSidebarOpen?(): boolean;
    pullRequestDetailActiveTab?(): MobileProjectsPullRequestDetailTab;
    setPullRequestDetailTab?(tab: MobileProjectsPullRequestDetailTab): void;
    openPullRequestChat?(): void;
    togglePullRequestMerge?(): void;
    closePullRequestDetail?(): void;
}

export class MobileProjectsHubHeaderUi {
    constructor(protected readonly host: MobileProjectsHubHeaderHost) { }

    renderHeader(): void {
        if (this.host.pullRequestDetail || this.host.isPullRequestsSidebarVisible?.() === true) {
            this.renderPullRequestHeader();
            return;
        }
        if (this.host.pullRequestHeaderEl) {
            this.host.pullRequestHeaderEl.hidden = true;
            this.host.pullRequestHeaderEl.setAttribute('aria-hidden', 'true');
        }
        // Reset title visibility at the top; the inline-session branch may re-hide it below.
        this.host.titleEl.classList.remove('theia-mod-sr-only');
        const inProjectDetail = this.host.isProjectDetailView();
        const inProjectDiff = this.host.isProjectDiffView();
        const showSessionsMenu = this.host.homeMode
            && this.host.hubView === 'tasks'
            && this.host.shouldUseAgentsHubLanding()
            && !inProjectDetail
            && !inProjectDiff;
        this.host.sessionsMenuBtn.hidden = !showSessionsMenu;
        this.host.sessionsMenuBtn.setAttribute('aria-hidden', showSessionsMenu ? 'false' : 'true');
        this.syncHeaderProjectControl(showSessionsMenu);
        const showNewChatBtn = showSessionsMenu && this.resolveHeaderNewChatVisible();
        this.host.headerNewChatBtn.hidden = !showNewChatBtn;
        this.host.headerNewChatBtn.setAttribute('aria-hidden', showNewChatBtn ? 'false' : 'true');
        const showOverflowMenuBtn = showSessionsMenu && this.resolveHeaderOverflowMenuVisible();
        this.host.headerOverflowMenuBtn.hidden = !showOverflowMenuBtn;
        this.host.headerOverflowMenuBtn.setAttribute('aria-hidden', showOverflowMenuBtn ? 'false' : 'true');
        const showHeaderBack = inProjectDetail
            || inProjectDiff
            || this.host.hubQueryUi.isSidebarSecondaryHubView()
            || (this.host.agentsHubInlineActive && !this.host.shouldUseAgentsHubLanding());
        this.host.headerBackBtn.hidden = !showHeaderBack;
        this.host.headerBackBtn.setAttribute('aria-hidden', showHeaderBack ? 'false' : 'true');
        this.host.titleBlock.classList.toggle('theia-mod-with-back', showHeaderBack);
        if (this.host.hubQueryUi.isSidebarSecondaryHubView()) {
            this.host.headerBackBtn.title = nls.localize('qaap/mobileProjects/backToAgents', 'Back to agents');
            this.host.headerBackBtn.setAttribute('aria-label', this.host.headerBackBtn.title);
        } else if (inProjectDiff) {
            this.host.headerBackBtn.title = nls.localize('qaap/diff/backToProject', 'Back to project');
            this.host.headerBackBtn.setAttribute('aria-label', this.host.headerBackBtn.title);
        } else {
            this.host.headerBackBtn.title = nls.localize('qaap/mobileProjects/backToProjects', 'Back to projects');
            this.host.headerBackBtn.setAttribute('aria-label', this.host.headerBackBtn.title);
        }

        if (this.host.hubView === 'diff') {
            this.host.titleEl.textContent = nls.localize('qaap/diff/reviewLabel', 'Working changes');
            return;
        }
        if (this.host.hubView === 'chat') {
            this.host.titleEl.textContent = nls.localize('qaap/mobileProjects/chatTitle', 'Chat');
            return;
        }
        if (this.host.hubView === 'tasks') {
            const useAgentsHubLanding = this.host.shouldUseAgentsHubLanding();
            if (this.host.agentsHubInlineActive && this.host.transcriptOpenProject && this.host.transcriptOpenSummary) {
                const transcriptTitle = this.host.transcriptHeaderUi.resolveTranscriptHeaderTitle(
                    this.host.transcriptOpenProject,
                    this.host.transcriptOpenSummary,
                );
                // Keep textContent for screen readers (the element is sr-only, not aria-hidden).
                this.host.titleEl.textContent = transcriptTitle;
                this.host.titleEl.classList.add('theia-mod-sr-only');
            } else {
                this.host.titleEl.textContent = useAgentsHubLanding
                    ? nls.localize('qaap/mobileBottomBar/hubAgents', 'Agents')
                    : nls.localize('qaap/mobileProjects/tasksHubTitle', 'Tasks');
                if (useAgentsHubLanding) {
                    this.host.titleEl.classList.add('theia-mod-sr-only');
                }
            }
            this.host.updateTasksAttentionChrome();
            return;
        }
        if (this.host.hubView === 'review') {
            this.host.titleEl.textContent = nls.localize('qaap/mobileProjects/reviewHubTitle', 'Review');
            this.host.titleAttentionEl.hidden = true;
            this.host.titleAttentionEl.setAttribute('aria-hidden', 'true');
            return;
        }
        if (this.host.hubView === 'workflows') {
            this.host.titleEl.textContent = nls.localize('qaap/mobileProjects/workflowsTitle', 'Workflows');
            return;
        }
        if (this.host.homeMode && this.host.hubView === 'home') {
            this.host.titleEl.textContent = this.host.buildHomeGreeting();
            this.host.titleAttentionEl.hidden = true;
            this.host.titleAttentionEl.setAttribute('aria-hidden', 'true');
            return;
        }
        this.host.titleAttentionEl.hidden = true;
        if (inProjectDetail) {
            this.host.titleEl.textContent = this.projectDetailHeaderTitle(this.host.projectNavigationUi.resolveSelectedProject());
            return;
        }
        if (this.host.homeMode && this.host.hubView === 'repos') {
            this.host.titleEl.textContent = nls.localize('qaap/mobileProjects/projectsTitle', 'Projects');
            return;
        }
        if (this.host.homeMode) {
            const appName = FrontendApplicationConfigProvider.get().applicationName?.trim();
            this.host.titleEl.textContent = appName || nls.localize('qaap/mobileProjects/title', 'Work Hub');
            return;
        }
        this.host.titleEl.textContent = nls.localize('qaap/mobileProjects/title', 'Work Hub');
        this.syncAgentsHubAccountChrome();
    }

    protected renderPullRequestHeader(): void {
        const header = this.host.pullRequestHeaderEl;
        if (!header) {
            return;
        }
        const pullRequest = this.host.pullRequestDetail;
        const sidebarVisible = this.host.isPullRequestsSidebarOpen?.()
            ?? this.host.isPullRequestsSidebarVisible?.() === true;
        header.hidden = false;
        header.setAttribute('aria-hidden', 'false');
        header.replaceChildren();

        const leading = document.createElement('div');
        leading.className = 'theia-mobile-work-hub-pull-request-header-leading';
        if (!sidebarVisible) {
            const openSidebar = document.createElement('button');
            openSidebar.type = 'button';
            openSidebar.className = 'theia-mobile-work-hub-pull-request-header-sidebar-toggle';
            openSidebar.title = nls.localize('qaap/pullRequests/openSidebar', 'Open pull requests sidebar');
            openSidebar.setAttribute('aria-label', openSidebar.title);
            openSidebar.innerHTML = '<span class="codicon codicon-layout-sidebar-left" aria-hidden="true"></span>';
            openSidebar.addEventListener('click', () => this.host.openWorkHubSessionsSidebar());
            leading.append(openSidebar);
        }

        if (pullRequest && !sidebarVisible) {
            const back = document.createElement('button');
            back.type = 'button';
            back.className = 'theia-mobile-work-hub-pull-request-header-back';
            back.title = nls.localize('qaap/pullRequests/backToList', 'Back to pull requests');
            back.setAttribute('aria-label', back.title);
            back.innerHTML = '<span class="codicon codicon-chevron-left" aria-hidden="true"></span>';
            back.addEventListener('click', () => this.host.closePullRequestDetail?.());
            leading.append(back);
        }

        const status = document.createElement('span');
        status.className = 'theia-mobile-work-hub-pull-request-header-status codicon codicon-git-pull-request';
        status.setAttribute('aria-hidden', 'true');
        if (pullRequest?.state === 'merged') {
            status.classList.add('theia-mod-merged');
            status.classList.replace('codicon-git-pull-request', 'codicon-git-merge');
        }
        leading.append(status);

        if (!pullRequest) {
            const title = document.createElement('strong');
            title.textContent = nls.localize('qaap/pullRequests/headerTitle', 'Pull requests');
            leading.append(title);
            header.append(leading);
            return;
        }

        const tabs = document.createElement('div');
        tabs.className = 'theia-mobile-work-hub-pull-request-header-tabs';
        const activeTab = this.host.pullRequestDetailActiveTab?.() ?? 'summary';
        for (const tab of [
            ['summary', nls.localize('qaap/pullRequests/summary', 'Summary')],
            ['code', nls.localize('qaap/pullRequests/code', 'Code')],
        ] as const) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-mobile-work-hub-pull-request-header-tab';
            button.textContent = tab[1];
            button.classList.toggle('theia-mod-active', activeTab === tab[0]);
            button.setAttribute('aria-selected', String(activeTab === tab[0]));
            button.setAttribute('role', 'tab');
            button.addEventListener('click', () => this.host.setPullRequestDetailTab?.(tab[0]));
            tabs.append(button);
        }
        leading.append(tabs);

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-work-hub-pull-request-header-actions';
        const external = document.createElement('a');
        external.className = 'theia-mobile-work-hub-pull-request-detail-icon-button';
        external.href = pullRequest.htmlUrl;
        external.target = '_blank';
        external.rel = 'noreferrer';
        external.title = nls.localize('qaap/pullRequests/openOnGithub', 'Open on GitHub');
        external.setAttribute('aria-label', external.title);
        external.innerHTML = '<span class="codicon codicon-link-external" aria-hidden="true"></span>';
        const chat = this.createPullRequestHeaderButton(
            nls.localize('qaap/pullRequests/openChat', 'Open chat'),
            'theia-mobile-work-hub-pull-request-chat-button',
            () => this.host.openPullRequestChat?.(),
        );
        const merge = this.createPullRequestHeaderButton(
            pullRequest.state === 'merged'
                ? nls.localize('qaap/pullRequests/merged', 'Merged')
                : nls.localize('qaap/pullRequests/merge', 'Merge'),
            'theia-mobile-work-hub-pull-request-merge-button',
            () => this.host.togglePullRequestMerge?.(),
        );
        merge.disabled = pullRequest.state === 'merged' || pullRequest.mergeable === false;
        const mergeChevron = document.createElement('span');
        mergeChevron.className = 'codicon codicon-chevron-down';
        mergeChevron.setAttribute('aria-hidden', 'true');
        merge.append(mergeChevron);
        actions.append(external, chat, merge);
        header.append(leading, actions);
    }

    protected createPullRequestHeaderButton(label: string, className: string, onClick: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    syncHeaderProjectControl(showSessionsMenu: boolean): void {
        const project = this.resolveHeaderProject();
        const compact = this.shouldUseCompactHeaderProjectControl();
        const conversationTitle = this.resolveHeaderProjectConversationTitle();
        const projectName = project?.name?.trim() ?? '';
        const sectionTitle = compact ? projectName : (conversationTitle || projectName);
        const showProject = showSessionsMenu && !!project && sectionTitle.length > 0;
        const showConversationSeparator = showProject && !compact && this.headerProjectShowsConversationTitle();
        this.host.headerProjectCluster.hidden = !showProject;
        this.host.headerProjectCluster.setAttribute('aria-hidden', showProject ? 'false' : 'true');
        this.host.headerProjectCluster.classList.toggle('theia-mod-conversation-title', showConversationSeparator);
        this.host.headerProjectCluster.classList.toggle('theia-mod-compact-project', showProject && compact);
        this.host.headerProjectLabelEl.textContent = sectionTitle;
        layoutHeaderProjectClusterContents(
            this.host.headerProjectBtn,
            this.host.headerConversationsBtn,
            this.host.headerProjectLabelEl,
            showProject && compact,
        );
        this.host.headerConversationsBtn.hidden = !showProject || compact;
        this.host.headerConversationsBtn.setAttribute('aria-hidden', (!showProject || compact) ? 'true' : 'false');
        if (!showProject || !project) {
            return;
        }
        const aria = nls.localize('qaap/composerWorkspace/projectAria', 'Project: {0}', project.name);
        this.host.headerProjectBtn.title = aria;
        this.host.headerProjectBtn.setAttribute('aria-label', aria);
        const conversationsAria = nls.localize('qaap/mobileProjects/taskMenu', 'Task options');
        this.host.headerConversationsBtn.title = conversationsAria;
        this.host.headerConversationsBtn.setAttribute('aria-label', conversationsAria);
        this.host.headerConversationsBtn.setAttribute('aria-haspopup', 'menu');
    }

    /**
     * Empty landing, idle placeholder, pending new chat, or a conversation with
     * no messages yet: folder + project name + one chevron to the repo sheet.
     */
    shouldUseCompactHeaderProjectControl(): boolean {
        if (!this.host.agentsHubInlineActive) {
            return true;
        }
        const summary = this.host.transcriptOpenSummary;
        if (!summary) {
            return true;
        }
        if (isAgentsHubIdleConversationSummary(summary)) {
            return true;
        }
        if (summary.id.startsWith('pending-new-chat-')) {
            return true;
        }
        const cached = this.host.transcriptLastConv?.id === summary.id
            ? this.host.transcriptLastConv
            : undefined;
        if (cached) {
            return shouldShowTranscriptEmptyQuickActions(cached, cached);
        }
        if (typeof summary.messageCount === 'number') {
            return summary.messageCount === 0 && summary.status !== 'streaming';
        }
        return !summary.title?.trim();
    }

    resolveHeaderConversationMenuTarget(): {
        project: MobileProjectEntry;
        summary: QaapAgentConversationSummaryDTO;
    } | undefined {
        if (this.host.agentsHubInlineActive && this.host.transcriptOpenProject && this.host.transcriptOpenSummary) {
            return {
                project: this.host.transcriptOpenProject,
                summary: this.host.transcriptOpenSummary,
            };
        }
        const project = this.resolveHeaderProject();
        if (!project) {
            return undefined;
        }
        const summary = this.host.conversationIndexUi.conversationsForProject(project)[0];
        if (!summary) {
            return undefined;
        }
        return { project, summary };
    }

    openHeaderConversationMenu(anchor: HTMLButtonElement): void {
        const target = this.resolveHeaderConversationMenuTarget();
        if (!target) {
            return;
        }
        const menu = this.host.cardMenuUi.buildConversationMenu(target.project, target.summary);
        this.host.cardMenuUi.toggleCardMenu(this.host.headerProjectCluster, menu, anchor);
    }

    resolveHeaderProject(): MobileProjectEntry | undefined {
        if (this.host.agentsHubInlineActive && this.host.transcriptOpenProject) {
            return this.host.transcriptOpenProject;
        }
        if (this.host.agentsHubShellActive) {
            const shellProject = this.host.resolveAgentsHubShellProject();
            if (shellProject) {
                return shellProject;
            }
        }
        return this.host.composerHeaderUi.resolveStickyComposerProject(this.host.projects)
            ?? this.host.resolveHomePinnedProject();
    }

    /**
     * Conversation title when an inline session is open; otherwise empty so the
     * header can fall back to the project name. Compact empty/new chats keep the
     * project name on the switcher so one chevron opens the repo sheet.
     */
    resolveHeaderProjectConversationTitle(): string {
        if (this.shouldUseCompactHeaderProjectControl()) {
            return '';
        }
        if (this.host.agentsHubInlineActive && this.host.transcriptOpenSummary) {
            return this.host.transcriptOpenSummary.title?.trim() ?? '';
        }
        return '';
    }

    /**
     * Short section label next to the project switcher: conversation title when a session is open,
     * otherwise the active project name.
     */
    resolveHeaderProjectSectionTitle(project: MobileProjectEntry | undefined): string {
        if (this.headerProjectShowsConversationTitle()) {
            return this.host.transcriptOpenSummary?.title?.trim() ?? '';
        }
        return project?.name?.trim() ?? '';
    }

    /** Folder glyph stands for the project; `|` splits it from the open conversation title. */
    headerProjectShowsConversationTitle(): boolean {
        return !this.shouldUseCompactHeaderProjectControl()
            && !!(this.host.agentsHubInlineActive && this.host.transcriptOpenSummary?.title?.trim());
    }

    resolveHeaderNewChatVisible(): boolean {
        if (!this.host.shouldUseAgentsHubLanding()) {
            return false;
        }
        const project = this.resolveHeaderNewChatProject();
        if (!project) {
            return false;
        }
        return this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(project) === 'messages';
    }

    resolveHeaderOverflowMenuVisible(): boolean {
        return this.resolveHeaderNewChatVisible();
    }

    protected resolveHeaderNewChatProject(): MobileProjectEntry | undefined {
        if (this.host.agentsHubInlineActive && this.host.transcriptOpenProject) {
            return this.host.transcriptOpenProject;
        }
        if (this.host.agentsHubShellActive) {
            return this.host.resolveAgentsHubShellProject();
        }
        return undefined;
    }

    syncAgentsHubAccountChrome(): void {
        const signedIn = this.readQaapSignedIn();
        this.host.accountBtn.closest('.theia-mobile-projects')?.classList.toggle('theia-mod-signed-out', !signedIn);
        const hideAccount = signedIn && this.host.homeMode && (
            (this.host.hubView === 'tasks' && this.host.shouldUseAgentsHubLanding())
            || this.host.hubQueryUi.isSidebarSecondaryHubView()
        );
        this.host.accountBtn.hidden = hideAccount;
        this.host.accountBtn.style.display = hideAccount ? 'none' : '';
        this.host.accountBtn.setAttribute('aria-hidden', hideAccount ? 'true' : 'false');
        if (hideAccount) {
            dismissQaapAccountMenu();
        }
    }

    readQaapSignedIn(): boolean {
        return readQaapSignedIn();
    }

    projectDetailHeaderTitle(project: MobileProjectEntry | undefined): string {
        if (!project) {
            return nls.localize('qaap/mobileProjects/tasksTitle', 'Tasks');
        }
        return project.name;
    }

    onTitleTap(): void {
        const now = Date.now();
        if (now - this.host.lastTitleTap < 320) {
            scrollElementTo(this.host.scroll, 0, 'smooth');
            this.host.lastTitleTap = 0;
        } else {
            this.host.lastTitleTap = now;
        }
    }

    handleHeaderBackClick(): void {
        // In the inline agents-hub flow, Back used to tear down the whole transcript from any tool
        // surface. Instead, from a tool surface (Plan/Changes/Preview/Files/Terminal) return to
        // Messages first — matching the surface stack the user walked in — and only close the
        // session/transcript once already on Messages. navigateExecutionSurfaceBack is self-guarding
        // (false unless a non-Messages transcript tab is active), so Messages falls through to close.
        if (this.host.agentsHubInlineActive) {
            const inlineProject = this.host.projectNavigationUi.resolveSelectedProject();
            if (inlineProject && this.host.executionSurfaceTabsUi.navigateExecutionSurfaceBack(inlineProject)) {
                return;
            }
        }
        if (this.host.agentsHubInlineActive && this.host.shouldUseAgentsHubLanding()) {
            this.host.closeAgentsHubSession();
            return;
        }
        if (this.host.agentsHubInlineActive) {
            this.host.transcriptSheetUi.closeTranscriptSheet();
            return;
        }
        if (this.host.hubQueryUi.isSidebarSecondaryHubView()) {
            this.host.hubQueryUi.navigateBackFromSidebarSecondaryHub();
            return;
        }
        if (this.host.isProjectDiffView()) {
            this.host.closeProjectDiffView();
            return;
        }
        const project = this.host.projectNavigationUi.resolveSelectedProject();
        if (project && this.host.executionSurfaceTabsUi.navigateExecutionSurfaceBack(project)) {
            return;
        }
        this.host.closeProjectDetail();
    }

}

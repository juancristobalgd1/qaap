// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { scrollElementTo } from '../common/qaap-prefers-reduced-motion';
import { dismissQaapAccountMenu } from './qaap-workbench-account-menu';
import { readQaapSignedIn } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry, MobileProjectsHubView } from './mobile-projects-types';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';
import type { MobileProjectsTranscriptHeaderUi } from './mobile-projects-transcript-header-ui';
import type { MobileProjectsTranscriptSheetUi } from './mobile-projects-transcript-sheet-ui';

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
    projects: MobileProjectEntry[];

    isProjectDetailView(): boolean;
    isProjectDiffView(): boolean;
    shouldUseAgentsHubLanding(): boolean;
    resolveAgentsHubShellProject(): MobileProjectEntry | undefined;
    resolveHomePinnedProject(): MobileProjectEntry | undefined;
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
}

export class MobileProjectsHubHeaderUi {
    constructor(protected readonly host: MobileProjectsHubHeaderHost) { }

    renderHeader(): void {
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

    syncHeaderProjectControl(showSessionsMenu: boolean): void {
        const project = this.resolveHeaderProject();
        const sectionTitle = this.resolveHeaderProjectSectionTitle(project);
        const showProject = showSessionsMenu && !!project && sectionTitle.length > 0;
        const showConversationSeparator = showProject && this.headerProjectShowsConversationTitle();
        this.host.headerProjectCluster.hidden = !showProject;
        this.host.headerProjectCluster.setAttribute('aria-hidden', showProject ? 'false' : 'true');
        this.host.headerProjectCluster.classList.toggle('theia-mod-conversation-title', showConversationSeparator);
        this.host.headerProjectLabelEl.textContent = sectionTitle;
        const separator = this.host.headerProjectCluster.querySelector('.theia-mobile-projects-header-project-separator');
        if (separator instanceof HTMLElement) {
            separator.hidden = !showConversationSeparator;
        }
        if (!showProject || !project) {
            return;
        }
        const aria = nls.localize('qaap/composerWorkspace/projectAria', 'Project: {0}', project.name);
        this.host.headerProjectBtn.title = aria;
        this.host.headerProjectBtn.setAttribute('aria-label', aria);
        const conversationsAria = nls.localize('qaap/sessionsSidebar/open', 'Open session history');
        this.host.headerConversationsBtn.title = conversationsAria;
        this.host.headerConversationsBtn.setAttribute('aria-label', conversationsAria);
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
     * Short section label next to the project switcher: conversation title when a session is open,
     * otherwise the active project name. Clicking the control still opens the project switcher.
     */
    resolveHeaderProjectSectionTitle(project: MobileProjectEntry | undefined): string {
        if (this.headerProjectShowsConversationTitle()) {
            return this.host.transcriptOpenSummary?.title?.trim() ?? '';
        }
        return project?.name?.trim() ?? '';
    }

    /** Folder glyph stands for the project; `|` splits it from the open conversation title. */
    headerProjectShowsConversationTitle(): boolean {
        return !!(this.host.agentsHubInlineActive && this.host.transcriptOpenSummary?.title?.trim());
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

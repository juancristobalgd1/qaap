// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { MobileProjectEntry, MobileProjectsHubView } from './mobile-projects-types';
import type { MobileWorkHubSessionsSidebar } from './mobile-work-hub-sessions-sidebar';
import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';

export interface MobileProjectsHubRenderHost {
    root: HTMLElement;
    hubView: MobileProjectsHubView;
    agentsHubShellActive: boolean;
    transcriptSheet: HTMLElement | undefined;
    transcriptOpenProject: MobileProjectEntry | undefined;
    sessionsSidebar: MobileWorkHubSessionsSidebar | undefined;

    isProjectDiffView(): boolean;
    shouldUseAgentsHubLanding(): boolean;
    isProjectDetailView(): boolean;
    resolveAgentsHubShellProject(): MobileProjectEntry | undefined;
    projectNavigationUi: import('./mobile-projects-project-navigation-ui').MobileProjectsProjectNavigationUi;
    executionSurfaceTabsUi: MobileProjectsExecutionSurfaceTabsUi;
    renderHeader(): void;
    renderSubtitle(): void;
    composerHeaderUi: import('./mobile-projects-composer-header-ui').MobileProjectsComposerHeaderUi;
    syncHubViewAvailability(): void;
    renderFilters(): void;
    renderList(): void;
    isAgentsHubExecutionSurfaceReady(): boolean;
    ensureAgentsHubExecutionShellRendered(): void;
}

export class MobileProjectsHubRenderUi {
    constructor(protected readonly host: MobileProjectsHubRenderHost) { }

    render(): void {
        this.host.root.classList.toggle('theia-mod-hub-home', this.host.hubView === 'home');
        this.host.root.classList.toggle('theia-mod-hub-diff', this.host.hubView === 'diff');
        this.host.root.classList.toggle('theia-mod-hub-project-diff', this.host.isProjectDiffView());
        this.host.root.classList.toggle('theia-mod-hub-inbox', this.host.hubView === 'tasks');
        this.host.root.classList.toggle('theia-mod-hub-tasks', this.host.hubView === 'tasks');
        this.host.root.classList.toggle('theia-mod-hub-review', this.host.hubView === 'review');
        this.host.root.classList.toggle('theia-mod-hub-chat', this.host.hubView === 'chat');
        this.host.root.classList.toggle('theia-mod-hub-workflows', this.host.hubView === 'workflows');
        this.host.root.classList.toggle('theia-mod-hub-repos', this.host.hubView === 'repos');
        this.host.root.classList.toggle('theia-mod-agents-hub-landing', this.host.shouldUseAgentsHubLanding());
        this.host.root.classList.toggle('theia-mod-project-detail', this.host.isProjectDetailView());
        const detailProject = this.host.projectNavigationUi.resolveSelectedProject();
        const detailTab = detailProject ? this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(detailProject) : 'messages';
        const agentsShellProject = this.host.agentsHubShellActive
            ? this.host.resolveAgentsHubShellProject()
            : undefined;
        const agentsShellTab = agentsShellProject
            ? this.host.executionSurfaceTabsUi.executionSurfaceTabForProject(agentsShellProject)
            : 'messages';
        this.host.root.classList.toggle(
            'theia-mod-project-surface-chat',
            (this.host.isProjectDetailView() && detailTab === 'messages')
            || (!!agentsShellProject && agentsShellTab === 'messages'),
        );
        this.host.root.classList.toggle(
            'theia-mod-project-surface-tools',
            (this.host.isProjectDetailView() && detailTab !== 'messages')
            || (!!agentsShellProject && agentsShellTab !== 'messages'),
        );
        this.host.renderHeader();
        this.host.renderSubtitle();
        this.host.composerHeaderUi.syncHeaderComposerSurfacePicker();
        this.host.executionSurfaceTabsUi.syncHeaderExecutionTabStrip();
        if (this.host.transcriptSheet && this.host.transcriptOpenProject) {
            this.host.executionSurfaceTabsUi.syncExecutionSurfaceChrome(this.host.transcriptOpenProject);
        }
        this.host.syncHubViewAvailability();
        this.host.renderFilters();
        this.host.renderList();
        if (this.host.shouldUseAgentsHubLanding() && !this.isAgentsHubExecutionSurfacePainted()) {
            this.host.ensureAgentsHubExecutionShellRendered();
        }
        const activeProject = this.host.agentsHubShellActive
            ? this.host.resolveAgentsHubShellProject()
            : this.host.isProjectDetailView()
                ? this.host.projectNavigationUi.resolveSelectedProject()
                : undefined;
        if (activeProject) {
            // Header/list renders are not navigation. Re-apply the project-owned surface so a
            // Files mount or shell rebuild cannot silently restore Chat.
            this.host.executionSurfaceTabsUi.restoreActiveExecutionSurface(activeProject);
        }
        if (this.host.sessionsSidebar?.isVisible()) {
            this.host.sessionsSidebar.scheduleRefreshList();
        }
    }

    protected isAgentsHubExecutionSurfacePainted(): boolean {
        return this.host.root.querySelector(
            '.theia-mobile-agents-hub-inline-execution, .theia-mobile-tasks-hub-root.theia-mod-agents-loading, .theia-mobile-agent-transcript-empty',
        ) !== null;
    }

    syncHubViewAvailability(): void {
        // Inbox is PRs + optional agent threads; keep the tab even when the VPS conversation service is absent.
    }

}

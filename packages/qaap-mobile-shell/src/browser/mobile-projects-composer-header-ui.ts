// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { type MobileViewToggleId } from './qaap-workbench-account-menu';
import { writeStoredComposerSurface, type QaapComposerSurface } from '../common/qaap-composer-surface';
import { QAAP_PRIMARY_AGENT_ID, writeStoredAgent } from '../common/qaap-agent-task-client';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry, MobileProjectFilter } from './mobile-projects-types';
import type { MobileBottomButtonId } from './mobile-shell-bottom-bar-widget';

export interface MobileProjectsComposerHeaderHost {
    visible: boolean;
    hubView: import('./mobile-projects-types').MobileProjectsHubView;
    root: HTMLElement;
    stickyComposerHost: HTMLElement;
    headerSurfacePickerHost: HTMLElement;
    accountBtn: HTMLButtonElement;
    headerSurfacePicker: import('./qaap-mobile-form-ui').QaapSegmentedFieldController<MobileBottomButtonId> | undefined;
    stickyComposerSurface: QaapComposerSurface;
    tasksHubSurface: QaapComposerSurface;
    stickyComposerFabLiftPx: number;
    projects: MobileProjectEntry[];
    filter: MobileProjectFilter;
    preparedCwdByProjectId: Map<string, string>;

    isProjectDetailView(): boolean;
    syncAgentsHubAccountChrome(): void;
    hubQueryUi: import('./mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    projectNavigationUi: import('./mobile-projects-project-navigation-ui').MobileProjectsProjectNavigationUi;
    projectsService: import('./mobile-projects-service').MobileProjectsService;
    stickyComposerPinnedAgentId: string | undefined;
    stickyComposerRenderUi: import('./mobile-projects-sticky-composer-render-ui').MobileProjectsStickyComposerRenderUi;
    commands: import('@theia/core/lib/common/command').CommandRegistry;
    renderList(): void;
    renderSubtitle(): void;
    shouldUseAgentsHubLanding(): boolean;
    resolveHomePinnedProject(): MobileProjectEntry | undefined;
    isAgentsHubExecutionSurfaceReady(): boolean;
    ensureAgentsHubExecutionShellRendered(): void;
}

export class MobileProjectsComposerHeaderUi {
    constructor(protected readonly host: MobileProjectsComposerHeaderHost) { }

    composerSurfaceSegmentOptions(): Array<{ id: MobileBottomButtonId; label: string; iconClass: string }> {
        return [
            {
                id: 'editor',
                label: nls.localize('qaap/mobileBottomBar/editor', 'Editor'),
                iconClass: 'codicon-layout',
            },
            {
                id: 'agent',
                label: nls.localize('theia/core/mobileBottomBar/agent', 'Agent'),
                iconClass: 'codicon-comment-discussion',
            },
        ];
    }

    shouldShowHeaderComposerSurfacePicker(): boolean {
        return this.host.visible
            && this.host.hubQueryUi.isTasksHubView()
            && this.host.shouldUseAgentsHubLanding();
    }

    syncHeaderComposerSurfacePicker(): void {
        this.host.headerSurfacePickerHost.hidden = true;
        this.host.headerSurfacePickerHost.replaceChildren();
        this.host.headerSurfacePicker = undefined;
        this.host.syncAgentsHubAccountChrome();
    }

    resolveActiveViewToggleId(): MobileViewToggleId {
        return 'agent';
    }

    updateStickyComposerFabLift(): void {
        const composerVisible = this.host.root.classList.contains('theia-mod-sticky-composer')
            && !this.host.stickyComposerHost.hidden
            && this.host.stickyComposerHost.offsetHeight > 0;
        const lift = composerVisible ? Math.round(this.host.stickyComposerHost.getBoundingClientRect().height) : 0;
        this.host.stickyComposerFabLiftPx = lift;
        this.host.root.style.setProperty('--theia-mobile-projects-fab-lift', `${lift}px`);
    }

    /** Project / branch / destination live in the Work Hub header project menu — not in the sticky composer. */
    shouldShowComposerWorkspaceBar(_summary?: QaapAgentConversationSummaryDTO): boolean {
        return false;
    }

    pinStickyComposerToQaiq(cwd: string | undefined): void {
        this.host.stickyComposerPinnedAgentId = QAAP_PRIMARY_AGENT_ID;
        writeStoredAgent(cwd, QAAP_PRIMARY_AGENT_ID);
    }

    resolveStickyComposerProject(projects: MobileProjectEntry[]): MobileProjectEntry | undefined {
        if (this.host.shouldUseAgentsHubLanding()) {
            return this.host.resolveHomePinnedProject();
        }
        const fromExpanded = this.host.projectNavigationUi.resolveSelectedProject(projects);
        if (fromExpanded) {
            return fromExpanded;
        }
        return this.host.projectsService.resolveCurrentWorkspaceProject(projects);
    }

    preferComposerSurface(surface: QaapComposerSurface, projectCwd?: string): void {
        void surface;
        writeStoredComposerSurface(projectCwd, 'task');
        this.host.stickyComposerSurface = 'task';
        if (this.host.visible && this.host.hubView === 'repos') {
            this.host.stickyComposerRenderUi.renderStickyComposer();
        }
    }

}

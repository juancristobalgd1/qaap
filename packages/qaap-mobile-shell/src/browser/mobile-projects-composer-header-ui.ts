// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { dismissQaapAccountMenu } from './qaap-workbench-account-menu';
import { setMobileWorkHubComposerHeaderChrome } from './mobile-projects-open';
import { createSegmentedField, type QaapSegmentedFieldController } from './qaap-mobile-form-ui';
import { writeStoredComposerSurface, type QaapComposerSurface } from '../common/qaap-composer-surface';
import { QAAP_PRIMARY_AGENT_ID, writeStoredAgent } from '../common/qaap-agent-task-client';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry, MobileProjectFilter } from './mobile-projects-types';
import type { MobileBottomButtonId } from './mobile-shell-bottom-bar-widget';

const QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE = 'qaap.mobile.ideHeaderView.activate';

export interface MobileProjectsComposerHeaderHost {
    visible: boolean;
    hubView: import('./mobile-projects-types').MobileProjectsHubView;
    root: HTMLElement;
    stickyComposerHost: HTMLElement;
    headerSurfacePickerHost: HTMLElement;
    accountBtn: HTMLButtonElement;
    headerSurfacePicker: QaapSegmentedFieldController<MobileBottomButtonId> | undefined;
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
        const show = this.shouldShowHeaderComposerSurfacePicker();
        const hideAccount = show || this.host.isProjectDetailView();
        setMobileWorkHubComposerHeaderChrome(show);
        if (show && !this.host.isAgentsHubExecutionSurfaceReady()) {
            this.host.ensureAgentsHubExecutionShellRendered();
        }
        if (!hideAccount) {
            this.host.syncAgentsHubAccountChrome();
        } else {
            this.host.accountBtn.hidden = true;
            this.host.accountBtn.style.display = 'none';
            this.host.accountBtn.setAttribute('aria-hidden', 'true');
            dismissQaapAccountMenu();
        }
        this.host.headerSurfacePickerHost.hidden = !show;
        if (!show) {
            this.host.headerSurfacePickerHost.replaceChildren();
            this.host.headerSurfacePicker = undefined;
            return;
        }
        const value: MobileBottomButtonId = 'agent';
        if (!this.host.headerSurfacePicker) {
            const field = createSegmentedField<MobileBottomButtonId>({
                segments: this.composerSurfaceSegmentOptions(),
                value,
                iconOnly: true,
                onChange: (surface: MobileBottomButtonId) => { this.onHeaderComposerSurfaceChange(surface); },
            });
            field.root.classList.add('theia-mod-header-surface');
            field.root.addEventListener('click', event => this.onHeaderComposerSurfacePickerClick(event), true);
            this.host.headerSurfacePicker = field;
            this.host.headerSurfacePickerHost.append(field.root);
        } else {
            this.host.headerSurfacePicker.setValue(value);
        }
    }

    onHeaderComposerSurfacePickerClick(event: MouseEvent): void {
        const option = event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>('.theia-qaap-segmented-option')
            : undefined;
        const clickedId = option?.dataset.segmentId as MobileBottomButtonId | undefined;
        if (clickedId && clickedId !== 'agent') {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.onHeaderComposerSurfaceChange('editor');
    }

    onHeaderComposerSurfaceChange(surface: MobileBottomButtonId): void {
        if (surface === 'agent') {
            this.syncHeaderComposerSurfacePicker();
            return;
        }
        if (surface !== 'editor') {
            return;
        }
        if (this.host.commands.getCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)
            && this.host.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)) {
            void this.host.commands.executeCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, 'editor');
        }
    }

    updateStickyComposerFabLift(): void {
        const composerVisible = this.host.root.classList.contains('theia-mod-sticky-composer')
            && !this.host.stickyComposerHost.hidden
            && this.host.stickyComposerHost.offsetHeight > 0;
        if (composerVisible) {
            const lift = this.host.stickyComposerHost.offsetHeight;
            this.host.stickyComposerFabLiftPx = lift;
            this.host.root.style.setProperty('--theia-mobile-projects-fab-lift', `${lift}px`);
            return;
        }
        this.host.stickyComposerFabLiftPx = 0;
        this.host.root.style.setProperty('--theia-mobile-projects-fab-lift', '0px');
    }

    /** Branch (+ project tray) stay visible for idle and active conversations; only the destination pill is idle-only. */
    shouldShowComposerWorkspaceBar(_summary?: QaapAgentConversationSummaryDTO): boolean {
        return true;
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

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsConversationIndexUi } from './mobile-projects-conversation-index-ui';
import type { MobileProjectsTasksHubUi } from './mobile-projects-tasks-hub-ui';
import type { MobileProjectsTranscriptSheetUi } from './mobile-projects-transcript-sheet-ui';
import {
    buildMissionControlItems,
    MobileWorkMissionControl,
    type MissionControlItem,
    type MissionControlLane,
    type MissionControlLaneFilter,
    type MissionControlSurfaceFilter,
} from './mobile-work-mission-control';

/** Panel surface for Mission Control home preview and full Work landing. */
export interface MobileProjectsMissionControlHost {
    projects: MobileProjectEntry[];
    scroll: HTMLElement;
    query: string;
    tasksFirstLoadPending: boolean;
    missionControlLaneFilter: MissionControlLaneFilter;
    missionControlSurfaceFilter: MissionControlSurfaceFilter;
    conversationIndexUi: MobileProjectsConversationIndexUi;
    tasksHubUi: MobileProjectsTasksHubUi;
    transcriptSheetUi: MobileProjectsTranscriptSheetUi;
    formatHomeRelativeTime(updatedAt: number): string;
    resolveHomeAgentLabel(agentId: string): string;
    conversationMatchesQuery(summary: QaapAgentConversationSummaryDTO, query: string): boolean;
    renderList(): void;
    renderSubtitle(): void;
    selectHubLandingView(view: import('./mobile-projects-types').MobileProjectsHubView, preferredDiffProjectId?: string, options?: { force?: boolean }): void;
    openDiffView(preferredProjectId?: string): void | Promise<void>;
    updateTasksAttentionChrome(): void;
}

export class MobileProjectsMissionControlUi {

    protected readonly renderer: MobileWorkMissionControl;

    constructor(protected readonly host: MobileProjectsMissionControlHost) {
        this.renderer = new MobileWorkMissionControl({
            formatRelativeTime: updatedAt => this.host.formatHomeRelativeTime(updatedAt),
            onOpenItem: item => { void this.onOpenItem(item); },
            onShowAll: () => this.host.selectHubLandingView('tasks'),
            onLaneFilter: lane => {
                this.host.missionControlLaneFilter = lane;
                this.host.renderList();
            },
            onSurfaceFilter: surface => {
                this.host.missionControlSurfaceFilter = surface;
                this.host.renderList();
            },
        });
    }

    buildItems(): MissionControlItem[] {
        return buildMissionControlItems({
            projects: this.host.projects,
            conversationsForProject: project => this.host.conversationIndexUi.conversationsForProject(project),
            isConversationUnread: summary => this.host.conversationIndexUi.isConversationUnread(summary),
            resolveAgentLabel: agentId => this.host.resolveHomeAgentLabel(agentId),
            query: this.host.query,
            conversationMatchesQuery: (summary, query) => this.host.conversationMatchesQuery(summary, query),
        });
    }

    countByLane(lane: MissionControlLane): number {
        return this.buildItems().filter(item => item.lane === lane).length;
    }

    renderHomePreview(container: HTMLElement): void {
        this.renderer.render(container, this.buildItems(), { showFilters: false });
    }

    renderFullView(): void {
        const root = document.createElement('div');
        root.className = 'theia-mobile-mission-control-host theia-mobile-tasks-hub-root';
        const items = this.buildItems();
        if (this.host.tasksFirstLoadPending && items.length === 0 && !this.host.query.trim()) {
            root.append(this.host.tasksHubUi.createTasksLoadingState());
        } else {
            this.renderer.render(root, items, {
                showFilters: true,
                laneFilter: this.host.missionControlLaneFilter,
                surfaceFilter: this.host.missionControlSurfaceFilter,
            });
        }
        this.host.scroll.append(root);
    }

    async onOpenItem(item: MissionControlItem): Promise<void> {
        const project = this.host.projects.find(entry => entry.id === item.projectId);
        if (!project) {
            return;
        }
        const summary = this.host.conversationIndexUi.conversationsForProject(project)
            .find(entry => entry.id === item.conversationId);

        if (item.surface === 'pr' || item.hasPullRequest) {
            this.host.selectHubLandingView('review');
            return;
        }

        if (item.lane === 'done' && !item.hasPullRequest
            && ((item.linesAdded ?? 0) > 0 || (item.linesRemoved ?? 0) > 0)) {
            await this.host.openDiffView(item.projectId);
            return;
        }

        if (summary) {
            await this.host.transcriptSheetUi.openTranscriptSheet(project, summary);
        }
    }

}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    MobileWorkMissionControl,
    isWorkMissionControlEnabled,
    type MissionControlItem,
    type MissionControlLaneFilter,
    type MissionControlSurfaceFilter,
} from './mobile-work-mission-control';
import { collectMissionControlItems } from './qaap-work-mission-control-collector';
import type { MobileProjectEntry } from './mobile-projects-types';

export interface MobileProjectsMissionControlHubHost {
    projects: MobileProjectEntry[];
    query: string;
    missionControlExpanded: boolean;
    missionControlLaneFilter: MissionControlLaneFilter;
    missionControlSurfaceFilter: MissionControlSurfaceFilter;
    setMissionControlExpanded(expanded: boolean): void;
    setMissionControlLaneFilter(filter: MissionControlLaneFilter): void;
    setMissionControlSurfaceFilter(filter: MissionControlSurfaceFilter): void;
    renderList(): void;
    formatHomeRelativeTime(updatedAt: number): string;
    resolveHomeAgentLabel(agentId: string): string;
    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    hubQueryUi: import('./mobile-projects-hub-query-ui').MobileProjectsHubQueryUi;
    transcriptSheetUi: import('./mobile-projects-transcript-sheet-ui').MobileProjectsTranscriptSheetUi;
}

/** Wires mission-control data collection and rendering into the Work Hub home surface. */
export class MobileProjectsMissionControlHubUi {

    protected readonly missionControl = new MobileWorkMissionControl({
        formatRelativeTime: updatedAt => this.host.formatHomeRelativeTime(updatedAt),
        onOpenItem: item => { void this.onOpenItem(item); },
        onShowAll: () => this.host.setMissionControlExpanded(true),
        onLaneFilter: filter => {
            this.host.setMissionControlLaneFilter(filter);
            this.host.renderList();
        },
        onSurfaceFilter: filter => {
            this.host.setMissionControlSurfaceFilter(filter);
            this.host.renderList();
        },
    });

    constructor(protected readonly host: MobileProjectsMissionControlHubHost) { }

    isEnabled(): boolean {
        return isWorkMissionControlEnabled();
    }

    collectItems(): MissionControlItem[] {
        return collectMissionControlItems({
            projects: this.host.projects,
            conversationsForProject: project => this.host.conversationIndexUi.conversationsForProject(project),
            isUnread: summary => this.host.conversationIndexUi.isConversationUnread(summary),
            resolveAgentLabel: agentId => this.host.resolveHomeAgentLabel(agentId),
            query: this.host.query,
            matchesQuery: (summary, query) => this.host.hubQueryUi.conversationMatchesQuery(summary, query),
        });
    }

    render(host: HTMLElement): void {
        if (!this.isEnabled()) {
            return;
        }
        const items = this.collectItems();
        const expanded = this.host.missionControlExpanded;
        const panelHost = document.createElement('div');
        panelHost.className = expanded
            ? 'theia-mobile-mission-control-host'
            : 'theia-mobile-mission-control-preview';
        this.missionControl.render(panelHost, items, {
            showFilters: expanded,
            laneFilter: this.host.missionControlLaneFilter,
            surfaceFilter: this.host.missionControlSurfaceFilter,
            expanded,
            onCollapse: expanded ? () => {
                this.host.setMissionControlExpanded(false);
                this.host.renderList();
            } : undefined,
        });
        host.append(panelHost);
    }

    protected async onOpenItem(item: MissionControlItem): Promise<void> {
        const project = this.host.projects.find(entry => entry.id === item.projectId);
        if (!project) {
            return;
        }
        const summary = this.host.conversationIndexUi.conversationsForProject(project)
            .find(entry => entry.id === item.conversationId);
        if (!summary) {
            return;
        }
        await this.host.transcriptSheetUi.openTranscriptSheet(project, summary);
    }
}

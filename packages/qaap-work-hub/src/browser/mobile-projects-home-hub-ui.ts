// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { findHubProjectIndex, type QaapDesktopIdeHubProject } from '../common/qaap-desktop-ide-workspace-plan';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import type { MobileProjectEntry, MobileProjectsHubView } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapComposerSurface } from '@theia/qaap-composer/lib/common/qaap-composer-surface';

/** Quick actions offered by the Work Hub empty states (Tasks and inbox lists). */
export type WorkHubHomeQuickActionId = 'new-chat' | 'delegate-task' | 'all-projects' | 'open-review' | 'open-tasks';

export interface MobileProjectsHomeHubHost {
    projects: MobileProjectEntry[];
    projectsService: MobileProjectsService;
    agentsHubSelectedProjectId: string | undefined;
    openProjectDetail(project: MobileProjectEntry): void | Promise<void>;
    selectHubLandingView(view: MobileProjectsHubView, preferredDiffProjectId?: string, options?: { force?: boolean }): void;
    preferComposerSurface(surface: QaapComposerSurface, projectCwd?: string): void;
}

/** Resolves the project the Work Hub header and composer target, and runs the empty-state quick actions. */
export class MobileProjectsHomeHubUi {
    /**
     * Project the unselected fallback last showed. The first paint lists cached project sessions;
     * `loadProjects()` then replaces them with other ids (`recent:file:///…` vs `github:…`) and
     * server recency, so re-picking `projects[0]` made the header jump to another repository.
     */
    protected homeFallbackProject: QaapDesktopIdeHubProject | undefined;

    constructor(protected readonly host: MobileProjectsHomeHubHost) { }

    resolveHomePinnedProject(): MobileProjectEntry | undefined {
        if (this.host.agentsHubSelectedProjectId) {
            const selected = this.host.projects.find(p => p.id === this.host.agentsHubSelectedProjectId);
            if (selected) {
                return selected;
            }
        }
        const fromWorkspace = this.host.projectsService.resolveCurrentWorkspaceProject(this.host.projects);
        if (fromWorkspace) {
            return fromWorkspace;
        }
        const pinned = this.host.projects.find(project => project.pinned);
        if (pinned) {
            return pinned;
        }
        const keptIndex = this.homeFallbackProject
            ? findHubProjectIndex(this.host.projects.map(project => this.toHubProject(project)), this.homeFallbackProject)
            : -1;
        const fallback = this.host.projects[keptIndex >= 0 ? keptIndex : 0];
        if (fallback) {
            this.homeFallbackProject = this.toHubProject(fallback);
        }
        return fallback;
    }

    protected toHubProject(project: MobileProjectEntry): QaapDesktopIdeHubProject {
        return {
            id: project.id,
            cwd: this.host.projectsService.getProjectCwd(project),
            githubFullName: project.github?.fullName,
        };
    }

    async onHomeQuickAction(action: WorkHubHomeQuickActionId): Promise<void> {
        switch (action) {
            case 'open-tasks':
                this.host.selectHubLandingView('tasks');
                return;
            case 'all-projects':
                this.host.selectHubLandingView('repos');
                return;
            case 'open-review':
                this.host.selectHubLandingView('review');
                return;
            case 'new-chat': {
                const project = this.resolveHomePinnedProject();
                if (!project) {
                    this.host.selectHubLandingView('repos');
                    return;
                }
                this.host.preferComposerSurface('chat', this.host.projectsService.getProjectCwd(project));
                await this.host.openProjectDetail(project);
                return;
            }
            case 'delegate-task': {
                const project = this.resolveHomePinnedProject();
                if (!project) {
                    this.host.selectHubLandingView('repos');
                    return;
                }
                this.host.preferComposerSurface('task', this.host.projectsService.getProjectCwd(project));
                await this.host.openProjectDetail(project);
                return;
            }
        }
    }

}

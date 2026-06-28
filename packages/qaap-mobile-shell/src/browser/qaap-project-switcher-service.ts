// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { QuickInputService } from '@theia/core';
import { nls } from '@theia/core/lib/common/nls';
import { MobileProjectEntry } from './mobile-projects-types';
import { MobileProjectsService } from './mobile-projects-service';

@injectable()
export class QaapProjectSwitcherService {

    @inject(MobileProjectsService)
    protected readonly projectsService: MobileProjectsService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    getCurrentProjectName(): string | undefined {
        return this.projectsService.getCurrentWorkspaceDisplayName();
    }

    async showProjectPicker(): Promise<void> {
        const projects = await this.projectsService.loadProjects();
        if (projects.length === 0) {
            return;
        }
        const selected = await this.quickInputService.showQuickPick(projects.map(project => ({
            label: project.github?.fullName ?? project.name,
            description: this.getProjectDescription(project),
            detail: project.task && project.task !== '-' && project.task !== '\u2014' ? project.task : undefined,
            execute: () => this.projectsService.openInCurrentWindow(project),
        })), {
            placeholder: nls.localize('qaap/projectSwitcher/placeholder', 'Select a repository to open in this workspace'),
            matchOnDescription: true,
            matchOnDetail: true,
        });
        selected?.execute?.();
    }

    protected getProjectDescription(project: MobileProjectEntry): string {
        if (project.isCurrent) {
            return nls.localize('qaap/projectSwitcher/current', 'current');
        }
        if (project.github) {
            return project.github.private
                ? nls.localize('qaap/projectSwitcher/privateGithub', 'private GitHub')
                : nls.localize('qaap/projectSwitcher/github', 'GitHub');
        }
        return project.branch;
    }
}

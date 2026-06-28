// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { QuickInputService, QuickPickItem, QuickPickSeparator } from '@theia/core';
import { nls } from '@theia/core/lib/common/nls';
import { MobileProjectEntry } from './mobile-projects-types';
import { MobileProjectsService } from './mobile-projects-service';

interface QaapProjectSwitcherPick extends QuickPickItem {
    run: () => Promise<void>;
}

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
        const items: Array<QaapProjectSwitcherPick | QuickPickSeparator> = [
            {
                label: nls.localize('qaap/projectSwitcher/addRepository', 'Add repository'),
                description: nls.localize('qaap/projectSwitcher/addRepositoryDescription', 'Clone an existing GitHub repository'),
                iconClasses: ['codicon', 'codicon-repo-clone'],
                alwaysShow: true,
                run: async () => {
                    const updatedProjects = await this.projectsService.cloneGithubProject();
                    await this.openNewestProject(updatedProjects);
                },
            },
            {
                label: nls.localize('qaap/projectSwitcher/addNewProject', 'Add new project'),
                description: nls.localize('qaap/projectSwitcher/addNewProjectDescription', 'Create a new private GitHub repository'),
                iconClasses: ['codicon', 'codicon-new-folder'],
                alwaysShow: true,
                run: async () => {
                    const updatedProjects = await this.projectsService.createGithubProject();
                    await this.openNewestProject(updatedProjects);
                },
            },
        ];
        if (projects.length > 0) {
            items.push(
                { type: 'separator', label: nls.localize('qaap/projectSwitcher/openRepositories', 'Open repositories') },
                ...projects.map(project => ({
                    label: project.github?.fullName ?? project.name,
                    description: this.getProjectDescription(project),
                    detail: project.task && project.task !== '-' && project.task !== '\u2014' ? project.task : undefined,
                    iconClasses: ['codicon', project.github ? 'codicon-github' : 'codicon-repo'],
                    run: async () => this.projectsService.openInCurrentWindow(project),
                } satisfies QaapProjectSwitcherPick)),
            );
        }
        document.body.classList.add('theia-mobile-mod-project-switcher-quickpick');
        try {
            const selected = await this.quickInputService.showQuickPick<QaapProjectSwitcherPick>(items, {
                title: nls.localize('qaap/projectSwitcher/title', 'Switch project'),
                placeholder: nls.localize('qaap/projectSwitcher/placeholder', 'Search repositories or choose an action'),
                matchOnDescription: true,
                matchOnDetail: true,
                ignoreFocusOut: true,
            });
            await selected?.run();
        } finally {
            document.body.classList.remove('theia-mobile-mod-project-switcher-quickpick');
        }
    }

    protected async openNewestProject(projects: MobileProjectEntry[] | undefined): Promise<void> {
        const project = projects?.[0];
        if (project) {
            await this.projectsService.openInCurrentWindow(project);
        }
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

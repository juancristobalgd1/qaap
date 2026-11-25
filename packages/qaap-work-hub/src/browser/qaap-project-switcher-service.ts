// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { QuickInputService, QuickPickItem, QuickPickSeparator } from '@theia/core';
import { nls } from '@theia/core/lib/common/nls';
import { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';

interface QaapProjectSwitcherPick extends QuickPickItem {
    run: () => Promise<void>;
}

@injectable()
export class QaapProjectSwitcherService {

    /**
     * How long the picker waits for a fresh repository list (session sync over the network) before
     * it opens with the cached list. Without it a slow or failing load left the status bar click
     * with no visible result.
     */
    protected pickerLoadTimeoutMs = 1500;

    @inject(MobileProjectsService)
    protected readonly projectsService: MobileProjectsService;

    @inject(QuickInputService)
    protected readonly quickInputService: QuickInputService;

    getCurrentProjectName(): string | undefined {
        return this.projectsService.getCurrentWorkspaceDisplayName();
    }

    /** Fresh list when it arrives in time, otherwise (or on failure) the cached list. */
    protected async loadPickerProjects(): Promise<MobileProjectEntry[]> {
        const cached = this.projectsService.peekCachedProjects();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<MobileProjectEntry[]>(resolve => {
            timer = setTimeout(() => resolve(cached), this.pickerLoadTimeoutMs);
        });
        try {
            return await Promise.race([this.projectsService.loadProjects(), timedOut]);
        } catch (error) {
            console.warn('[qaap-project-switcher] could not load the repositories', error);
            return cached;
        } finally {
            clearTimeout(timer);
        }
    }

    async showProjectPicker(): Promise<void> {
        const projects = await this.loadPickerProjects();
        const items: Array<QaapProjectSwitcherPick | QuickPickSeparator> = [
            {
                label: nls.localize('qaap/projectSwitcher/addRepository', 'Add repository'),
                description: nls.localize('qaap/projectSwitcher/addRepositoryDescription', 'Clone an existing GitHub repository'),
                iconClasses: ['codicon', 'codicon-repo-clone'],
                alwaysShow: true,
                // cloneGithubProject() already opens (and reloads into) the cloned workspace.
                run: async () => {
                    await this.projectsService.cloneGithubProject();
                },
            },
            {
                label: nls.localize('qaap/newProject/menuLocal', 'New local project'),
                description: nls.localize('qaap/projectSwitcher/newLocalProjectDescription', 'A folder on this workspace only'),
                iconClasses: ['codicon', 'codicon-new-folder'],
                alwaysShow: true,
                // createLocalProject() already opens (and reloads into) the new workspace.
                run: async () => {
                    await this.projectsService.createLocalProject();
                },
            },
            // Desktop only: a folder that already exists on this computer.
            ...(this.projectsService.isDesktop() ? [{
                label: nls.localize('theia/qaap-work-hub/openLocalProject', 'Open local project'),
                description: nls.localize('qaap/projectSwitcher/openLocalProjectDescription', 'Open a folder on this computer'),
                iconClasses: ['codicon', 'codicon-folder-opened'],
                alwaysShow: true,
                // openLocalProject() already opens (and reloads into) the chosen folder.
                run: async () => {
                    await this.projectsService.openLocalProject();
                },
            } satisfies QaapProjectSwitcherPick] : []),
            {
                label: nls.localize('qaap/newProject/menuGithub', 'New GitHub repository'),
                description: nls.localize('qaap/projectSwitcher/newGithubRepositoryDescription', 'Create a GitHub repository (private by default)'),
                iconClasses: ['codicon', 'codicon-github'],
                alwaysShow: true,
                // createGithubProject() already opens (and reloads into) the new workspace.
                run: async () => {
                    await this.projectsService.createGithubProject();
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

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import {
    WorkspaceHandlingContribution,
    WorkspaceOpenHandlerContribution,
    WorkspaceService,
} from '@theia/workspace/lib/browser';
import { isQaapWorkspaceContainerPath } from '@theia/qaap-adapters/lib/common/qaap-workspace-container-path';
import { MobileProjectsService } from '@theia/qaap-mobile-shell/lib/browser/mobile-projects-service';
import {
    filterHostedWorkspaceUris,
    isAllowedHostedRepositoryWorkspaceUri,
    isForbiddenHostedWorkspaceUri,
} from '../common/qaap-workspace-isolation';

/**
 * Keeps the IDE workspace root scoped to a single repository on hosted deployments.
 * Container roots such as `/workspace` or `.../repos/users/{login}` must never surface in the Explorer.
 */
@injectable()
export class QaapWorkspaceIsolationContribution implements
    FrontendApplicationContribution,
    WorkspaceOpenHandlerContribution,
    WorkspaceHandlingContribution {

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    @inject(MobileProjectsService)
    protected readonly projectsService: MobileProjectsService;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    protected redirectScheduled = false;

    async onStart(): Promise<void> {
        await this.workspace.ready;
        await this.redirectContainerWorkspaceIfNeeded('startup');
    }

    async canHandle(uri: URI): Promise<boolean> {
        return uri.scheme === 'file' && isForbiddenHostedWorkspaceUri(uri);
    }

    async openWorkspace(uri: URI, options?: { preserveWindow?: boolean }): Promise<void> {
        const target = await this.resolveRepositoryWorkspaceUri();
        if (target) {
            this.workspace.open(target, options);
            return;
        }
        this.messageService.warn(nls.localize(
            'qaap/workspaceIsolation/selectProject',
            'Select a project from Work Hub before opening the IDE workspace.',
        ));
    }

    async modifyRecentWorkspaces(workspaces: string[]): Promise<string[]> {
        return filterHostedWorkspaceUris(workspaces);
    }

    protected async redirectContainerWorkspaceIfNeeded(trigger: 'startup' | 'open'): Promise<void> {
        const resource = this.workspace.workspace?.resource;
        if (!resource || !isForbiddenHostedWorkspaceUri(resource)) {
            return;
        }
        if (this.redirectScheduled) {
            return;
        }
        const target = await this.resolveRepositoryWorkspaceUri();
        if (!target) {
            if (trigger === 'startup') {
                return;
            }
            this.messageService.warn(nls.localize(
                'qaap/workspaceIsolation/selectProject',
                'Select a project from Work Hub before opening the IDE workspace.',
            ));
            return;
        }
        this.redirectScheduled = true;
        this.workspace.open(target, { preserveWindow: true });
    }

    /** Picks the best repository root when the current workspace is a hosted container. */
    async resolveRepositoryWorkspaceUri(): Promise<URI | undefined> {
        for (const recent of await this.workspace.recentWorkspaces()) {
            const uri = new URI(recent);
            if (isAllowedHostedRepositoryWorkspaceUri(uri)) {
                return uri;
            }
        }
        try {
            const projects = await this.projectsService.loadProjects();
            const resolved = this.projectsService.resolveCurrentWorkspaceProject(projects);
            const fromResolved = this.projectUri(resolved);
            if (fromResolved) {
                return fromResolved;
            }
            for (const project of projects) {
                const uri = this.projectUri(project);
                if (uri) {
                    return uri;
                }
            }
        } catch {
            /* fall through */
        }
        return undefined;
    }

    protected projectUri(project: { uri?: URI } | undefined): URI | undefined {
        const uri = project?.uri;
        if (!uri || uri.scheme !== 'file') {
            return undefined;
        }
        const fsPath = uri.path.toString();
        if (isQaapWorkspaceContainerPath(fsPath) || !isAllowedHostedRepositoryWorkspaceUri(uri)) {
            return undefined;
        }
        return uri;
    }
}

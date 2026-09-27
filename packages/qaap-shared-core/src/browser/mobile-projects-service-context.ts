// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileProjectsService` and the extracted free functions in the
// `mobile-projects-service-*.ts` cluster. Each extracted function receives the host typed as
// `MobileProjectsServiceContext` instead of `any`. The contract is picked from the class over an explicit member
// list, so every member keeps the exact type the class declares. Members named here are `public`
// (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { MobileProjectsService } from './mobile-projects-service';

/** Members referenced by the extracted `mobile-projects-service-*` modules. */
export type MobileProjectsServiceContextMember =
    | 'activeTasks'
    | 'applySessionToEntry'
    | 'buildEphemeralCurrentWorkspaceEntry'
    | 'cachedGithubSessionToEntry'
    | 'cachedSessionToEntry'
    | 'cachedWorkspaceSessionToEntry'
    | 'canRemove'
    | 'cloneGithubProjectByRepository'
    | 'collapseCurrentWorkspaceDuplicates'
    | 'currentGithubRepositoryFullName'
    | 'currentRepoKey'
    | 'cwdForProject'
    | 'cwdFromFileUri'
    | 'fileService'
    | 'finishGithubRepositoryImport'
    | 'formatRepositoryLabel'
    | 'getCurrentWorkspaceCwd'
    | 'getCurrentWorkspaceMatchKey'
    | 'getProjectCwd'
    | 'getProjectWorkspaceMatchKey'
    | 'githubRepositoryToProject'
    | 'isBrowsableHubProject'
    | 'isPinned'
    | 'isProjectContainerWorkspace'
    | 'labelProvider'
    | 'latestTimestamp'
    | 'loadGithubProjects'
    | 'loadProjects'
    | 'loadSessionMap'
    | 'messageService'
    | 'normalizeProjectName'
    | 'openGithubProject'
    | 'openWorkspaceUri'
    | 'overlayActiveTasks'
    | 'projectActivityTime'
    | 'projectMatchesCurrentWorkspace'
    | 'projectSessionKey'
    | 'readCustomProjects'
    | 'readDisplayNames'
    | 'readHiddenProjectIds'
    | 'readPinnedProjectIds'
    | 'recordProjectSession'
    | 'registerGithubWorkspaceProject'
    | 'relativeUpdatedAt'
    | 'repositoryImports'
    | 'resolveDisplayName'
    | 'sortProjectsByRecent'
    | 'storedToEntry'
    | 'touchGithubRepositoryActivity'
    | 'touchProjectActivity'
    | 'touchProjectSession'
    | 'touchWorkspaceActivity'
    | 'uniqueCopyName'
    | 'windowService'
    | 'workspacePathFromUri'
    | 'workspaceService'
    | 'writeCustomProjects'
    | 'writeDisplayNames'
    | 'writeHiddenProjectIds'
    | 'writePinnedProjectIds';

/**
 * Members of {@link MobileProjectsService} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface MobileProjectsServiceContext
    extends Pick<MobileProjectsService, MobileProjectsServiceContextMember> { }

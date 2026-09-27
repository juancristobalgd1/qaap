// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileProjectsTasksHubUi` and the extracted free functions in the
// `mobile-projects-tasks-hub-ui-*.ts` cluster. Each extracted function receives the host typed as
// `MobileProjectsTasksHubUiContext` instead of `any`. The contract is picked from the class over an explicit member
// list, so every member keeps the exact type the class declares. Members named here are `public`
// (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { MobileProjectsTasksHubUi } from './mobile-projects-tasks-hub-ui';

/** Members referenced by the extracted `mobile-projects-tasks-hub-ui-*` modules. */
export type MobileProjectsTasksHubUiContextMember =
    | 'appendTasksHubTeamSection'
    | 'applyComposerQuickActionPrompt'
    | 'bindWorkingDetailActivitySubscription'
    | 'cancelWorkingConversationLikeComposerStop'
    | 'clearTaskHistoryFilters'
    | 'collectAgentsHubRecentItems'
    | 'collectTeamMembersForTranscriptSection'
    | 'countWorkingAgentsForPill'
    | 'countWorkingAgentsForTranscriptPill'
    | 'createTaskSkeletonRow'
    | 'createTasksEmptyState'
    | 'createTasksLoadingState'
    | 'getTaskHistoryFilters'
    | 'host'
    | 'isEmptyComposerQuickActionsSurfacePainted'
    | 'lastStepPillConversationId'
    | 'lastStepPillProgress'
    | 'openWorkingAgentsPopoverFromPill'
    | 'paintWorkingDetailTaskLog'
    | 'prefetchWorkingDetailDocuments'
    | 'readQaapSignedIn'
    | 'resolveActiveConversationTodoStepProgress'
    | 'resolveOpenComposerConversationId'
    | 'resolveProjectForConversationId'
    | 'resolveWorkingDetailActivityFeed'
    | 'resolveWorkingDetailTranscriptExcerpt'
    | 'seedWorkingDetailTaskLogFromServer'
    | 'setTaskHistoryFilter'
    | 'shouldSuppressWorkingPillForEmptyComposer'
    | 'stopAllWorkingAgents'
    | 'stopWorkingAgent'
    | 'updateStepPillChrome'
    | 'updateTasksAttentionChrome'
    | 'updateWorkingPillChrome'
    | 'workingDetailActivityConversationId'
    | 'workingDetailActivityDispose'
    | 'workingDetailTaskLogDispose'
    | 'workingDetailTaskLogSeedToken'
    | 'workingDetailTaskLogTaskId';

/**
 * Members of {@link MobileProjectsTasksHubUi} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface MobileProjectsTasksHubUiContext
    extends Pick<MobileProjectsTasksHubUi, MobileProjectsTasksHubUiContextMember> { }

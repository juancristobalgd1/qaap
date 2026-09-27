// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileProjectsSessionsSidebarUi` and the extracted free functions in the
// `mobile-projects-sessions-sidebar-ui-*.ts` cluster. Each extracted function receives the host typed as
// `MobileProjectsSessionsSidebarUiContext` instead of `any`. The contract is picked from the class over an explicit member
// list, so every member keeps the exact type the class declares. Members named here are `public`
// (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { MobileProjectsSessionsSidebarUi } from './mobile-projects-sessions-sidebar-ui';

/** Members referenced by the extracted `mobile-projects-sessions-sidebar-ui-*` modules. */
export type MobileProjectsSessionsSidebarUiContextMember =
    | 'appendSessionsSidebarConversationItems'
    | 'beginSessionsSidebarConversationActivation'
    | 'bindSessionsSidebarInteractionGuard'
    | 'bindSessionsSidebarThreadStoreSubscriptions'
    | 'buildSessionsSidebarStructureFingerprint'
    | 'buildSidebarRowFingerprint'
    | 'clearFailedModeProjectId'
    | 'closePullRequestDetail'
    | 'closePullRequestSearch'
    | 'closeSessionsSidebarHeadPopovers'
    | 'collectParentIds'
    | 'collectSessionsSidebarConversationEntries'
    | 'collectSessionsSidebarPinnedGroups'
    | 'compareSessionsSidebarProjectOrder'
    | 'createSessionsSidebarClearFailedModeFooter'
    | 'createSessionsSidebarNewAgentControl'
    | 'createSessionsSidebarPinnedProjectGroup'
    | 'createSessionsSidebarPinnedSection'
    | 'createSessionsSidebarProjectGroup'
    | 'createSessionsSidebarProjectRowHead'
    | 'createSessionsSidebarShowLessControl'
    | 'createSessionsSidebarShowMoreControl'
    | 'ensureSessionsSidebarActiveProjectExpanded'
    | 'ensureWorkHubSessionsSidebar'
    | 'enterClearFailedMode'
    | 'exitClearFailedMode'
    | 'getSessionsSidebarConversationDisplayLimit'
    | 'getSessionsSidebarProjectSortMode'
    | 'host'
    | 'isClearFailedModeForProject'
    | 'isSessionsSidebarInteractionGuardActive'
    | 'isSessionsSidebarPinnedConversation'
    | 'isWorkHubSessionsSidebarVisible'
    | 'mergeSessionsSidebarProjects'
    | 'onSessionsSidebarAccountClick'
    | 'onWorkHubSessionsSidebarNewChat'
    | 'openEmptyMobileChatSheet'
    | 'openSessionsSidebarPullRequests'
    | 'openSessionsSidebarSearch'
    | 'prefetchVisibleSidebarDocuments'
    | 'prepareSessionsSidebarData'
    | 'readQaapSignedIn'
    | 'rememberSessionsSidebarListFingerprint'
    | 'renderSessionsSidebarPullRequestList'
    | 'renderWorkHubSessionsSidebarList'
    | 'resetSessionsSidebarListFingerprint'
    | 'resolveSessionsSidebarCollapsedLimit'
    | 'resolveSessionsSidebarProjectCreatedAt'
    | 'resolveSessionsSidebarProjectLastMessageAt'
    | 'resolveSessionsSidebarVisibleConversations'
    | 'resolveWorkHubSessionsSidebarProject'
    | 'scheduleWorkHubSessionsSidebarRefresh'
    | 'seedSessionsSidebarAccordionDefaults'
    | 'seedSessionsSidebarProjectsForPaint'
    | 'selectSessionsSidebarProject'
    | 'selectedFailedConversationIds'
    | 'sessionsSidebarAddProjectPopover'
    | 'sessionsSidebarInteractionBound'
    | 'sessionsSidebarInteractionUntil'
    | 'sessionsSidebarLastStreamRefreshAt'
    | 'sessionsSidebarListFingerprint'
    | 'sessionsSidebarOpeningConversationId'
    | 'sessionsSidebarOpeningTimer'
    | 'sessionsSidebarSortPopover'
    | 'sessionsSidebarStatusLegendPopover'
    | 'sessionsSidebarThreadStoreDispose'
    | 'setSessionsSidebarProjectSortMode'
    | 'shouldDeferSessionsSidebarListRefresh'
    | 'shouldSkipSessionsSidebarListRender'
    | 'stampSessionsSidebarRowFingerprints'
    | 'syncSessionsSidebarAnimatedListHeights'
    | 'toggleClearFailedSelection'
    | 'togglePullRequestSearch'
    | 'toggleSessionsSidebarAddProjectPopover'
    | 'toggleSessionsSidebarProjectSortPopover'
    | 'tryPatchSessionsSidebarList';

/**
 * Members of {@link MobileProjectsSessionsSidebarUi} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface MobileProjectsSessionsSidebarUiContext
    extends Pick<MobileProjectsSessionsSidebarUi, MobileProjectsSessionsSidebarUiContextMember> { }

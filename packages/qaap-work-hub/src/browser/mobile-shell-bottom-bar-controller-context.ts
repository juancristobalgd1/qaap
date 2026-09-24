// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileShellBottomBarController` and the extracted free functions in the
// `mobile-shell-bottom-bar-controller-*.ts` cluster. Each extracted function receives the host typed as
// `MobileShellBottomBarControllerContext` instead of `any`. The contract is picked from the class over an explicit member
// list, so every member keeps the exact type the class declares. Members named here are `public`
// (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { MobileShellBottomBarController } from './mobile-shell-bottom-bar-controller';

/** Members referenced by the extracted `mobile-shell-bottom-bar-controller-*` modules. */
export type MobileShellBottomBarControllerContextMember =
    | 'applyMobileBottomPanelMaximizedSize'
    | 'bottomBarMenuCleanup'
    | 'bottomBarWidget'
    | 'bottomChromeHost'
    | 'bottomChromeTouchScrollDispose'
    | 'canToggleTerminalBottomPanel'
    | 'clearMobileMaximizedOverlayInsets'
    | 'commands'
    | 'createMobileBottomButton'
    | 'ensureBottomChromeHost'
    | 'getAgentSecondaryItems'
    | 'getBottomAreaSplitPanel'
    | 'getBottomBarNode'
    | 'getBottomBarSecondaryItems'
    | 'getBottomPanelPendingUpdate'
    | 'getExploreSecondaryItems'
    | 'getMaximizedOverlayElement'
    | 'getMobileBottomButtons'
    | 'getMobileIdeHeaderViewButtons'
    | 'getPreviewSecondaryItems'
    | 'getProjectsSecondaryItems'
    | 'getPullRequestSecondaryItems'
    | 'getTerminalSecondaryItems'
    | 'getWorkHubLandingBottomButtons'
    | 'host'
    | 'installBottomBarLongPress'
    | 'installBottomChromeTouchScroll'
    | 'isMainAgentSurfaceEmpty'
    | 'isMobileBottomButtonActive'
    | 'isMobileBottomTerminalVisible'
    | 'isMobileWorkspaceHubPrimaryBottomBar'
    | 'isTerminalBottomPanelOpen'
    | 'isWorkHubLandingBottomBar'
    | 'measureMobileBottomPanelHeightPx'
    | 'mobileMq'
    | 'onMobileBottomButtonClick'
    | 'projectBootstrap'
    | 'projectsService'
    | 'refreshBottomBar'
    | 'removeBottomBarSecondaryMenu'
    | 'resolveMobileBottomSplitSizes'
    | 'restoreMobileBottomPanelFromMaximized'
    | 'shell'
    | 'shouldDismissSheetsForButton'
    | 'showBottomBarSecondaryMenu'
    | 'statusBar'
    | 'statusBarShellIndex'
    | 'suppressMobileBottomAutoMaximize'
    | 'syncMobileHubPrimaryBottomChrome'
    | 'syncMobileMaximizedOverlayInsets'
    | 'toggleTerminalBottomPanel';

/**
 * Members of {@link MobileShellBottomBarController} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface MobileShellBottomBarControllerContext
    extends Pick<MobileShellBottomBarController, MobileShellBottomBarControllerContextMember> { }

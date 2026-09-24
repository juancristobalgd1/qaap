// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// The shared contract between `MobileProjectsExecutionSurfaceTabsUi` and the extracted free functions in the
// `mobile-projects-execution-surface-tabs-ui-*.ts` cluster. Each extracted function receives the host typed as
// `MobileProjectsExecutionSurfaceTabsUiContext` instead of `any`. The contract is picked from the class over an explicit member
// list, so every member keeps the exact type the class declares. Members named here are `public`
// (+ `@internal` where they used to be `protected`) on the class.
// `import type` keeps this free of a runtime import cycle (the class imports every extracted module).

import type { MobileProjectsExecutionSurfaceTabsUi } from './mobile-projects-execution-surface-tabs-ui';

/** Members referenced by the extracted `mobile-projects-execution-surface-tabs-ui-*` modules. */
export type MobileProjectsExecutionSurfaceTabsUiContextMember =
    | 'activateExecutionSurfaceTab'
    | 'appendExecutionSurfaceTabStripToTitleRow'
    | 'applyExecutionSurfaceIconSelectDisplay'
    | 'buildExecutionViewTabStrip'
    | 'buildTranscriptTabStrip'
    | 'centerExecutionSurfaceActiveControl'
    | 'closeExecutionSurfaceSidebar'
    | 'closeExecutionTabOverflowMenu'
    | 'createExecutionSurfaceIconSelect'
    | 'directChildWithClass'
    | 'dismissExecutionSurfaceSidebar'
    | 'executionSurfaceTabForProject'
    | 'executionSurfaceTabSpecs'
    | 'executionTabOverflowMenuMinTop'
    | 'host'
    | 'mountExecutionSurfaceTabContent'
    | 'mountTranscriptSurfaceTab'
    | 'openExecutionSurfaceSidebar'
    | 'openExecutionTabOverflowMenu'
    | 'positionExecutionTabOverflowMenu'
    | 'rebuildExecutionSurfaceTabStrips'
    | 'refreshExecutionSurfaceTabStripState'
    | 'replaceExecutionSurfaceTabStrip'
    | 'resolveExecutionSurfaceIconSelectDisplayTab'
    | 'resolveExecutionSurfaceProject'
    | 'resolveExecutionSurfaceTabStripHost'
    | 'resolveExecutionTabOverflowMenuPortal'
    | 'resolveTerminalAgentTuiActiveAgentId'
    | 'scheduleExecutionSurfaceFrame'
    | 'selectTranscriptTab'
    | 'setExecutionSurfaceTab'
    | 'showOnlyExecutionSurfaceTab'
    | 'syncConnectedTranscriptSurfaceHosts'
    | 'syncExecutionSurfaceChrome'
    | 'syncExecutionSurfaceChromeInHost'
    | 'syncProjectDetailTabStrip'
    | 'syncSurfaceHostsFromContainer'
    | 'syncTerminalAgentTuiTrigger'
    | 'syncTerminalAgentTuiTriggersInStrip';

/**
 * Members of {@link MobileProjectsExecutionSurfaceTabsUi} that the extracted helper functions
 * access through their `ctx` parameter.
 */
export interface MobileProjectsExecutionSurfaceTabsUiContext
    extends Pick<MobileProjectsExecutionSurfaceTabsUi, MobileProjectsExecutionSurfaceTabsUiContextMember> { }

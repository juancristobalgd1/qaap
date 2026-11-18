// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from './mobile-projects-types';

/** A Work Hub conversation and its project, kept in memory to reopen it. */
export interface MobileShellConversationTarget {
    readonly project: MobileProjectEntry;
    readonly summary: QaapAgentConversationSummaryDTO;
}

/**
 * Memory-only flags for the current browser runtime.
 * Nothing here may be written to sessionStorage, localStorage, URL state, or restored layout.
 */
export class MobileShellSessionState {

    /**
     * True once the user has actively left the mobile landing (Projects panel) in this session,
     * either by opening a workspace from the dashboard or by tapping Focus on the active project.
     */
    landingLeftThisSession = false;

    /** True when the current transcript was opened from the Work Hub Agents landing overlay. */
    transcriptOpenedFromWorkHubLanding = false;

    /** Prevents duplicate `restoreAgentsSurfaceAfterReload` calls during mobile layout bootstrap. */
    agentsBootstrapStarted = false;

    /**
     * True when the user left the desktop IDE for the Work Hub with the left side panel closed.
     * The next Work Hub -> IDE switch then keeps it closed instead of revealing the Explorer.
     */
    desktopIdeSidePanelClosedByUser = false;

    /**
     * The conversation open in the Work Hub when the user switched to the desktop IDE. Opening the IDE disposes
     * the Work Hub panel, so the switch back reopens this conversation instead of the empty new-task shell.
     * The bootstrap that restores the Work Hub takes it once.
     */
    conversationBeforeDesktopIde: MobileShellConversationTarget | undefined;

    /** Bumped to cancel in-flight Agents bootstrap when the user opens the desktop IDE. */
    agentsBootstrapEpoch = 0;

    cancelAgentsBootstrap(): void {
        this.agentsBootstrapEpoch++;
        this.agentsBootstrapStarted = false;
    }

}

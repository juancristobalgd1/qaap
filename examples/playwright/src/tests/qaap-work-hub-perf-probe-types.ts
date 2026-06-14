// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface WorkHubPerfProbeMetrics {
    hubScrollReplaceChildren: number;
    sidebarListReplaceChildren: number;
    chatHostConnected: boolean;
    inlineExecutionConnected: boolean;
}

export interface WorkHubPerfProbeApi {
    burstConversationTicks(count: number): void;
    setTranscriptOverlayOpenForProbe(open: boolean): void;
    openSessionsSidebarForProbe(): void;
    navigateToHomeHubForProbe(): void;
    expandMissionControlForProbe(): void;
    showTasksInboxWithTeamForProbe(): void;
    seedMultiAgentProbeConversations(): void;
    tickProbeStreamingConversations(): void;
    resetMetrics(): WorkHubPerfProbeMetrics;
    getMetrics(): WorkHubPerfProbeMetrics;
}

declare global {
    interface Window {
        __qaapWorkHubPerfProbe?: WorkHubPerfProbeApi;
    }
}

export const QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY = 'qaapWorkHubPerfProbe';

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY = 'qaapWorkHubPerfProbe';

export interface QaapWorkHubPerfProbeMetrics {
    readonly hubScrollReplaceChildren: number;
    readonly sidebarListReplaceChildren: number;
    readonly chatHostConnected: boolean;
    readonly inlineExecutionConnected: boolean;
}

export interface QaapWorkHubPerfProbeApi {
    burstConversationTicks(count: number): void;
    setTranscriptOverlayOpenForProbe(open: boolean): void;
    openSessionsSidebarForProbe(): void;
    navigateToHomeHubForProbe(): void;
    expandMissionControlForProbe(): void;
    showTasksInboxWithTeamForProbe(): void;
    seedMultiAgentProbeConversations(): void;
    tickProbeStreamingConversations(): void;
    resetMetrics(): QaapWorkHubPerfProbeMetrics;
    getMetrics(): QaapWorkHubPerfProbeMetrics;
}

export function isQaapWorkHubPerfProbeEnabled(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    try {
        return window.sessionStorage?.getItem(QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY) === '1';
    } catch {
        return false;
    }
}

declare global {
    interface Window {
        __qaapWorkHubPerfProbe?: QaapWorkHubPerfProbeApi;
    }
}

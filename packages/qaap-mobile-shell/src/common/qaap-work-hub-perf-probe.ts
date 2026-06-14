// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type {
    QaapFpsSampleResult,
    QaapMemorySnapshot,
    QaapNavigationTimingResult,
    QaapRuntimeSnapshot,
} from './qaap-work-hub-runtime-metrics';
import type { QaapChatUiPerfTurnSnapshot } from './qaap-chat-ui-perf';

export type {
    QaapFpsSampleResult,
    QaapMemorySnapshot,
    QaapNavigationTimingResult,
    QaapRuntimeSnapshot,
} from './qaap-work-hub-runtime-metrics';

export const QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY = 'qaapWorkHubPerfProbe';

export interface WorkHubPerfProbeDiagnostics {
    readonly projectCount: number;
    readonly mcRowCount: number;
    readonly teamRowCount: number;
    readonly hubView: string;
}

export interface QaapWorkHubPerfProbeMetrics {
    readonly hubScrollReplaceChildren: number;
    readonly sidebarListReplaceChildren: number;
    readonly chatHostConnected: boolean;
    readonly inlineExecutionConnected: boolean;
}

export interface QaapWorkHubStreamingPerfSample {
    readonly fps: QaapFpsSampleResult;
    readonly burstCount: number;
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
    burstProbeTranscriptDeltas(conversationId: string, count: number): void;
    hasProjectsForProbe(): boolean;
    hasWorkspaceForProbe(): boolean;
    getProbeDiagnostics(): WorkHubPerfProbeDiagnostics;
    resetMetrics(): QaapWorkHubPerfProbeMetrics;
    getMetrics(): QaapWorkHubPerfProbeMetrics;
    recordWorkHubFirstShowMs(durationMs: number): void;
    getRuntimeSnapshot(): QaapRuntimeSnapshot;
    getMemorySnapshot(): QaapMemorySnapshot | undefined;
    measureOpenConversation(conversationId: string): Promise<QaapNavigationTimingResult>;
    sampleStreamingPerf(options?: { durationMs?: number; burstCount?: number; conversationId?: string }): Promise<QaapWorkHubStreamingPerfSample | undefined>;
    getLastChatUiPerf(): QaapChatUiPerfTurnSnapshot | undefined;
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
        __qaapLastChatUiPerf?: QaapChatUiPerfTurnSnapshot;
    }
}

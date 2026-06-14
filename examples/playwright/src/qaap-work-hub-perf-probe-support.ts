// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Shared Work Hub perf-probe types for Playwright E2E (not a test file). */
export interface WorkHubPerfProbeMetrics {
    hubScrollReplaceChildren: number;
    sidebarListReplaceChildren: number;
    chatHostConnected: boolean;
    inlineExecutionConnected: boolean;
}

export interface WorkHubPerfProbeDiagnostics {
    projectCount: number;
    mcRowCount: number;
    teamRowCount: number;
    hubView: string;
}

export interface QaapMemorySnapshot {
    jsHeapUsedMb: number;
    jsHeapTotalMb: number;
    jsHeapLimitMb?: number;
}

export interface QaapFpsSampleResult {
    durationMs: number;
    frameCount: number;
    medianFps: number;
    p95FrameMs: number;
    droppedFrames: number;
    longTaskCount: number;
    maxLongTaskMs: number;
}

export interface QaapNavigationTimingResult {
    conversationId: string;
    durationMs: number;
    historyVisible: boolean;
    hubScrollReplaceChildren: number;
    inlineExecutionConnected: boolean;
}

export interface QaapRuntimeSnapshot {
    memory?: QaapMemorySnapshot;
    workHubFirstShowMs?: number;
    lastNavigation?: QaapNavigationTimingResult;
}

export interface QaapWorkHubStreamingPerfSample {
    fps: QaapFpsSampleResult;
    burstCount: number;
}

export interface QaapChatUiPerfTurnSnapshot {
    turnId: string;
    sessionId: string;
    surface: 'chat-view' | 'transcript';
    ttftMs: number;
    durationMs: number;
    contentChangeEvents: number;
    paintEvents: number;
    coalesceRatio: number;
    longTaskCount: number;
    maxLongTaskMs: number;
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
    burstProbeTranscriptDeltas(conversationId: string, count: number): void;
    hasProjectsForProbe(): boolean;
    hasWorkspaceForProbe(): boolean;
    getProbeDiagnostics(): WorkHubPerfProbeDiagnostics;
    resetMetrics(): WorkHubPerfProbeMetrics;
    getMetrics(): WorkHubPerfProbeMetrics;
    recordWorkHubFirstShowMs(durationMs: number): void;
    getRuntimeSnapshot(): QaapRuntimeSnapshot;
    getMemorySnapshot(): QaapMemorySnapshot | undefined;
    measureOpenConversation(conversationId: string): Promise<QaapNavigationTimingResult>;
    sampleStreamingPerf(options?: {
        durationMs?: number;
        burstCount?: number;
        conversationId?: string;
    }): Promise<QaapWorkHubStreamingPerfSample | undefined>;
    getLastChatUiPerf(): QaapChatUiPerfTurnSnapshot | undefined;
}

export const QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY = 'qaapWorkHubPerfProbe';

export const QAAP_PROBE_CONVERSATION_IDS = {
    agentA: 'probe-agent-a',
    agentB: 'probe-agent-b',
    agentC: 'probe-agent-c',
} as const;

declare global {
    interface Window {
        __qaapWorkHubPerfProbe?: WorkHubPerfProbeApi;
        __qaapLastChatUiPerf?: QaapChatUiPerfTurnSnapshot;
    }
}

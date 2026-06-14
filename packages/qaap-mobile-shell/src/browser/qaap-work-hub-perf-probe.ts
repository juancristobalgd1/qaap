// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    isQaapWorkHubPerfProbeEnabled,
    type QaapNavigationTimingResult,
    type QaapWorkHubPerfProbeApi,
    type QaapWorkHubPerfProbeMetrics,
    type QaapWorkHubStreamingPerfSample,
} from '../common/qaap-work-hub-perf-probe';
import type { QaapChatUiPerfTurnSnapshot } from '../common/qaap-chat-ui-perf';
import {
    logQaapFpsSample,
    logQaapMemorySnapshot,
    QaapWorkHubFpsSampler,
    readQaapMemorySnapshot,
    waitForAnimationFrames,
} from '../common/qaap-work-hub-runtime-metrics';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileWorkHubSessionsSidebar } from './mobile-work-hub-sessions-sidebar';

const PERF_PROBE_CONVERSATION_ID = '__qaap_work_hub_perf_probe__';

export interface QaapWorkHubPerfProbeHost {
    scroll: HTMLElement;
    conversations: MobileProjectsConversations | undefined;
    getSessionsSidebar(): MobileWorkHubSessionsSidebar | undefined;
    getTranscriptSheet(): HTMLElement | undefined;
    setTranscriptSheet(value: HTMLElement | undefined): void;
    getTranscriptChatHost(): HTMLElement | undefined;
    setTranscriptChatHost(value: HTMLElement | undefined): void;
    getTranscriptOpenSummaryId(): string | undefined;
    setTranscriptOpenSummaryId(value: string | undefined): void;
    openWorkHubSessionsSidebar(): void;
    navigateToHomeHubForProbe(): void;
    expandMissionControlForProbe(): void;
    showTasksInboxWithTeamForProbe(): void;
    seedMultiAgentProbeConversations(): void;
    tickProbeStreamingConversations(): void;
    openProbeConversation(conversationId: string): Promise<void>;
    hasProjectsForProbe(): boolean;
    hasWorkspaceForProbe(): boolean;
    getProbeDiagnostics(): import('../common/qaap-work-hub-perf-probe').WorkHubPerfProbeDiagnostics;
}

const TRANSCRIPT_MESSAGE_SELECTOR = '.theia-mobile-agent-transcript-real-chat .theia-mobile-agent-transcript-msg';

async function waitForTranscriptHistoryVisible(timeoutMs = 5_000): Promise<boolean> {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
        const chatHost = document.querySelector('.theia-mobile-agent-transcript-real-chat');
        if (chatHost?.querySelector(TRANSCRIPT_MESSAGE_SELECTOR)) {
            return true;
        }
        await waitForAnimationFrames(2);
    }
    return false;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

export function installQaapWorkHubPerfProbe(host: QaapWorkHubPerfProbeHost): void {
    if (!isQaapWorkHubPerfProbeEnabled() || typeof window === 'undefined') {
        return;
    }
    if (window.__qaapWorkHubPerfProbe) {
        return;
    }

    const metrics = {
        hubScrollReplaceChildren: 0,
        sidebarListReplaceChildren: 0,
    };
    let workHubFirstShowMs: number | undefined;
    let lastNavigation: QaapNavigationTimingResult | undefined;
    let activeFpsSampler: QaapWorkHubFpsSampler | undefined;

    const patchReplaceChildren = (
        element: HTMLElement,
        counter: 'hubScrollReplaceChildren' | 'sidebarListReplaceChildren',
    ): void => {
        const original = element.replaceChildren.bind(element);
        element.replaceChildren = (...nodes: (string | Node)[]) => {
            metrics[counter]++;
            return original(...nodes);
        };
    };

    patchReplaceChildren(host.scroll, 'hubScrollReplaceChildren');

    const ensureSidebarListPatched = (): void => {
        const listHost = host.getSessionsSidebar()?.node.querySelector(
            '.theia-mobile-work-hub-sessions-sidebar-list',
        );
        if (listHost instanceof HTMLElement && !listHost.dataset.qaapPerfProbePatched) {
            listHost.dataset.qaapPerfProbePatched = '1';
            patchReplaceChildren(listHost, 'sidebarListReplaceChildren');
        }
    };

    const readMetrics = (): QaapWorkHubPerfProbeMetrics => {
        ensureSidebarListPatched();
        return {
            hubScrollReplaceChildren: metrics.hubScrollReplaceChildren,
            sidebarListReplaceChildren: metrics.sidebarListReplaceChildren,
            chatHostConnected: host.getTranscriptChatHost()?.isConnected === true,
            inlineExecutionConnected: document.querySelector('.theia-mobile-agents-hub-inline-execution')?.isConnected === true,
        };
    };

    const api: QaapWorkHubPerfProbeApi = {
        burstConversationTicks: (count: number) => {
            const conversations = host.conversations;
            if (!conversations) {
                return;
            }
            for (let i = 0; i < count; i++) {
                conversations.perfProbeFireDidChange();
            }
        },
        setTranscriptOverlayOpenForProbe: (open: boolean) => {
            if (open) {
                host.setTranscriptOpenSummaryId(PERF_PROBE_CONVERSATION_ID);
                let transcriptSheet = host.getTranscriptSheet();
                if (!transcriptSheet) {
                    transcriptSheet = document.createElement('div');
                    transcriptSheet.className = 'theia-mobile-agent-transcript-root theia-mod-visible';
                    document.body.append(transcriptSheet);
                    host.setTranscriptSheet(transcriptSheet);
                }
                let transcriptChatHost = host.getTranscriptChatHost();
                if (!transcriptChatHost) {
                    transcriptChatHost = document.createElement('div');
                    transcriptChatHost.className = 'theia-mobile-agent-transcript-real-chat';
                    transcriptChatHost.dataset.qaapPerfProbe = '1';
                    transcriptSheet.append(transcriptChatHost);
                    host.setTranscriptChatHost(transcriptChatHost);
                }
                return;
            }
            const transcriptChatHost = host.getTranscriptChatHost();
            if (transcriptChatHost?.dataset.qaapPerfProbe === '1') {
                transcriptChatHost.remove();
                host.setTranscriptChatHost(undefined);
            }
            const transcriptSheet = host.getTranscriptSheet();
            if (transcriptSheet?.parentElement === document.body && !transcriptSheet.classList.contains('theia-mod-sheet-mounted')) {
                transcriptSheet.remove();
                host.setTranscriptSheet(undefined);
            }
            host.setTranscriptOpenSummaryId(undefined);
        },
        openSessionsSidebarForProbe: () => {
            host.openWorkHubSessionsSidebar();
            ensureSidebarListPatched();
        },
        navigateToHomeHubForProbe: () => {
            host.navigateToHomeHubForProbe();
        },
        expandMissionControlForProbe: () => {
            host.expandMissionControlForProbe();
        },
        showTasksInboxWithTeamForProbe: () => {
            host.showTasksInboxWithTeamForProbe();
        },
        seedMultiAgentProbeConversations: () => {
            host.seedMultiAgentProbeConversations();
        },
        tickProbeStreamingConversations: () => {
            host.tickProbeStreamingConversations();
        },
        burstProbeTranscriptDeltas: (conversationId: string, count: number) => {
            const conversations = host.conversations;
            if (!conversations) {
                return;
            }
            for (let index = 0; index < count; index++) {
                conversations.perfProbeEmitStreamingDelta(conversationId);
            }
        },
        hasProjectsForProbe: () => host.hasProjectsForProbe(),
        hasWorkspaceForProbe: () => host.hasWorkspaceForProbe(),
        getProbeDiagnostics: () => host.getProbeDiagnostics(),
        resetMetrics: () => {
            metrics.hubScrollReplaceChildren = 0;
            metrics.sidebarListReplaceChildren = 0;
            return readMetrics();
        },
        getMetrics: () => readMetrics(),
        recordWorkHubFirstShowMs: (durationMs: number) => {
            workHubFirstShowMs = Math.round(durationMs);
            if (typeof console !== 'undefined' && typeof console.info === 'function') {
                console.info(`[Qaap work-hub tti] firstShow=${workHubFirstShowMs}ms`);
            }
        },
        getMemorySnapshot: () => {
            const snapshot = readQaapMemorySnapshot();
            logQaapMemorySnapshot(snapshot);
            return snapshot;
        },
        getRuntimeSnapshot: () => ({
            memory: readQaapMemorySnapshot(),
            workHubFirstShowMs,
            lastNavigation,
        }),
        getLastChatUiPerf: (): QaapChatUiPerfTurnSnapshot | undefined => window.__qaapLastChatUiPerf,
        measureOpenConversation: async (conversationId: string): Promise<QaapNavigationTimingResult> => {
            metrics.hubScrollReplaceChildren = 0;
            metrics.sidebarListReplaceChildren = 0;
            const startedAt = performance.now();
            performance.mark('qaap-sidebar-chat-start');
            await host.openProbeConversation(conversationId);
            const historyVisible = await waitForTranscriptHistoryVisible();
            const durationMs = Math.round(performance.now() - startedAt);
            performance.mark('qaap-sidebar-chat-end');
            try {
                performance.measure('qaap-sidebar-to-chat', 'qaap-sidebar-chat-start', 'qaap-sidebar-chat-end');
            } catch {
                /* duplicate measure in repeated runs */
            }
            const probeMetrics = readMetrics();
            lastNavigation = {
                conversationId,
                durationMs,
                historyVisible,
                hubScrollReplaceChildren: probeMetrics.hubScrollReplaceChildren,
                inlineExecutionConnected: probeMetrics.inlineExecutionConnected,
            };
            if (typeof console !== 'undefined' && typeof console.info === 'function') {
                console.info([
                    '[Qaap work-hub navigation]',
                    `conversation=${conversationId}`,
                    `duration=${durationMs}ms`,
                    `historyVisible=${historyVisible}`,
                    `hubRebuilds=${probeMetrics.hubScrollReplaceChildren}`,
                    `inline=${probeMetrics.inlineExecutionConnected}`,
                ].join(' '));
            }
            return lastNavigation;
        },
        sampleStreamingPerf: async (options?: {
            durationMs?: number;
            burstCount?: number;
            conversationId?: string;
        }): Promise<QaapWorkHubStreamingPerfSample | undefined> => {
            activeFpsSampler?.dispose();
            const sampler = new QaapWorkHubFpsSampler();
            activeFpsSampler = sampler;
            const durationMs = options?.durationMs ?? 2_000;
            const burstCount = options?.burstCount ?? 12;
            const conversationId = options?.conversationId ?? host.getTranscriptOpenSummaryId();
            sampler.start();
            const burstIntervalMs = Math.max(16, Math.floor(durationMs / Math.max(burstCount, 1)));
            for (let index = 0; index < burstCount; index++) {
                if (conversationId) {
                    host.conversations?.perfProbeEmitStreamingDelta(conversationId);
                } else {
                    host.tickProbeStreamingConversations();
                }
                await sleep(burstIntervalMs);
            }
            await sleep(Math.max(0, durationMs - burstIntervalMs * burstCount));
            const fps = sampler.stop();
            activeFpsSampler = undefined;
            sampler.dispose();
            logQaapFpsSample(fps);
            return { fps, burstCount };
        },
    };

    window.__qaapWorkHubPerfProbe = api;
}

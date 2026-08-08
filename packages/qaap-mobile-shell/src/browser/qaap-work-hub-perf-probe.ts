// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    enableTranscriptRenderMetrics,
    getTranscriptRenderMetricsSnapshot,
    resetTranscriptRenderMetrics,
} from '../common/qaap-transcript-render-metrics';
import {
    appendLongTranscriptProbeDelta,
    buildLongTranscriptProbeConversation,
    type TranscriptPerfProbeOptions,
} from './qaap-work-hub-perf-probe-host';
import {
    isQaapWorkHubPerfProbeEnabled,
    type QaapWorkHubPerfProbeApi,
    type QaapWorkHubPerfProbeMetrics,
} from '../common/qaap-work-hub-perf-probe';
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
    renderTranscriptForProbe(conversation: import('../common/qaap-agent-conversation-client').QaapAgentConversationDTO, host: HTMLElement): void;
    openWorkHubSessionsSidebar(): void;
    navigateToHomeHubForProbe(): void;
    expandMissionControlForProbe(): void;
    showTasksInboxWithTeamForProbe(): void;
    seedMultiAgentProbeConversations(): void;
    tickProbeStreamingConversations(): void;
    hasProjectsForProbe(): boolean;
    hasWorkspaceForProbe(): boolean;
    getWorkspaceCwdForProbe(): string | undefined;
    getProbeDiagnostics(): import('../common/qaap-work-hub-perf-probe').WorkHubPerfProbeDiagnostics;
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
    let transcriptProbeConversation: import('../common/qaap-agent-conversation-client').QaapAgentConversationDTO | undefined;
    let transcriptProbeTick = 0;
    enableTranscriptRenderMetrics(true);

    const ensureTranscriptProbeChatHost = (): HTMLElement => {
        const existing = host.getTranscriptChatHost();
        if (existing?.dataset.qaapPerfProbe === '1' && existing.isConnected) {
            return existing;
        }
        let transcriptSheet = host.getTranscriptSheet();
        if (!transcriptSheet?.isConnected) {
            transcriptSheet = document.createElement('div');
            transcriptSheet.className = 'theia-mobile-agent-transcript-root theia-mod-visible';
            document.body.append(transcriptSheet);
            host.setTranscriptSheet(transcriptSheet);
        }
        const transcriptChatHost = document.createElement('div');
        transcriptChatHost.className = 'theia-mobile-agent-transcript-real-chat';
        transcriptChatHost.dataset.qaapPerfProbe = '1';
        const connectedExistingParent = existing?.parentElement?.isConnected === true
            ? existing.parentElement
            : undefined;
        (connectedExistingParent ?? transcriptSheet).append(transcriptChatHost);
        host.setTranscriptChatHost(transcriptChatHost);
        return transcriptChatHost;
    };

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
        transcriptRenderMetrics: getTranscriptRenderMetricsSnapshot(),
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
                ensureTranscriptProbeChatHost();
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
            host.getSessionsSidebar()?.show();
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
        renderLongTranscriptForProbe: (options?: TranscriptPerfProbeOptions) => {
            const cwd = host.getWorkspaceCwdForProbe() ?? '/workspace/perf-probe';
            transcriptProbeConversation = buildLongTranscriptProbeConversation(cwd, options);
            transcriptProbeTick = 0;
            const transcriptChatHost = ensureTranscriptProbeChatHost();
            host.setTranscriptOpenSummaryId(transcriptProbeConversation.id);
            host.renderTranscriptForProbe(transcriptProbeConversation, transcriptChatHost);
        },
        tickLongTranscriptForProbe: (options?: { readonly charsPerTick?: number }) => {
            if (!transcriptProbeConversation) {
                return;
            }
            transcriptProbeTick++;
            transcriptProbeConversation = appendLongTranscriptProbeDelta(
                transcriptProbeConversation,
                transcriptProbeTick,
                options?.charsPerTick,
            );
            const transcriptChatHost = ensureTranscriptProbeChatHost();
            host.renderTranscriptForProbe(transcriptProbeConversation, transcriptChatHost);
        },
        hasProjectsForProbe: () => host.hasProjectsForProbe(),
        hasWorkspaceForProbe: () => host.hasWorkspaceForProbe(),
        getProbeDiagnostics: () => host.getProbeDiagnostics(),
        resetMetrics: () => {
            metrics.hubScrollReplaceChildren = 0;
            metrics.sidebarListReplaceChildren = 0;
            resetTranscriptRenderMetrics();
            return readMetrics();
        },
        getMetrics: () => readMetrics(),
    };

    window.__qaapWorkHubPerfProbe = api;
}

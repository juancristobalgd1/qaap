// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY } from '../common/qaap-work-hub-perf-probe';
import { installQaapWorkHubPerfProbe } from './qaap-work-hub-perf-probe';

describe('qaap-work-hub-perf-probe', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
        if (typeof window !== 'undefined') {
            delete window.__qaapWorkHubPerfProbe;
        }
    });

    beforeEach(() => {
        window.sessionStorage.setItem(QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY, '1');
        delete window.__qaapWorkHubPerfProbe;
    });

    it('installs window probe API and counts hub scroll replaceChildren', () => {
        const scroll = document.createElement('div');
        let transcriptOpenSummaryId: string | undefined;
        let transcriptSheet: HTMLElement | undefined;
        let transcriptChatHost: HTMLElement | undefined;

        installQaapWorkHubPerfProbe({
            scroll,
            conversations: undefined,
            getSessionsSidebar: () => undefined,
            getTranscriptSheet: () => transcriptSheet,
            setTranscriptSheet: value => { transcriptSheet = value; },
            getTranscriptChatHost: () => transcriptChatHost,
            setTranscriptChatHost: value => { transcriptChatHost = value; },
            getTranscriptOpenSummaryId: () => transcriptOpenSummaryId,
            setTranscriptOpenSummaryId: value => { transcriptOpenSummaryId = value; },
            openWorkHubSessionsSidebar: () => undefined,
            navigateToHomeHubForProbe: () => undefined,
            expandMissionControlForProbe: () => undefined,
            showTasksInboxWithTeamForProbe: () => undefined,
            seedMultiAgentProbeConversations: () => undefined,
            tickProbeStreamingConversations: () => undefined,
            openProbeConversation: async () => undefined,
            hasProjectsForProbe: () => true,
            hasWorkspaceForProbe: () => true,
            getProbeDiagnostics: () => ({
                projectCount: 1,
                mcRowCount: 0,
                teamRowCount: 0,
                hubView: 'tasks',
            }),
        });

        expect(window.__qaapWorkHubPerfProbe).to.not.equal(undefined);
        window.__qaapWorkHubPerfProbe?.resetMetrics();
        scroll.replaceChildren(document.createElement('span'));
        expect(window.__qaapWorkHubPerfProbe?.getMetrics().hubScrollReplaceChildren).to.equal(1);
    });

    it('mounts a synthetic transcript overlay for probe scenarios', () => {
        const scroll = document.createElement('div');
        let transcriptOpenSummaryId: string | undefined;
        let transcriptSheet: HTMLElement | undefined;
        let transcriptChatHost: HTMLElement | undefined;

        installQaapWorkHubPerfProbe({
            scroll,
            conversations: undefined,
            getSessionsSidebar: () => undefined,
            getTranscriptSheet: () => transcriptSheet,
            setTranscriptSheet: value => { transcriptSheet = value; },
            getTranscriptChatHost: () => transcriptChatHost,
            setTranscriptChatHost: value => { transcriptChatHost = value; },
            getTranscriptOpenSummaryId: () => transcriptOpenSummaryId,
            setTranscriptOpenSummaryId: value => { transcriptOpenSummaryId = value; },
            openWorkHubSessionsSidebar: () => undefined,
            navigateToHomeHubForProbe: () => undefined,
            expandMissionControlForProbe: () => undefined,
            showTasksInboxWithTeamForProbe: () => undefined,
            seedMultiAgentProbeConversations: () => undefined,
            tickProbeStreamingConversations: () => undefined,
            openProbeConversation: async () => undefined,
            hasProjectsForProbe: () => true,
            hasWorkspaceForProbe: () => true,
            getProbeDiagnostics: () => ({
                projectCount: 1,
                mcRowCount: 0,
                teamRowCount: 0,
                hubView: 'tasks',
            }),
        });

        window.__qaapWorkHubPerfProbe?.setTranscriptOverlayOpenForProbe(true);
        expect(transcriptOpenSummaryId).to.equal('__qaap_work_hub_perf_probe__');
        expect(window.__qaapWorkHubPerfProbe?.getMetrics().chatHostConnected).to.equal(true);
    });
});

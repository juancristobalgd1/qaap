// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY } from '../common/qaap-work-hub-perf-probe';
import { installQaapWorkHubPerfProbe, type QaapWorkHubPerfProbeHost } from './qaap-work-hub-perf-probe';

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
            renderTranscriptForProbe: () => undefined,
            openWorkHubSessionsSidebar: () => undefined,
            navigateToHomeHubForProbe: () => undefined,
            expandMissionControlForProbe: () => undefined,
            showTasksInboxWithTeamForProbe: () => undefined,
            seedMultiAgentProbeConversations: () => undefined,
            tickProbeStreamingConversations: () => undefined,
            hasProjectsForProbe: () => true,
            hasWorkspaceForProbe: () => true,
            getWorkspaceCwdForProbe: () => '/workspace',
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
            renderTranscriptForProbe: () => undefined,
            openWorkHubSessionsSidebar: () => undefined,
            navigateToHomeHubForProbe: () => undefined,
            expandMissionControlForProbe: () => undefined,
            showTasksInboxWithTeamForProbe: () => undefined,
            seedMultiAgentProbeConversations: () => undefined,
            tickProbeStreamingConversations: () => undefined,
            hasProjectsForProbe: () => true,
            hasWorkspaceForProbe: () => true,
            getWorkspaceCwdForProbe: () => '/workspace',
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

    it('rebinds the probe to the current Work Hub after a panel remount', () => {
        const createHost = (openWorkHubSessionsSidebar: () => void): QaapWorkHubPerfProbeHost => ({
            scroll: document.createElement('div'),
            conversations: undefined,
            getSessionsSidebar: () => undefined,
            getTranscriptSheet: () => undefined,
            setTranscriptSheet: () => undefined,
            getTranscriptChatHost: () => undefined,
            setTranscriptChatHost: () => undefined,
            getTranscriptOpenSummaryId: () => undefined,
            setTranscriptOpenSummaryId: () => undefined,
            renderTranscriptForProbe: () => undefined,
            openWorkHubSessionsSidebar,
            navigateToHomeHubForProbe: () => undefined,
            expandMissionControlForProbe: () => undefined,
            showTasksInboxWithTeamForProbe: () => undefined,
            seedMultiAgentProbeConversations: () => undefined,
            tickProbeStreamingConversations: () => undefined,
            hasProjectsForProbe: () => true,
            hasWorkspaceForProbe: () => true,
            getWorkspaceCwdForProbe: () => '/workspace',
            getProbeDiagnostics: () => ({
                projectCount: 1,
                mcRowCount: 0,
                teamRowCount: 0,
                hubView: 'tasks',
            }),
        });
        let staleOpenCount = 0;
        let currentOpenCount = 0;

        installQaapWorkHubPerfProbe(createHost(() => staleOpenCount++));
        installQaapWorkHubPerfProbe(createHost(() => currentOpenCount++));
        window.__qaapWorkHubPerfProbe?.openSessionsSidebarForProbe();

        expect(staleOpenCount).to.equal(0);
        expect(currentOpenCount).to.equal(1);
    });
});

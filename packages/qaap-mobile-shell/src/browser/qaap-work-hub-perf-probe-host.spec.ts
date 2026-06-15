// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY } from '../common/qaap-work-hub-perf-probe';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileProjectsService } from './mobile-projects-service';
import {
    buildProbeConversationDTO,
    buildProbeStreamingSummaries,
    ensureProbeWorkspaceProject,
    QAAP_PROBE_WORKSPACE_PROJECT_ID,
} from './qaap-work-hub-perf-probe-host';

describe('qaap-work-hub-perf-probe-host', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    beforeEach(() => {
        window.sessionStorage.setItem(QAAP_WORK_HUB_PERF_PROBE_SESSION_KEY, '1');
    });

    it('buildProbeStreamingSummaries returns three streaming agents', () => {
        const summaries = buildProbeStreamingSummaries('/workspace/demo');
        expect(summaries).to.have.length(3);
        expect(summaries.every(summary => summary.status === 'streaming')).to.equal(true);
        expect(summaries.every(summary => summary.cwd === '/workspace/demo')).to.equal(true);
    });

    it('ensureProbeWorkspaceProject adds a synthetic current project when none maps to cwd', () => {
        const workspaceCwd = '/workspace/cloud-ws-demo';
        const projectsService = {
            getProjectCwd: () => undefined,
            getCurrentWorkspaceName: () => 'cloud-ws-demo',
        } as unknown as MobileProjectsService;
        const next = ensureProbeWorkspaceProject([], projectsService, workspaceCwd);
        expect(next).to.have.length(1);
        expect(next[0].id).to.equal(QAAP_PROBE_WORKSPACE_PROJECT_ID);
        expect(next[0].isCurrent).to.equal(true);
    });

    it('ensureProbeWorkspaceProject keeps existing projects when cwd already maps', () => {
        const workspaceCwd = '/workspace/cloud-ws-demo';
        const existing: MobileProjectEntry = {
            id: 'repo-a',
            name: 'repo-a',
            color: '#000',
            branch: 'main',
            status: 'working',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '0',
            pinned: false,
            isCurrent: true,
        };
        const projectsService = {
            getProjectCwd: (project: MobileProjectEntry) => project.id === 'repo-a' ? workspaceCwd : undefined,
            getCurrentWorkspaceName: () => 'repo-a',
        } as unknown as MobileProjectsService;
        const next = ensureProbeWorkspaceProject([existing], projectsService, workspaceCwd);
        expect(next).to.have.length(1);
        expect(next[0].id).to.equal('repo-a');
    });

    it('buildProbeConversationDTO includes assistant history blocks', () => {
        const [summary] = buildProbeStreamingSummaries('/workspace/demo');
        const conversation = buildProbeConversationDTO(summary);
        expect(conversation.messages.length).to.be.greaterThan(1);
        expect(conversation.messages.some(message => message.role === 'agent')).to.equal(true);
    });
});

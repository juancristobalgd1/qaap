// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import { MobileProjectsHubHeaderUi, type MobileProjectsHubHeaderHost } from './mobile-projects-hub-header-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('MobileProjectsHubHeaderUi', () => {

    beforeEach(() => {
        if (typeof document === 'undefined') {
            enableJSDOM();
        }
    });
    function project(id: string, name: string): MobileProjectEntry {
        return {
            id,
            name,
            color: '#8EB5DC',
            branch: 'main',
            status: 'idle',
            task: '',
            progress: 0,
            agents: [],
            lastActive: 'now',
            tokens: '0',
            cost: '$0',
            pinned: false,
            isCurrent: false,
        };
    }

    function createHost(options?: {
        readonly agentsHubInlineActive?: boolean;
        readonly agentsHubShellActive?: boolean;
        readonly transcriptOpenProject?: MobileProjectEntry;
        readonly shellProject?: MobileProjectEntry;
        readonly activeTab?: 'messages' | 'terminal';
    }): MobileProjectsHubHeaderHost {
        const shellProject = options?.shellProject;
        const activeTab = options?.activeTab ?? 'messages';
        return {
            sessionsMenuBtn: document.createElement('button'),
            headerNewChatBtn: document.createElement('button'),
            headerOverflowMenuBtn: document.createElement('button'),
            headerBackBtn: document.createElement('button'),
            titleBlock: document.createElement('div'),
            titleEl: document.createElement('h1'),
            titleAttentionEl: document.createElement('span'),
            accountBtn: document.createElement('button'),
            homeMode: true,
            hubView: 'tasks',
            agentsHubInlineActive: options?.agentsHubInlineActive ?? false,
            agentsHubShellActive: options?.agentsHubShellActive ?? false,
            transcriptOpenProject: options?.transcriptOpenProject,
            transcriptOpenSummary: undefined,
            isProjectDetailView: () => false,
            isProjectDiffView: () => false,
            shouldUseAgentsHubLanding: () => true,
            resolveAgentsHubShellProject: () => shellProject,
            hubQueryUi: {} as MobileProjectsHubHeaderHost['hubQueryUi'],
            projectNavigationUi: {} as MobileProjectsHubHeaderHost['projectNavigationUi'],
            transcriptHeaderUi: {} as MobileProjectsHubHeaderHost['transcriptHeaderUi'],
            transcriptSheetUi: {} as MobileProjectsHubHeaderHost['transcriptSheetUi'],
            executionSurfaceTabsUi: {
                executionSurfaceTabForProject: () => activeTab,
            } as unknown as MobileProjectsHubHeaderHost['executionSurfaceTabsUi'],
            updateTasksAttentionChrome: () => undefined,
            buildHomeGreeting: () => 'Hello',
            scroll: document.createElement('div'),
            lastTitleTap: 0,
            closeAgentsHubSession: () => undefined,
            closeProjectDiffView: () => undefined,
            closeProjectDetail: () => undefined,
            openWorkHubSessionsSidebar: () => undefined,
        };
    }

    it('shows New agent only when the chat execution surface is active', () => {
        const current = project('mockup', 'Mockup');
        const ui = new MobileProjectsHubHeaderUi(createHost({
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
            activeTab: 'messages',
        }));
        expect(ui.resolveHeaderNewChatVisible()).to.equal(true);
    });

    it('hides New agent when a non-chat execution surface is active', () => {
        const current = project('mockup', 'Mockup');
        const ui = new MobileProjectsHubHeaderUi(createHost({
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
            activeTab: 'terminal',
        }));
        expect(ui.resolveHeaderNewChatVisible()).to.equal(false);
    });

    it('hides New agent on agents hub landing without an execution shell', () => {
        const ui = new MobileProjectsHubHeaderUi(createHost());
        expect(ui.resolveHeaderNewChatVisible()).to.equal(false);
    });

    it('shows the header overflow menu only when the chat execution surface is active', () => {
        const current = project('mockup', 'Mockup');
        const ui = new MobileProjectsHubHeaderUi(createHost({
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
            activeTab: 'messages',
        }));
        expect(ui.resolveHeaderOverflowMenuVisible()).to.equal(true);

        const terminalUi = new MobileProjectsHubHeaderUi(createHost({
            agentsHubInlineActive: true,
            transcriptOpenProject: current,
            activeTab: 'terminal',
        }));
        expect(terminalUi.resolveHeaderOverflowMenuVisible()).to.equal(false);
    });
});

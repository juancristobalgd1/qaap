// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { MobileProjectsHomeUi } from './mobile-projects-home-ui';
import { MobileProjectsHomeHubUi, type MobileProjectsHomeHubHost } from './mobile-projects-home-hub-ui';

disableImportJSDOM();

describe('MobileProjectsHomeHubUi.resolveHomePinnedProject', () => {

    function project(id: string, name: string, options?: { cwd?: string; fullName?: string; pinned?: boolean }): MobileProjectEntry & { cwd?: string } {
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
            pinned: options?.pinned ?? false,
            isCurrent: false,
            github: options?.fullName
                ? { owner: options.fullName.split('/')[0], name: options.fullName.split('/')[1], fullName: options.fullName, htmlUrl: '', private: false }
                : undefined,
            cwd: options?.cwd,
        };
    }

    function createUi(projects: MobileProjectEntry[]): { ui: MobileProjectsHomeHubUi; host: MobileProjectsHomeHubHost } {
        const host = {
            projects,
            agentsHubSelectedProjectId: undefined,
            projectsService: {
                // Hosted Work Hub: the workspace is the multi-repo container, so nothing matches.
                resolveCurrentWorkspaceProject: () => undefined,
                getProjectCwd: (entry: MobileProjectEntry & { cwd?: string }) => entry.cwd,
            },
        } as unknown as MobileProjectsHomeHubHost;
        return { ui: new MobileProjectsHomeHubUi(host), host };
    }

    const vyyqCwd = '/workspace/repos/users/alice/alice/vyyq';

    it('keeps the first painted project when the loaded list re-ids and re-sorts it', () => {
        // First paint: cached project sessions (local recency).
        const { ui, host } = createUi([
            project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd, fullName: 'alice/vyyq' }),
            project('github:alice/OpenDots', 'OpenDots', { fullName: 'alice/OpenDots' }),
        ]);
        expect(ui.resolveHomePinnedProject()?.name).to.equal('vyyq');

        // primeVisiblePanelData(): fresh loadProjects() with other ids and server recency.
        host.projects = [
            project('github:alice/OpenDots', 'OpenDots', { fullName: 'alice/OpenDots' }),
            project(`recent:file://${vyyqCwd}`, 'vyyq', { cwd: vyyqCwd }),
        ];
        expect(ui.resolveHomePinnedProject()?.id).to.equal(`recent:file://${vyyqCwd}`);
    });

    it('still lets an explicit selection or a pinned project take the header', () => {
        const { ui, host } = createUi([
            project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd }),
            project('github:alice/OpenDots', 'OpenDots'),
        ]);
        expect(ui.resolveHomePinnedProject()?.name).to.equal('vyyq');

        host.projects = [project('github:alice/OpenDots', 'OpenDots', { pinned: true }), project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd })];
        expect(ui.resolveHomePinnedProject()?.name).to.equal('OpenDots');

        host.projects = [project('github:alice/OpenDots', 'OpenDots'), project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd }), project('other', 'other')];
        host.agentsHubSelectedProjectId = 'other';
        expect(ui.resolveHomePinnedProject()?.name).to.equal('other');
    });

    it('falls back to the most recent project once the shown one is gone', () => {
        const { ui, host } = createUi([project('github:alice/vyyq', 'vyyq', { cwd: vyyqCwd })]);
        expect(ui.resolveHomePinnedProject()?.name).to.equal('vyyq');

        host.projects = [project('github:alice/OpenDots', 'OpenDots')];
        expect(ui.resolveHomePinnedProject()?.name).to.equal('OpenDots');
    });
});

describe('MobileProjectsHomeHubUi.buildHomeSnapshot statsSettled', () => {

    useSuiteJSDOM();

    // Account-scoped keys too: a checklist flag left by one test must not hide the checklist in the next.
    function clearGettingStartedFlags(): void {
        const keys: string[] = [];
        for (let i = 0; i < window.localStorage.length; i++) {
            const key = window.localStorage.key(i);
            if (key?.startsWith('qaap.workHubHome.gettingStarted')) {
                keys.push(key);
            }
        }
        keys.forEach(key => window.localStorage.removeItem(key));
    }

    beforeEach(() => clearGettingStartedFlags());
    afterEach(() => clearGettingStartedFlags());

    function createHost(state: { inboxLoaded: boolean; tasksPending: boolean }): MobileProjectsHomeHubHost {
        return {
            projects: [],
            inboxPullRequests: [],
            get inboxPullRequestsLoaded(): boolean { return state.inboxLoaded; },
            get tasksFirstLoadPending(): boolean { return state.tasksPending; },
            chatAgentService: undefined,
            collectTeamMembersForHub: () => [],
            collectTeamApprovalItems: () => [],
            countTasksAttention: () => ({ needsYou: 0, running: 0 }),
            missionControlHubUi: { collectItems: () => [] },
            conversationIndexUi: { conversationsForProject: () => [], localChatsForProject: () => [] },
        } as unknown as MobileProjectsHomeHubHost;
    }

    it('stays unsettled until both the inbox and the first task load landed, then repaints the checklist', () => {
        const state = { inboxLoaded: true, tasksPending: true };
        const ui = new MobileProjectsHomeHubUi(createHost(state));
        const home = new MobileProjectsHomeUi({
            getProject: () => undefined, getWorkspaceActivity: () => '', getWorkspaceStatus: () => 'idle',
            formatRelativeTime: () => '', onNavigate: () => undefined, onCloneProject: () => undefined,
            onOpenProject: () => undefined, onOpenRecent: () => undefined, onOpenAttention: () => undefined,
            onQuickAction: () => undefined,
        });

        const first = ui.buildHomeSnapshot();
        expect(first.statsSettled).to.equal(false);
        const early = document.createElement('div');
        home.renderDashboard(early, first);
        expect(early.querySelector('.theia-mobile-work-hub-home-getting-started')).to.equal(null);

        state.tasksPending = false; // tasks finish after the inbox
        const settled = ui.buildHomeSnapshot();
        expect(settled.statsSettled).to.equal(true);
        const later = document.createElement('div');
        home.renderDashboard(later, settled);
        expect(later.querySelector('.theia-mobile-work-hub-home-getting-started')).to.not.equal(null);
    });

    it('keeps Home settled after the Review tab resets inboxPullRequestsLoaded', () => {
        const state = { inboxLoaded: true, tasksPending: false };
        const ui = new MobileProjectsHomeHubUi(createHost(state));
        expect(ui.buildHomeSnapshot().statsSettled).to.equal(true);
        state.inboxLoaded = false; // entering Review
        expect(ui.buildHomeSnapshot().statsSettled).to.equal(true);
    });
    it('resets the settled latch when another account signs in, but not when the session first becomes known', () => {
        const state = { inboxLoaded: true, tasksPending: false };
        const ui = new MobileProjectsHomeHubUi(createHost(state));
        expect(ui.trackInboxEverLoaded(undefined)).to.equal(true);
        state.inboxLoaded = false; // entering Review
        expect(ui.trackInboxEverLoaded('alice')).to.equal(true); // undefined -> alice: same session
        expect(ui.trackInboxEverLoaded('alice')).to.equal(true);
        expect(ui.trackInboxEverLoaded('bob')).to.equal(false); // account switch: unsettled again
        state.inboxLoaded = true;
        expect(ui.trackInboxEverLoaded('bob')).to.equal(true);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import { buildWorkHubHomeUsageSummary } from '../common/qaap-work-hub-usage-summary';
import type { WorkHubHomeSnapshot } from '../common/qaap-work-hub-home';
import { MobileProjectsHomeUi, type MobileProjectsHomeUiDeps } from './mobile-projects-home-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('MobileProjectsHomeUi', () => {
    let disableJSDOM: () => void;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
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
            lastActive: 'just now',
            tokens: '0',
            cost: '$0',
            pinned: true,
            isCurrent: false,
        };
    }

    function snapshot(overrides: Partial<WorkHubHomeSnapshot['stats']> = {}): WorkHubHomeSnapshot {
        return {
            stats: {
                projectCount: 0,
                runningTasks: 0,
                needsYou: 0,
                openPullRequests: 0,
                localChatCount: 0,
                ...overrides,
            },
            usageSummary: buildWorkHubHomeUsageSummary([], { now: Date.parse('2026-09-04T12:00:00.000Z') }),
            attentionItems: [],
            recentItems: [],
            pinnedProjectIds: [],
        };
    }

    function createDeps(projects: MobileProjectEntry[] = []): MobileProjectsHomeUiDeps & { quickActions: string[]; navigations: string[] } {
        const quickActions: string[] = [];
        const navigations: string[] = [];
        return {
            quickActions,
            navigations,
            getProject: id => projects.find(candidate => candidate.id === id),
            getWorkspaceActivity: () => 'Ready to work',
            getWorkspaceStatus: () => 'idle',
            formatRelativeTime: () => 'just now',
            onNavigate: target => navigations.push(target),
            onOpenProject: () => undefined,
            onOpenRecent: () => undefined,
            onOpenAttention: () => undefined,
            onQuickAction: action => quickActions.push(action),
        };
    }

    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('renders the complete first-run dashboard with discoverable actions', () => {
        const deps = createDeps();
        const host = document.createElement('div');

        new MobileProjectsHomeUi(deps).renderDashboard(host, snapshot());

        expect(host.querySelector('.theia-mobile-work-hub-home-getting-started')).to.not.equal(null);
        expect(host.querySelector('.theia-mobile-work-hub-home-shortcuts-panel')).to.not.equal(null);
        expect(host.textContent).to.contain('Get started');
        expect(host.textContent).to.contain('Connect a repository');
        expect(host.textContent).to.contain('Activity');

        const addRepository = [...host.querySelectorAll('button')]
            .find(button => button.textContent?.includes('Add repository'));
        addRepository?.click();
        expect(deps.navigations).to.deep.equal(['repos']);
    });

    it('shows attention, workspaces, and continue sections once work exists', () => {
        const demo = project('demo', 'Demo');
        const deps = createDeps([demo]);
        const host = document.createElement('div');
        const current: WorkHubHomeSnapshot = {
            ...snapshot({ projectCount: 1, needsYou: 1, openPullRequests: 1 }),
            pinnedProjectIds: ['demo'],
            attentionItems: [{
                id: 'approval-1',
                kind: 'approval',
                title: '@qaiq',
                subtitle: 'Approval required',
            }],
            recentItems: [{
                id: 'task-1',
                projectId: 'demo',
                projectName: 'Demo',
                title: 'Improve the dashboard',
                subtitle: 'VPS task',
                surface: 'task',
                updatedAt: Date.now(),
            }],
        };

        new MobileProjectsHomeUi(deps).renderDashboard(host, current);

        expect(host.querySelector('.theia-mobile-work-hub-home-getting-started')).to.equal(null);
        expect(host.querySelector('.theia-mobile-work-hub-home-section-panel.theia-mod-attention')).to.not.equal(null);
        expect(host.textContent).to.contain('Demo');
        expect(host.textContent).to.contain('Improve the dashboard');
        expect(host.querySelector('.theia-mobile-work-hub-home-usage')).to.not.equal(null);

        const activityShortcut = [...host.querySelectorAll<HTMLButtonElement>(
            '.theia-mobile-work-hub-home-shortcut-cell',
        )].find(button => button.textContent?.includes('Activity'));
        activityShortcut?.click();
        expect(deps.quickActions).to.deep.equal(['open-tasks']);
    });
});

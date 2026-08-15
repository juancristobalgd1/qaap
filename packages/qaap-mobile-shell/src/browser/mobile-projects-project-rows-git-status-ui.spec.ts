// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { MobileProjectTaskView } from './mobile-projects-active-tasks';
import {
    MobileProjectsProjectRowsUi,
    type MobileProjectsProjectRowsHost,
} from './mobile-projects-project-rows-ui';
import type { MobileProjectEntry } from './mobile-projects-types';

describe('MobileProjectsProjectRowsUi Git/PR status', () => {
    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => disableJSDOM?.());

    const project: MobileProjectEntry = {
        id: 'app',
        name: 'App',
        color: '#8eb5dc',
        branch: 'feature',
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

    const task: MobileProjectTaskView = {
        id: 'conversation-1',
        title: 'Fix the sidebar',
        command: '',
        cwd: '/workspace/app',
        state: 'completed',
        createdAt: Date.now(),
        finishedAt: Date.now(),
    };

    function summary(
        linkedPullRequest: QaapAgentConversationSummaryDTO['linkedPullRequest'],
    ): QaapAgentConversationSummaryDTO {
        return {
            id: 'conversation-1',
            source: 'theia-chat',
            cwd: '/workspace/app',
            agentId: 'qaiq',
            title: task.title,
            status: 'idle',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 1,
            linkedPullRequest,
        };
    }

    function createUi(): MobileProjectsProjectRowsUi {
        const host = {
            homeMode: false,
            hubView: 'tasks',
            expandedConversationProjectIds: new Set<string>(),
            preparedCwdByProjectId: new Map<string, string>(),
            projectsService: {},
            delegate: { onProjectOpen: () => undefined },
            cardMenuUi: {
                buildConversationMenu: () => document.createElement('div'),
                toggleCardMenu: () => undefined,
            },
            conversationIndexUi: {
                isConversationUnread: () => false,
                resolveConversationLineage: () => 'none',
                resolveConversationFlags: () => ({ priority: false, paused: false }),
            },
            conversationOpenUi: {
                prefetchConversationDocument: () => undefined,
                openConversationSummary: async () => undefined,
                openTaskInAgent: async () => undefined,
            },
            onRetryConversation: async () => undefined,
            openTaskInAgent: async () => undefined,
        } as unknown as MobileProjectsProjectRowsHost;
        return new MobileProjectsProjectRowsUi(host);
    }

    it('renders an open ready PR in green semantics with icon and accessible name', () => {
        const row = createUi().createTaskItem(
            project,
            task,
            undefined,
            summary({ owner: 'acme', repo: 'app', number: 12, state: 'open' }),
            new Set(),
            { compact: true },
        );
        const glyph = row.querySelector<HTMLElement>('.theia-mobile-projects-task-dot');
        expect(glyph?.classList.contains('theia-mod-pr-ready')).to.equal(true);
        expect(glyph?.querySelector('.codicon-git-pull-request')).not.to.equal(null);
        expect(glyph?.getAttribute('aria-label')).to.equal('PR ready');
        expect(row.querySelector('.theia-mobile-projects-task-status-chip')).to.equal(null);
    });

    it('renders merged purple semantics only for an explicit merged state', () => {
        const row = createUi().createTaskItem(
            project,
            task,
            undefined,
            summary({ owner: 'acme', repo: 'app', number: 12, state: 'merged' }),
            new Set(),
            { compact: true },
        );
        expect(row.querySelector('.theia-mod-pr-merged .codicon-git-merge')).not.to.equal(null);
        expect(row.querySelector('.theia-mobile-projects-task-status-chip')).to.equal(null);
        expect(row.querySelector('.theia-mod-pr-ready')).to.equal(null);
    });

    it('renders a legacy unresolved PR link as neutral PR, never ready or merged', () => {
        const row = createUi().createTaskItem(
            project,
            task,
            undefined,
            summary({ owner: 'acme', repo: 'app', number: 12 }),
            new Set(),
            { compact: true },
        );
        expect(row.querySelector('.theia-mod-pr-unknown .codicon-git-pull-request')).not.to.equal(null);
        expect(row.querySelector('.theia-mobile-projects-task-status-chip')).to.equal(null);
        expect(row.querySelector('.theia-mod-pr-ready, .theia-mod-pr-merged')).to.equal(null);
    });

    it('selection mode toggles checkbox instead of opening the transcript', async () => {
        let toggled = 0;
        let opened = 0;
        const host = {
            homeMode: false,
            hubView: 'tasks',
            expandedConversationProjectIds: new Set<string>(),
            preparedCwdByProjectId: new Map<string, string>(),
            projectsService: {},
            delegate: { onProjectOpen: () => undefined },
            cardMenuUi: {
                buildConversationMenu: () => document.createElement('div'),
                toggleCardMenu: () => undefined,
            },
            conversationIndexUi: {
                isConversationUnread: () => false,
                resolveConversationLineage: () => 'none',
                resolveConversationFlags: () => ({ priority: false, paused: false }),
            },
            conversationOpenUi: {
                prefetchConversationDocument: () => undefined,
                openConversationSummary: async () => { opened += 1; },
                openTaskInAgent: async () => { opened += 1; },
            },
            onRetryConversation: async () => undefined,
            openTaskInAgent: async () => undefined,
        } as unknown as MobileProjectsProjectRowsHost;
        const ui = new MobileProjectsProjectRowsUi(host);
        const failedSummary: QaapAgentConversationSummaryDTO = {
            ...summary(undefined),
            id: 'failed-1',
            status: 'failed',
        };
        const failedTask = { ...task, id: 'failed-1', state: 'failed' as const };
        const row = ui.createTaskItem(project, failedTask, undefined, failedSummary, new Set(), {
            compact: true,
            selection: {
                selected: true,
                onToggle: () => { toggled += 1; },
            },
        });
        expect(row.classList.contains('theia-mod-clear-failed-select')).to.equal(true);
        expect(row.querySelector('.theia-mobile-projects-task-clear-failed-check.theia-mod-selected')).to.not.equal(null);
        const item = row.querySelector('.theia-mobile-projects-task-item') as HTMLButtonElement;
        item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(toggled).to.equal(1);
        expect(opened).to.equal(0);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectTaskView } from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import {
    MobileProjectsProjectRowsUi,
    type MobileProjectsProjectRowsHost,
} from './mobile-projects-project-rows-ui';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

describe('MobileProjectsProjectRowsUi sidebar hover archive', () => {
    let disableJSDOM: (() => void) | undefined;
    let originalMatchMedia: typeof window.matchMedia | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        originalMatchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        })) as typeof window.matchMedia;
    });

    after(() => {
        if (originalMatchMedia) {
            window.matchMedia = originalMatchMedia;
        }
        disableJSDOM?.();
    });

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
        title: 'Sidebar hover actions',
        command: '',
        cwd: '/workspace/app',
        state: 'completed',
        createdAt: Date.now(),
        finishedAt: Date.now(),
    };

    function summary(
        overrides: Partial<QaapAgentConversationSummaryDTO> = {},
    ): QaapAgentConversationSummaryDTO {
        return {
            id: 'conversation-1',
            source: 'qaap-agent',
            cwd: '/workspace/app',
            agentId: 'qaiq',
            title: task.title,
            status: 'idle',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messageCount: 1,
            ...overrides,
        };
    }

    function createUi(options?: {
        readonly onArchive?: () => void;
    }): MobileProjectsProjectRowsUi {
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
                resolveConversationFlags: () => ({
                    priority: false,
                    paused: false,
                }),
            },
            conversationOpenUi: {
                prefetchConversationDocument: () => undefined,
                openConversationSummary: async () => undefined,
                openTaskInAgent: async () => undefined,
            },
            onRetryConversation: async () => undefined,
            onArchiveConversation: async () => {
                options?.onArchive?.();
            },
            onSetConversationPriority: async (_summary: QaapAgentConversationSummaryDTO, _priority: boolean) => undefined,
            onDeleteConversation: async () => undefined,
            openTaskInAgent: async () => undefined,
        } as unknown as MobileProjectsProjectRowsHost;
        return new MobileProjectsProjectRowsUi(host);
    }

    it('shows only Archive on compact sidebar rows because Pin lives in the overflow menu', () => {
        const row = createUi().createTaskItem(
            project,
            task,
            undefined,
            summary(),
            undefined,
            { compact: true },
        );
        expect(row.classList.contains('theia-mod-sidebar-compact')).to.equal(true);
        const archive = row.querySelector('.theia-mobile-projects-conversation-archive-btn');
        const menu = row.querySelector('.theia-mobile-projects-conversation-menu-btn');
        expect(row.querySelector('.theia-mobile-projects-conversation-pin-btn')).to.equal(null);
        expect(archive).to.not.equal(null);
        expect(archive?.querySelector('.codicon-archive')).to.not.equal(null);
        expect(archive?.getAttribute('aria-label')).to.match(/Archive/i);
        expect(menu).to.not.equal(null);
    });

    it('does not mount pin/archive on non-compact rows the same way (archive only when not archived)', () => {
        const row = createUi().createTaskItem(
            project,
            task,
            undefined,
            summary(),
            undefined,
            { compact: false },
        );
        expect(row.querySelector('.theia-mobile-projects-conversation-pin-btn')).to.equal(null);
        expect(row.querySelector('.theia-mobile-projects-conversation-archive-btn')).to.not.equal(null);
    });

    it('keeps retry actions in the overflow menu instead of mounting direct row buttons', () => {
        const ui = createUi();
        const failedSummary = summary({
            id: 'failed-conversation-1',
            status: 'failed',
        });
        const failedTask = { ...task, id: failedSummary.id, state: 'failed' as const };
        const row = ui.createTaskItem(project, failedTask, undefined, failedSummary, new Set(), { compact: true });
        expect(row.querySelector('.theia-mobile-projects-conversation-retry-btn')).to.equal(null);

        const executedSummary = summary({
            id: 'failed-conversation-with-execution',
            status: 'failed',
            lastTurnAgentId: 'qaiq',
            lastTurnAgentModel: { provider: 'openai', vendor: 'openai', modelId: 'gpt-5.6-luna' },
        });
        const executedTask = { ...task, id: executedSummary.id, state: 'failed' as const };
        const executedRow = ui.createTaskItem(project, executedTask, undefined, executedSummary, new Set(), { compact: true });
        expect(executedRow.querySelector('.theia-mobile-projects-conversation-retry-btn')).to.equal(null);
    });

    it('shows a compact failure reason only when the latest message came from the agent', () => {
        const ui = createUi();
        const failedSummary = summary({
            id: 'failed-conversation-with-reason',
            status: 'failed',
            lastMessageRole: 'agent',
            lastMessagePreview: 'Error: dev server exited with code 1',
        });
        const failedTask = { ...task, id: failedSummary.id, state: 'failed' as const };
        const row = ui.createTaskItem(project, failedTask, undefined, failedSummary, new Set(), { compact: true });

        const hint = row.querySelector('.theia-mobile-projects-task-failure-hint');
        expect(hint).to.not.equal(null);
        expect(hint?.textContent).to.contain('Failed: Error: dev server exited with code 1');
        expect(row.querySelector('.theia-mobile-projects-task-dot')?.getAttribute('aria-label'))
            .to.equal('Failed: Error: dev server exited with code 1');

        const userFailedSummary = summary({
            id: 'failed-conversation-user-message',
            status: 'failed',
            lastMessageRole: 'user',
            lastMessagePreview: 'Deploy this to production',
        });
        const userFailedTask = { ...task, id: userFailedSummary.id, state: 'failed' as const };
        const userFailedRow = ui.createTaskItem(project, userFailedTask, undefined, userFailedSummary, new Set(), { compact: true });
        expect(userFailedRow.querySelector('.theia-mobile-projects-task-failure-hint')).to.equal(null);
        expect(userFailedRow.textContent).not.to.contain('Deploy this to production');
    });
});

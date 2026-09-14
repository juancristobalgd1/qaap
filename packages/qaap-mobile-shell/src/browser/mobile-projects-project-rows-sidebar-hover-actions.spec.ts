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
        readonly onRetry?: () => void;
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
            onRetryConversation: async () => {
                options?.onRetry?.();
            },
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

    it('shows a direct retry action for failed conversations and invokes it without opening the row', async () => {
        let retried = 0;
        let opened = 0;
        const ui = createUi({ onRetry: () => { retried += 1; } });
        const failedSummary = summary({
            id: 'failed-conversation-1',
            status: 'failed',
        });
        const failedTask = { ...task, id: failedSummary.id, state: 'failed' as const };
        const row = ui.createTaskItem(project, failedTask, undefined, failedSummary, new Set(), {
            compact: true,
            onActivate: () => { opened += 1; },
        });
        const retry = row.querySelector<HTMLButtonElement>('.theia-mobile-projects-conversation-retry-btn');
        expect(retry).to.not.equal(null);
        expect(retry?.getAttribute('aria-label')).to.equal('Retry task');
        expect(retry?.querySelector('.codicon-debug-restart')).to.not.equal(null);
        retry?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await Promise.resolve();
        expect(retried).to.equal(1);
        expect(opened).to.equal(0);
    });
});

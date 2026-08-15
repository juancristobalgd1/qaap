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

describe('MobileProjectsProjectRowsUi sidebar hover pin/archive', () => {
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
        readonly priority?: boolean;
        readonly onPin?: (priority: boolean) => void;
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
                    priority: options?.priority === true,
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
            onSetConversationPriority: async (_summary: QaapAgentConversationSummaryDTO, priority: boolean) => {
                options?.onPin?.(priority);
            },
            onDeleteConversation: async () => undefined,
            openTaskInAgent: async () => undefined,
        } as unknown as MobileProjectsProjectRowsHost;
        return new MobileProjectsProjectRowsUi(host);
    }

    it('shows Cursor-style Pin + Archive on compact sidebar rows', () => {
        const row = createUi().createTaskItem(
            project,
            task,
            undefined,
            summary(),
            undefined,
            { compact: true },
        );
        expect(row.classList.contains('theia-mod-sidebar-compact')).to.equal(true);
        const pin = row.querySelector('.theia-mobile-projects-conversation-pin-btn');
        const archive = row.querySelector('.theia-mobile-projects-conversation-archive-btn');
        expect(pin).to.not.equal(null);
        expect(archive).to.not.equal(null);
        expect(pin?.querySelector('.codicon-pin')).to.not.equal(null);
        expect(archive?.querySelector('.codicon-archive')).to.not.equal(null);
        expect(pin?.getAttribute('aria-label')).to.match(/Pin/i);
        expect(archive?.getAttribute('aria-label')).to.match(/Archive/i);
    });

    it('toggles pin priority from the compact hover control', () => {
        const calls: boolean[] = [];
        const row = createUi({
            onPin: priority => calls.push(priority),
        }).createTaskItem(
            project,
            task,
            undefined,
            summary(),
            undefined,
            { compact: true },
        );
        const pin = row.querySelector('.theia-mobile-projects-conversation-pin-btn');
        expect(pin).to.be.instanceOf(HTMLButtonElement);
        (pin as HTMLButtonElement).click();
        expect(calls).to.deep.equal([true]);
    });

    it('shows pinned glyph when the conversation is already priority', () => {
        const row = createUi({ priority: true }).createTaskItem(
            project,
            task,
            undefined,
            summary({ priority: true }),
            undefined,
            { compact: true },
        );
        const pin = row.querySelector('.theia-mobile-projects-conversation-pin-btn');
        expect(pin?.classList.contains('theia-mod-pinned')).to.equal(true);
        expect(pin?.querySelector('.codicon-pinned')).to.not.equal(null);
        expect(pin?.getAttribute('aria-pressed')).to.equal('true');
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
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectTaskView } from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import {
    MobileProjectsProjectRowsUi,
    type MobileProjectsProjectRowsHost,
} from './mobile-projects-project-rows-ui';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

disableImportJSDOM();

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
        readonly onArchive?: (summary: QaapAgentConversationSummaryDTO) => void;
        readonly latestSummary?: QaapAgentConversationSummaryDTO;
        readonly onRetry?: () => void;
        readonly onContinue?: () => void;
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
            onContinueConversation: async () => {
                options?.onContinue?.();
            },
            onArchiveConversation: async (_project: MobileProjectEntry, archived: QaapAgentConversationSummaryDTO) => {
                options?.onArchive?.(archived);
            },
            conversations: options?.latestSummary
                ? { findSummaryById: (id: string) => id === options.latestSummary!.id ? options.latestSummary : undefined }
                : undefined,
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

    it('offers a one-tap Retry chip on a failed row without opening the conversation', async () => {
        let retried = 0;
        let continued = 0;
        let opened = 0;
        const ui = createUi({ onRetry: () => { retried++; }, onContinue: () => { continued++; } });
        const failedSummary = summary({
            id: 'failed-conversation-1',
            status: 'failed',
            lastMessageRole: 'agent',
            lastMessageError: 'Bash exited with code 1.',
        });
        const failedTask = { ...task, id: failedSummary.id, state: 'failed' as const };
        const row = ui.createTaskItem(project, failedTask, undefined, failedSummary, new Set(), {
            compact: true,
            onActivate: () => { opened++; },
        });

        const chip = row.querySelector<HTMLButtonElement>('.theia-mobile-projects-task-failure-hint .theia-mobile-projects-failed-run-chip');
        expect(chip?.textContent).to.equal('Retry');
        expect(chip?.getAttribute('aria-label')).to.equal('Retry task');
        expect(row.querySelector('.theia-mobile-projects-conversation-retry-btn')).to.equal(null);
        chip!.click();
        await Promise.resolve();
        expect([retried, continued, opened]).to.deep.equal([1, 0, 0]);
    });

    it('offers Continue instead of Retry when the turn was interrupted', () => {
        let continued = 0;
        const ui = createUi({ onContinue: () => { continued++; } });
        const interrupted = summary({
            id: 'interrupted-conversation',
            status: 'failed',
            lastMessageRole: 'agent',
            lastMessageError: 'Stopped automatically after 46 min: the turn exceeded the maximum allowed time.',
        });
        const row = ui.createTaskItem(project, { ...task, id: interrupted.id, state: 'failed' as const }, undefined, interrupted, new Set(), { compact: true });

        const chip = row.querySelector<HTMLButtonElement>('.theia-mobile-projects-failed-run-chip');
        expect(chip?.textContent).to.equal('Continue');
        expect(chip?.dataset.qaapFailedRunAction).to.equal('continue');
        chip!.click();
        expect(continued).to.equal(1);
    });

    it('keeps the chip off rows being picked for Clear failed runs', () => {
        const failedSummary = summary({ id: 'failed-selection', status: 'failed', lastMessageRole: 'agent', lastMessageError: 'Bash exited with code 1.' });
        const row = createUi().createTaskItem(project, { ...task, id: failedSummary.id, state: 'failed' as const }, undefined, failedSummary, new Set(), {
            compact: true,
            selection: { selected: false, onToggle: () => undefined },
        });
        expect(row.querySelector('.theia-mobile-projects-failed-run-chip')).to.equal(null);
    });

    it('acts on the latest summary when the row outlived the render that created it', () => {
        const rendered = summary({ title: 'Before rename' });
        const latest = summary({ title: 'After rename', priority: true });
        const archived: QaapAgentConversationSummaryDTO[] = [];
        const row = createUi({ onArchive: value => archived.push(value), latestSummary: latest })
            .createTaskItem(project, task, undefined, rendered, undefined, { compact: true });

        row.querySelector<HTMLButtonElement>('.theia-mobile-projects-conversation-archive-btn')!.click();

        expect(archived).to.deep.equal([latest]);
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

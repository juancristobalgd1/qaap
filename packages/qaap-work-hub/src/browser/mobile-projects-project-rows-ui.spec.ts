// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { MobileProjectsProjectRowsUi } from './mobile-projects-project-rows-ui';
import type { MobileProjectTaskView } from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { useSuiteJSDOM } from './test/qaap-jsdom-suite';

disableImportJSDOM();

describe('MobileProjectsProjectRowsUi — foot metrics patch', () => {

    useSuiteJSDOM();

    function newUi(): MobileProjectsProjectRowsUi {
        return new MobileProjectsProjectRowsUi({
            activeTasks: undefined,
            conversationIndexUi: { isConversationUnread: () => false },
        } as never);
    }

    function summary(overrides: Partial<QaapAgentConversationSummaryDTO>): QaapAgentConversationSummaryDTO {
        return {
            id: 'conv-1',
            title: 'Task',
            status: 'idle',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 3,
            agentId: 'qaiq',
            cwd: '/repo',
            ...overrides,
        } as QaapAgentConversationSummaryDTO;
    }

    const task: MobileProjectTaskView = {
        id: 'conv-1',
        title: 'Task',
        state: 'idle',
        since: 'now',
        command: 'qaiq',
        cwd: '/repo',
        createdAt: 1,
    } as MobileProjectTaskView;

    function diffText(footRow: HTMLElement): string | undefined {
        const diff = footRow.querySelector('.theia-mobile-projects-task-diff');
        return diff?.textContent ?? undefined;
    }

    it('renders the diff counts into a fresh foot row', () => {
        const ui = newUi();
        const footRow = document.createElement('div');
        footRow.className = 'theia-mobile-projects-task-foot';
        ui.populateWorkHubTaskFootRow(footRow, task, summary({ linesAdded: 3, linesRemoved: 1 }), false);
        expect(diffText(footRow)).to.equal('+3−1');
        expect(footRow.dataset.qaapFootFp).to.be.a('string');
    });

    it('refreshes stale diff counts in place when the row is patched', () => {
        const ui = newUi();
        const row = document.createElement('div');
        row.className = 'theia-mobile-projects-task-row';
        row.dataset.qaapConversationId = 'conv-1';
        const footRow = document.createElement('div');
        footRow.className = 'theia-mobile-projects-task-foot';
        ui.populateWorkHubTaskFootRow(footRow, task, summary({ linesAdded: 3, linesRemoved: 1 }), false);
        row.append(footRow);
        expect(diffText(footRow)).to.equal('+3−1');

        // A later delta grows the diff. patchWorkHubTaskRow keeps the same DOM but must repaint the foot.
        const patched = (ui as unknown as {
            patchWorkHubTaskRowContent: (
                r: HTMLElement,
                t: MobileProjectTaskView,
                s: QaapAgentConversationSummaryDTO,
                o?: unknown,
                st?: { isRunning?: boolean },
            ) => boolean;
        }).patchWorkHubTaskRowContent(
            row,
            task,
            summary({ linesAdded: 11, linesRemoved: 9 }),
            undefined,
            { isRunning: false },
        );

        expect(patched).to.equal(true);
        expect(diffText(footRow)).to.equal('+11−9');
        // Same foot element — patched in place, not rebuilt from a list re-render.
        expect(row.querySelector('.theia-mobile-projects-task-foot')).to.equal(footRow);
    });

    it('skips the foot rebuild when nothing the foot shows changed', () => {
        const ui = newUi();
        const row = document.createElement('div');
        row.dataset.qaapConversationId = 'conv-1';
        const footRow = document.createElement('div');
        footRow.className = 'theia-mobile-projects-task-foot';
        ui.populateWorkHubTaskFootRow(footRow, task, summary({ linesAdded: 3, linesRemoved: 1 }), false);
        row.append(footRow);
        const diffBefore = footRow.querySelector('.theia-mobile-projects-task-diff');

        (ui as unknown as {
            patchWorkHubTaskRowContent: (
                r: HTMLElement,
                t: MobileProjectTaskView,
                s: QaapAgentConversationSummaryDTO,
                o?: unknown,
                st?: { isRunning?: boolean },
            ) => boolean;
        }).patchWorkHubTaskRowContent(
            row,
            task,
            // Only updatedAt moved — foot fingerprint is unchanged, so the diff node must be the very
            // same element (no rebuild).
            summary({ linesAdded: 3, linesRemoved: 1, updatedAt: 99 }),
            undefined,
            { isRunning: false },
        );

        expect(footRow.querySelector('.theia-mobile-projects-task-diff')).to.equal(diffBefore);
    });

    it('does not claim a preview URL has rendered successfully', () => {
        const ui = newUi();
        const activity = ui.createConversationActivityRow(
            { previewUrl: 'http://localhost:5173' } as never,
            summary({}),
            { isRunning: false, needsInput: false, isDone: false },
        );

        expect(activity?.textContent).to.contain('Preview available');
        expect(activity?.textContent).not.to.contain('Preview ready');
    });

    it('surfaces the agent failure reason in the activity chip', () => {
        const ui = newUi();
        const activity = ui.createConversationActivityRow(
            { previewUrl: 'http://localhost:5173' } as never,
            summary({
                status: 'failed',
                lastMessageRole: 'agent',
                lastMessagePreview: 'Error: dev server exited with code 1',
            }),
            { isRunning: false, needsInput: false, isDone: false },
        );

        const failedChip = activity?.querySelector('.theia-mobile-projects-task-activity-chip.theia-mod-failed');
        expect(failedChip).to.not.equal(null);
        expect(failedChip?.textContent).to.contain('Failed: Error: dev server exited with code 1');
        expect(activity?.querySelector('.theia-mobile-projects-task-activity-chip.theia-mod-surface')).to.not.equal(null);
    });

    it('renders the last executed turn model in compact rows, not the next composer selection', () => {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            value: () => ({ matches: false }),
        });
        const ui = new MobileProjectsProjectRowsUi({
            activeTasks: undefined,
            transcriptOpenSummaryId: undefined,
            justAddedTaskId: undefined,
            conversationIndexUi: {
                isConversationUnread: () => false,
                resolveConversationLineage: () => 'none',
                resolveConversationFlags: () => ({ priority: false, paused: false }),
            },
            cardMenuUi: {
                buildConversationMenu: () => document.createElement('div'),
                toggleCardMenu: () => undefined,
            },
        } as never);
        const executedSummary = summary({
            status: 'failed',
            lastMessageRole: 'agent',
            lastMessagePreview: 'Not inside a trusted directory',
            agentModel: { provider: 'openai', vendor: 'openai', modelId: 'gpt-5.6-sol' },
            lastTurnAgentId: 'codex',
            lastTurnAgentModel: { provider: 'openai', vendor: 'openai', modelId: 'gpt-5.6-luna' },
        });
        const row = ui.createTaskItem(
            {
                id: 'project-1',
                name: 'Project',
                color: '#fff',
                branch: 'main',
                status: 'idle',
                task: '',
                progress: 0,
                agents: [],
            } as never,
            task,
            undefined,
            executedSummary,
            new Set(),
            { compact: true },
        );

        expect(row.querySelector('.theia-qaap-agent-identity-label')?.textContent).to.equal('gpt-5.6-luna');

        const patched = (ui as unknown as {
            patchWorkHubTaskRowContent: (
                r: HTMLElement,
                t: MobileProjectTaskView,
                s: QaapAgentConversationSummaryDTO,
                o?: unknown,
                st?: { isRunning?: boolean },
            ) => boolean;
        }).patchWorkHubTaskRowContent(
            row,
            task,
            {
                ...executedSummary,
                lastTurnAgentModel: { provider: 'openai', vendor: 'openai', modelId: 'gpt-5.6-astra' },
            },
            undefined,
            { isRunning: false },
        );

        expect(patched).to.equal(true);
        expect(row.querySelector('.theia-qaap-agent-identity-label')?.textContent).to.equal('gpt-5.6-astra');
    });
});

describe('MobileProjectsProjectRowsUi — task block', () => {

    useSuiteJSDOM();

    it('collapses a long conversation list behind a "More tasks" row', () => {
        const conversations = Array.from({ length: 8 }, (_, index) => ({
            id: `conv-${index}`,
            title: `Task ${index}`,
            status: 'idle',
            createdAt: index,
            updatedAt: index,
            messageCount: 1,
            agentId: 'qaiq',
            cwd: '/repo',
        }) as QaapAgentConversationSummaryDTO);
        const ui = new MobileProjectsProjectRowsUi({
            activeTasks: undefined,
            expandedConversationProjectIds: new Set<string>(),
            conversationIndexUi: {
                isConversationUnread: () => false,
                vpsTasksForProject: () => conversations,
                localChatsForProject: () => conversations,
                summaryToTaskView: (c: QaapAgentConversationSummaryDTO) => ({
                    id: c.id, title: c.title, command: '', cwd: c.cwd, state: 'done', createdAt: c.createdAt,
                }),
            },
        } as never);
        const project = { id: 'p1', name: 'repo' } as never;
        (ui as unknown as { detailComposerSurfaceForProject: () => string }).detailComposerSurfaceForProject = () => 'tasks';
        (ui as unknown as { createTaskItem: () => HTMLElement }).createTaskItem = () => document.createElement('div');

        const block = ui.createTaskBlock(project, undefined as never);

        expect(block.querySelector('.theia-mobile-projects-tasks-more-btn')?.textContent).to.contain('(2)');
    });
});

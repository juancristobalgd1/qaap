// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

enableJSDOM();

import { expect } from 'chai';
import { MobileProjectsProjectRowsUi } from './mobile-projects-project-rows-ui';
import type { MobileProjectTaskView } from './mobile-projects-active-tasks';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';

describe('MobileProjectsProjectRowsUi — foot metrics patch', () => {

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
});

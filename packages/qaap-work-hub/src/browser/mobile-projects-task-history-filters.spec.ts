// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    EMPTY_MOBILE_PROJECT_TASK_HISTORY_FILTERS,
    filterTaskHistoryEntries,
    taskMatchesHistoryFilters,
    type MobileProjectTaskHistoryEntry,
} from './mobile-projects-task-history-filters';

const NOW = new Date(2026, 8, 15, 15, 0, 0, 0).getTime();
const PROJECT_A = { id: 'a', name: 'Alpha' } as never;
const PROJECT_B = { id: 'b', name: 'Beta' } as never;

function entry(
    id: string,
    project: unknown,
    state: string,
    createdAt: number,
    extra: { startedAt?: number; finishedAt?: number } = {},
): MobileProjectTaskHistoryEntry {
    return {
        project: project as MobileProjectTaskHistoryEntry['project'],
        task: {
            id,
            title: id,
            command: id,
            cwd: `/repo/${id}`,
            state,
            createdAt,
            ...extra,
        },
    };
}

describe('mobile-projects-task-history-filters', () => {
    it('filters by project and groups completed warnings with completed tasks', () => {
        const completed = entry('completed', PROJECT_A, 'completed', NOW - 1_000);
        const warning = entry('warning', PROJECT_A, 'completed_with_warnings', NOW - 2_000);
        const otherProject = entry('other', PROJECT_B, 'completed', NOW - 3_000);

        expect(filterTaskHistoryEntries([otherProject, warning, completed], {
            ...EMPTY_MOBILE_PROJECT_TASK_HISTORY_FILTERS,
            projectId: 'a',
            state: 'completed',
        }, NOW).map(item => item.task.id)).to.deep.equal(['completed', 'warning']);
    });

    it('uses the finished timestamp for date filtering', () => {
        const finishedToday = entry('today', PROJECT_A, 'failed', NOW - 8 * 60 * 60 * 1000, {
            finishedAt: NOW - 1_000,
        });
        const finishedEarlier = entry('old', PROJECT_A, 'failed', NOW - 2 * 24 * 60 * 60 * 1000, {
            finishedAt: NOW - 2 * 24 * 60 * 60 * 1000,
        });

        expect(taskMatchesHistoryFilters(finishedToday, {
            ...EMPTY_MOBILE_PROJECT_TASK_HISTORY_FILTERS,
            date: 'today',
        }, NOW)).to.equal(true);
        expect(taskMatchesHistoryFilters(finishedEarlier, {
            ...EMPTY_MOBILE_PROJECT_TASK_HISTORY_FILTERS,
            date: 'today',
        }, NOW)).to.equal(false);
    });

    it('sorts matching entries newest first', () => {
        const older = entry('older', PROJECT_A, 'running', NOW - 10_000);
        const newer = entry('newer', PROJECT_A, 'queued', NOW - 1_000);
        expect(filterTaskHistoryEntries([older, newer], EMPTY_MOBILE_PROJECT_TASK_HISTORY_FILTERS, NOW)
            .map(item => item.task.id)).to.deep.equal(['newer', 'older']);
    });
});

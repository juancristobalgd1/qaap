// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { MobileProjectTaskView } from './mobile-projects-active-tasks';
import type { MobileProjectEntry } from './mobile-projects-types';

export type MobileProjectTaskHistoryState =
    | 'all'
    | 'queued'
    | 'running'
    | 'blocked'
    | 'failed'
    | 'interrupted'
    | 'completed';

export type MobileProjectTaskHistoryDate = 'all' | 'today' | '7d' | '30d';

export interface MobileProjectTaskHistoryFilters {
    readonly projectId: string;
    readonly state: MobileProjectTaskHistoryState;
    readonly date: MobileProjectTaskHistoryDate;
}

export interface MobileProjectTaskHistoryEntry {
    readonly project: MobileProjectEntry;
    readonly task: MobileProjectTaskView;
}

export const EMPTY_MOBILE_PROJECT_TASK_HISTORY_FILTERS: MobileProjectTaskHistoryFilters = {
    projectId: '',
    state: 'all',
    date: 'all',
};

export function taskHistoryTimestamp(task: MobileProjectTaskView): number {
    return task.finishedAt ?? task.startedAt ?? task.createdAt;
}

export function taskMatchesHistoryFilters(
    entry: MobileProjectTaskHistoryEntry,
    filters: MobileProjectTaskHistoryFilters,
    now = Date.now(),
): boolean {
    if (filters.projectId && entry.project.id !== filters.projectId) {
        return false;
    }
    if (!matchesState(entry.task.state, filters.state)) {
        return false;
    }
    return matchesDate(taskHistoryTimestamp(entry.task), filters.date, now);
}

export function filterTaskHistoryEntries(
    entries: readonly MobileProjectTaskHistoryEntry[],
    filters: MobileProjectTaskHistoryFilters,
    now = Date.now(),
): MobileProjectTaskHistoryEntry[] {
    return entries
        .filter(entry => taskMatchesHistoryFilters(entry, filters, now))
        .sort((a, b) => taskHistoryTimestamp(b.task) - taskHistoryTimestamp(a.task));
}

function matchesState(state: string, filter: MobileProjectTaskHistoryState): boolean {
    if (filter === 'all') {
        return true;
    }
    if (filter === 'completed') {
        return state === 'completed' || state === 'completed_with_warnings';
    }
    return state === filter;
}

function matchesDate(timestamp: number, filter: MobileProjectTaskHistoryDate, now: number): boolean {
    if (filter === 'all') {
        return true;
    }
    if (filter === 'today') {
        const start = new Date(now);
        start.setHours(0, 0, 0, 0);
        return timestamp >= start.getTime();
    }
    const days = filter === '7d' ? 7 : 30;
    return timestamp >= now - days * 24 * 60 * 60 * 1000;
}

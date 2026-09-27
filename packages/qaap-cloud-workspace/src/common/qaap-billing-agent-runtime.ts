// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { isQaapAgentTaskFinished, type QaapAgentTask } from './qaap-agent-task';

/**
 * Billable wall-clock: process spawn → exit. Queue time and cancelled-before-spawn
 * are free. IDE / preview idle never appear here.
 */
export function billableAgentDurationMs(task: QaapAgentTask): number {
    if (!isQaapAgentTaskFinished(task.state) || task.state === 'cancelled') {
        return 0;
    }
    const start = task.latencyMarks?.spawn_end ?? task.latencyMarks?.spawn_start;
    const end = task.finishedAt;
    if (start === undefined || end === undefined || end <= start) {
        return 0;
    }
    return end - start;
}

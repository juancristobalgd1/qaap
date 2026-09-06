// Copyright (C) 2026 Qaap contributors.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentTask } from '../common/qaap-agent-task';

export class QaapAgentQueueFullError extends Error {
    constructor() {
        super(nls.localize('qaap/agentQueue/full', 'The agent queue is full. Wait for a task to finish or cancel a queued task, then try again.'));
    }
}

/** Admission runs synchronously before storing the request, across all runner callers. */
export class QaapAgentQueuePolicy {
    protected limit(raw: string | undefined, fallback: number): number {
        const value = Number(raw?.trim());
        return Number.isSafeInteger(value) && value > 0 ? value : fallback;
    }

    assertCapacity(tasks: Iterable<QaapAgentTask>, ownerLogin: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
        const globalLimit = this.limit(env.QAAP_MAX_QUEUED_AGENTS, 100);
        const ownerLimit = this.limit(env.QAAP_MAX_QUEUED_AGENTS_PER_USER, 20);
        const owner = ownerLogin?.trim().toLowerCase() || '';
        let total = 0;
        let owned = 0;
        for (const task of tasks) {
            if (task.state !== 'queued') {
                continue;
            }
            total++;
            if ((task.ownerLogin?.trim().toLowerCase() || '') === owner) {
                owned++;
            }
            if (total >= globalLimit || owned >= ownerLimit) {
                throw new QaapAgentQueueFullError();
            }
        }
    }
}

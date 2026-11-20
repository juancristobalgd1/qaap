// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentTaskDetailDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

/**
 * The cause line of the agent log sheet. A failed Stop (`stopFailure`) comes first: the log's last line
 * says nothing about the agent still running.
 */
export function taskCause(detail: QaapAgentTaskDetailDTO): string {
    if (detail.stopFailure) {
        return detail.stopFailure;
    }
    if (detail.state === 'interrupted') {
        return nls.localize('qaap/mobileProjects/taskCauseInterrupted', 'The backend lost the running process. A browser reload does not cancel a task.');
    }
    if (detail.state === 'blocked') {
        return nls.localize('qaap/mobileProjects/taskCauseBlocked', 'The agent needs a decision or more information.');
    }
    if (detail.state === 'cancelled') {
        return nls.localize('qaap/mobileProjects/taskCauseCancelled', 'Cancelled by the user.');
    }
    const lines = detail.log.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return lines.at(-1) ?? nls.localize('qaap/mobileProjects/taskCauseUnavailable', 'No cause was reported.');
}

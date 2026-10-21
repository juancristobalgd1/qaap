// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapHealthCheckContribution, QaapHealthCheckResult } from '@theia/qaap-shared-core/lib/node/qaap-health-check-contribution';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/**
 * Reports the agent task store to `/qaap/api/health`. Unhealthy when the startup restore failed or
 * the last write failed (a later successful write clears it); `loading` still counts as healthy so
 * a backend that is starting is not reported as broken.
 */
@injectable()
export class QaapAgentStorageHealthCheck implements QaapHealthCheckContribution {

    readonly id = 'agentStorage';

    @inject(QaapAgentTaskRunner)
    protected readonly runner: QaapAgentTaskRunner;

    check(): QaapHealthCheckResult {
        const { recovery, writeFailed } = this.runner.storageHealth();
        return { healthy: recovery !== 'failed' && !writeFailed, detail: { recovery, writeFailed } };
    }
}

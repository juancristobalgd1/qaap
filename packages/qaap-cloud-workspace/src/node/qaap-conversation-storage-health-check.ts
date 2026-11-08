// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { QaapHealthCheckContribution, QaapHealthCheckResult } from '@theia/qaap-shared-core/lib/node/qaap-health-check-contribution';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';

/**
 * Reports the conversation store to `/qaap/api/health`. Unhealthy when the restore or migration
 * failed, which keeps writes off until a restart, or when the last write failed (a later successful
 * write clears it).
 */
@injectable()
export class QaapConversationStorageHealthCheck implements QaapHealthCheckContribution {

    readonly id = 'conversationStorage';

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    check(): QaapHealthCheckResult {
        const { failure, writeFailed } = this.store.storageHealth();
        return { healthy: failure === undefined && !writeFailed, detail: { restoreFailed: failure !== undefined, writeFailed } };
    }
}

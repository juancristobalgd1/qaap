// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import {
    QaapBillingQuota,
    QaapPlanRepoLimitError,
    QaapPlanStorageLimitError,
    type QaapBillingQuotaSnapshot,
} from '@theia/qaap-adapters/lib/common/qaap-billing-quota';
import { wouldExceedActiveRepoLimit } from '../common/qaap-billing-plans';
import { QaapBillingStore } from './qaap-billing-store';
import { QaapTenantStorageQuotaService } from './qaap-tenant-storage-quota-service';

@injectable()
export class QaapBillingQuotaService implements QaapBillingQuota {

    @inject(QaapBillingStore)
    protected readonly store: QaapBillingStore;

    @inject(QaapTenantStorageQuotaService)
    protected readonly storage: QaapTenantStorageQuotaService;

    async getEntitlements(login: string): Promise<QaapBillingQuotaSnapshot> {
        const entitlements = await this.store.getEntitlements(login);
        return {
            planId: entitlements.planId,
            maxConcurrentAgents: entitlements.maxConcurrentAgents,
            maxActiveRepos: entitlements.maxActiveRepos,
            storageGb: entitlements.storageGb,
            memoryOptionsGb: entitlements.memoryOptionsGb,
            defaultMemoryGb: entitlements.defaultMemoryGb,
            cpuLimit: entitlements.cpuLimit,
            idlePauseMinutes: entitlements.idlePauseMinutes,
        };
    }

    peekMaxConcurrentAgents(login: string | undefined): number {
        return this.store.maxConcurrentAgentsForOwner(login);
    }

    async assertCanAddActiveRepo(login: string, currentActiveRepos: number): Promise<void> {
        const entitlements = await this.store.getEntitlements(login);
        if (wouldExceedActiveRepoLimit(entitlements.maxActiveRepos, currentActiveRepos, false)) {
            throw new QaapPlanRepoLimitError(entitlements.planId, entitlements.maxActiveRepos);
        }
        // Cloning another repository adds to the storage the plan caps; a full workspace takes no new clone.
        if (await this.storage.isOverStorageLimit(login)) {
            throw new QaapPlanStorageLimitError(entitlements.planId, entitlements.storageGb);
        }
    }
}

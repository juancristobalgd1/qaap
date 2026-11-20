// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { getQaapBillingPlan } from '../common/qaap-billing-plans';
import { tenantPlanSizing, type QaapTenantPlanSizing } from '../common/qaap-tenant-resource-plan';
import { QaapBillingStore } from './qaap-billing-store';
import { QaapProjectResourcesStore } from './qaap-project-resources-store';

/**
 * Plan-derived container sizing per owner (memory = largest per-project choice clamped to the plan,
 * CPU = plan `cpuLimit`). The orchestrator reads it synchronously through {@link peek} after
 * {@link refresh} has run at the start of each container ensure, and the endpoint refreshes it on save.
 */
@injectable()
export class QaapTenantResourceSizing {

    @inject(QaapBillingStore) @optional()
    protected readonly billing: QaapBillingStore | undefined;

    @inject(QaapProjectResourcesStore) @optional()
    protected readonly projects: QaapProjectResourcesStore | undefined;

    protected readonly snapshots = new Map<string, QaapTenantPlanSizing>();

    /**
     * Reads the owner's plan and saved project memory and caches the sizing. An unreadable plan drops
     * the cached entry, so callers fall back to the operator defaults instead of a stale plan.
     */
    async refresh(ownerLogin: string | undefined, now: Date = new Date()): Promise<QaapTenantPlanSizing | undefined> {
        const key = ownerLogin?.trim().toLowerCase();
        if (!key || !this.billing) {
            return undefined;
        }
        try {
            const account = await this.billing.getOrCreateAccount(key, now);
            const plan = getQaapBillingPlan(account.planId);
            const saved = this.projects?.listForOwner(key).map(choice => choice.memoryGb) ?? [];
            const sizing = tenantPlanSizing(plan, saved);
            this.snapshots.set(key, sizing);
            return sizing;
        } catch (error) {
            this.snapshots.delete(key);
            console.warn(`[qaap-docker] Could not read the plan of ${key}; using the operator resource defaults: `
                + (error instanceof Error ? error.message : String(error)));
            return undefined;
        }
    }

    /** The last sizing {@link refresh} computed for `ownerLogin`, if any. Never does I/O. */
    peek(ownerLogin: string | undefined): QaapTenantPlanSizing | undefined {
        const key = ownerLogin?.trim().toLowerCase();
        return key ? this.snapshots.get(key) : undefined;
    }
}

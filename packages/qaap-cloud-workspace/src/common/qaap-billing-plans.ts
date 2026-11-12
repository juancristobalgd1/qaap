// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Product billing catalog (bring-your-own AI).
 *
 * Qaap never pays for model usage: users sign in to their own agent subscriptions or paste their own
 * API keys. A plan therefore meters only the workspace itself: how many repositories can be active,
 * how much storage they may use, how many agents run at once, the memory and CPU a project container
 * gets, and how long an idle workspace keeps running before it pauses. Prices are USD per month; paid
 * plans are checked out through the hosted subscription flow.
 */

export type QaapBillingPlanId = 'starter' | 'pro';

export interface QaapBillingPlan {
    readonly id: QaapBillingPlanId;
    readonly priceUsdMonthly: number;
    /** Container memory choices per project, in GB. */
    readonly memoryOptionsGb: readonly number[];
    readonly defaultMemoryGb: number;
    /** CPU cores per tenant container. */
    readonly cpuLimit: number;
    readonly storageGb: number;
    /** `-1` means unlimited. */
    readonly maxActiveRepos: number;
    readonly maxConcurrentAgents: number;
    /** Minutes without activity before an idle workspace pauses. */
    readonly idlePauseMinutes: number;
}

export interface QaapBillingAccount {
    readonly login: string;
    readonly planId: QaapBillingPlanId;
    readonly updatedAt: string;
    readonly stripeCustomerId?: string;
    readonly stripeSubscriptionId?: string;
    /** Last subscription status applied (`active`, `past_due`, …). */
    readonly stripeSubscriptionStatus?: string;
    /** Unix seconds of the newest subscription event applied; older, out-of-order deliveries are ignored. */
    readonly stripeEventCreated?: number;
}

/** Snapshot of what an account's plan allows; built by {@link entitlementsFor}. */
export interface QaapBillingEntitlements {
    readonly planId: QaapBillingPlanId;
    readonly priceUsdMonthly: number;
    readonly memoryOptionsGb: readonly number[];
    readonly defaultMemoryGb: number;
    readonly cpuLimit: number;
    readonly storageGb: number;
    readonly maxActiveRepos: number;
    readonly maxConcurrentAgents: number;
    readonly idlePauseMinutes: number;
}

export const QAAP_BILLING_PLANS: readonly QaapBillingPlan[] = [
    {
        id: 'starter',
        priceUsdMonthly: 4.99,
        memoryOptionsGb: [2],
        defaultMemoryGb: 2,
        cpuLimit: 2,
        storageGb: 10,
        maxActiveRepos: 3,
        maxConcurrentAgents: 2,
        idlePauseMinutes: 30,
    },
    {
        id: 'pro',
        priceUsdMonthly: 12,
        memoryOptionsGb: [2, 4],
        defaultMemoryGb: 2,
        cpuLimit: 4,
        storageGb: 30,
        maxActiveRepos: 10,
        maxConcurrentAgents: 4,
        idlePauseMinutes: 360,
    },
];

export function isQaapBillingPlanId(value: string): value is QaapBillingPlanId {
    return value === 'starter' || value === 'pro';
}

export function getQaapBillingPlan(planId: QaapBillingPlanId): QaapBillingPlan {
    const plan = QAAP_BILLING_PLANS.find(entry => entry.id === planId);
    if (!plan) {
        throw new Error(`Unknown billing plan: ${planId}`);
    }
    return plan;
}

/**
 * Parses a plan id from env or persisted data. The retired `team` plan maps to `pro`, so records
 * written before it was removed keep a paid plan instead of falling back to Starter.
 */
export function parseQaapBillingPlanId(value: string | undefined, fallback: QaapBillingPlanId = 'starter'): QaapBillingPlanId {
    const normalized = value?.trim().toLowerCase();
    if (normalized === 'team') {
        return 'pro';
    }
    return normalized && isQaapBillingPlanId(normalized) ? normalized : fallback;
}

export function entitlementsFor(account: QaapBillingAccount): QaapBillingEntitlements {
    const plan = getQaapBillingPlan(account.planId);
    return {
        planId: plan.id,
        priceUsdMonthly: plan.priceUsdMonthly,
        memoryOptionsGb: [...plan.memoryOptionsGb],
        defaultMemoryGb: plan.defaultMemoryGb,
        cpuLimit: plan.cpuLimit,
        storageGb: plan.storageGb,
        maxActiveRepos: plan.maxActiveRepos,
        maxConcurrentAgents: plan.maxConcurrentAgents,
        idlePauseMinutes: plan.idlePauseMinutes,
    };
}

export function wouldExceedActiveRepoLimit(
    maxActiveRepos: number,
    currentCount: number,
    alreadyActive: boolean,
): boolean {
    if (alreadyActive || maxActiveRepos < 0) {
        return false;
    }
    return currentCount >= maxActiveRepos;
}

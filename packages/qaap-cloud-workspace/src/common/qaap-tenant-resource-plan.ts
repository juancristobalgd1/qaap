// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapBillingPlan } from './qaap-billing-plans';

const GIB = 1024 ** 3;

/**
 * Snaps a requested per-project memory onto the plan's options: the largest option not above the
 * request, or the smallest option when the request is below all of them.
 */
export function clampProjectMemoryGb(options: readonly number[], requested: number): number {
    const sorted = [...options].sort((left, right) => left - right);
    if (sorted.length === 0) {
        return requested;
    }
    const fitting = sorted.filter(option => option <= requested);
    return fitting.length > 0 ? fitting[fitting.length - 1] : sorted[0];
}

/** Whether `memoryGb` is one of the plan's per-project memory options. */
export function isProjectMemoryAllowed(plan: Pick<QaapBillingPlan, 'memoryOptionsGb'>, memoryGb: number): boolean {
    return plan.memoryOptionsGb.includes(memoryGb);
}

/**
 * Container memory (GB) of an owner's tenant: the largest per-project choice among their projects,
 * clamped to the plan. With no saved choice the plan default applies.
 */
export function effectiveTenantMemoryGb(
    plan: Pick<QaapBillingPlan, 'memoryOptionsGb' | 'defaultMemoryGb'>,
    savedMemoryGb: readonly number[],
): number {
    const requested = savedMemoryGb.length > 0 ? Math.max(...savedMemoryGb) : plan.defaultMemoryGb;
    return clampProjectMemoryGb(plan.memoryOptionsGb, requested);
}

/** Plan-derived container sizing for one owner, in the units Docker takes. */
export interface QaapTenantPlanSizing {
    readonly planId: string;
    readonly memoryGb: number;
    /** Container memory in bytes (`Memory`; `MemorySwap` is set to the same value). */
    readonly memoryBytes: number;
    /** Container CPU in Docker NanoCpus. */
    readonly nanoCpus: number;
}

export function tenantPlanSizing(
    plan: Pick<QaapBillingPlan, 'id' | 'memoryOptionsGb' | 'defaultMemoryGb' | 'cpuLimit'>,
    savedMemoryGb: readonly number[],
): QaapTenantPlanSizing {
    const memoryGb = effectiveTenantMemoryGb(plan, savedMemoryGb);
    return {
        planId: plan.id,
        memoryGb,
        memoryBytes: memoryGb * GIB,
        nanoCpus: Math.floor(plan.cpuLimit * 1e9),
    };
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Optional quota seam consumed by GitHub clone/open (mobile-shell) without importing
 * `@theia/qaap-cloud-workspace` (that package already depends on mobile-shell).
 */
export const QaapBillingQuota = Symbol.for('QaapBillingQuota');

export interface QaapBillingQuotaSnapshot {
    readonly planId: string;
    readonly maxConcurrentAgents: number;
    readonly maxActiveRepos: number;
    readonly storageGb: number;
    readonly memoryOptionsGb: readonly number[];
    readonly defaultMemoryGb: number;
    readonly cpuLimit: number;
    readonly idlePauseMinutes: number;
}

export class QaapPlanRepoLimitError extends Error {
    readonly code = 'plan_repo_limit' as const;

    constructor(
        readonly planId: string,
        readonly limit: number,
        message?: string,
    ) {
        const planName = planId.charAt(0).toUpperCase() + planId.slice(1);
        super(message ?? (
            `Your ${planName} plan allows ${limit} active repositories. `
            + 'Remove a clone or upgrade to open another.'
        ));
        this.name = 'QaapPlanRepoLimitError';
    }
}

export interface QaapBillingQuota {
    getEntitlements(login: string): Promise<QaapBillingQuotaSnapshot>;
    peekMaxConcurrentAgents(login: string | undefined): number;
    assertCanAddActiveRepo(login: string, currentActiveRepos: number): Promise<void>;
}

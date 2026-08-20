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
    readonly hostedModels: boolean;
    readonly creditsRemaining: number;
    readonly canStartAgent: boolean;
    readonly maxConcurrentAgents: number;
    readonly maxActiveRepos: number;
    readonly runtimeFairUse: boolean;
}

export class QaapPlanRepoLimitError extends Error {
    readonly code = 'plan_repo_limit' as const;

    constructor(
        readonly planId: string,
        readonly limit: number,
        message?: string,
    ) {
        super(message ?? (
            `Your ${planId} plan allows ${limit} active repositories. `
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

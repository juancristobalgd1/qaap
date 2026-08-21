// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    confirmQaapBillingCheckout,
    fetchQaapBilling,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';

export interface QaapBillingReturnResult {
    readonly kind: 'success' | 'cancel' | 'none';
    /** True when the return path should open Billing focused on the active plan. */
    readonly openBilling: boolean;
}

function clearBillingReturnQuery(): void {
    try {
        const url = new URL(window.location.href);
        if (!url.searchParams.has('qaapBilling')) {
            return;
        }
        url.searchParams.delete('qaapBilling');
        url.searchParams.delete('plan');
        url.searchParams.delete('session_id');
        const next = `${url.pathname}${url.search}${url.hash}`;
        window.history.replaceState({}, '', next);
    } catch {
        /* ignore */
    }
}

async function waitForPlan(
    expectedPlanId: string | undefined,
    attempts: number = 8,
    delayMs: number = 400,
): Promise<string | undefined> {
    for (let i = 0; i < attempts; i++) {
        const data = await fetchQaapBilling();
        const planId = data?.entitlements.planId;
        if (!expectedPlanId || planId === expectedPlanId) {
            return planId;
        }
        await new Promise(resolve => window.setTimeout(resolve, delayMs));
    }
    const fallback = await fetchQaapBilling();
    return fallback?.entitlements.planId;
}

/**
 * Handle `?qaapBilling=success|cancel` after Stripe Checkout.
 * Confirms the session (so the plan updates without waiting on the webhook), clears the
 * query string, and signals the shell to open the Billing sheet on the current plan.
 */
export async function handleQaapBillingReturn(): Promise<QaapBillingReturnResult> {
    let flag: string | null = null;
    let sessionId: string | undefined;
    let expectedPlan: string | undefined;
    try {
        const url = new URL(window.location.href);
        flag = url.searchParams.get('qaapBilling');
        sessionId = url.searchParams.get('session_id')?.trim() || undefined;
        expectedPlan = url.searchParams.get('plan')?.trim() || undefined;
    } catch {
        return { kind: 'none', openBilling: false };
    }
    if (!flag) {
        return { kind: 'none', openBilling: false };
    }
    clearBillingReturnQuery();
    if (flag === 'cancel') {
        return { kind: 'cancel', openBilling: false };
    }
    if (flag !== 'success') {
        return { kind: 'none', openBilling: false };
    }
    if (sessionId) {
        try {
            const confirmed = await confirmQaapBillingCheckout(sessionId);
            if (confirmed?.entitlements.planId) {
                const { rememberQaapAccountBillingPlanId } = await import('./qaap-workbench-account-menu');
                rememberQaapAccountBillingPlanId(confirmed.entitlements.planId);
            }
        } catch (error) {
            console.warn('[qaap-billing] confirm-checkout failed; polling entitlements', error);
            const planId = await waitForPlan(expectedPlan);
            if (planId) {
                const { rememberQaapAccountBillingPlanId } = await import('./qaap-workbench-account-menu');
                rememberQaapAccountBillingPlanId(planId);
            }
        }
    } else {
        const planId = await waitForPlan(expectedPlan);
        if (planId) {
            const { rememberQaapAccountBillingPlanId } = await import('./qaap-workbench-account-menu');
            rememberQaapAccountBillingPlanId(planId);
        }
    }
    return { kind: 'success', openBilling: true };
}

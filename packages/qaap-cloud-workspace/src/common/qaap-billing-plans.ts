// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Product billing catalog.
 *
 * Dual meters:
 * 1. **Runtime** — wall-clock of an *agent process* (spawn → exit). IDE idle and preview
 *    idle are not billed. Starter is fair-use (no clock, no hard stop).
 * 2. **Model credits** — Codex frontier hosted only (`gpt-5.6-sol|terra|luna` + legado).
 *    1 credit = €0.01 (~30% margin over OpenAI short-context API, August 2026).
 *
 * Pro includes ~5× a typical daily agent's hours so users do not feel the clock.
 * At 80% usage we warn; at 0 we block *new* jobs but never kill an in-flight turn.
 * Paid plans (Pro / Team) upgrade via Stripe Checkout (`POST /qaap/api/billing/checkout`).
 */

export type QaapBillingPlanId = 'starter' | 'pro' | 'team';

export interface QaapBillingPlan {
    readonly id: QaapBillingPlanId;
    readonly monthlyPriceEur: number;
    readonly storageGb: number;
    /** `-1` means unlimited. */
    readonly maxActiveRepos: number;
    readonly maxConcurrentAgents: number;
    /**
     * Included agent wall-clock hours / month. Ignored when {@link runtimeFairUse} is true.
     * `-1` means unlimited (same as fair-use).
     */
    readonly includedRuntimeHoursPerMonth: number;
    /** Starter: no visible clock and no hard stop on new agent jobs. */
    readonly runtimeFairUse: boolean;
    readonly hostedModels: boolean;
    readonly includedCreditsPerMonth: number;
}

/** Selectable Core runtime packs — same shape as Ona's $20→80 OCU dropdown. */
export interface QaapRuntimePack {
    readonly monthlyPriceEur: number;
    readonly qcu: number;
    /** Bonus QCU (Ona $500 tier style). */
    readonly bonusQcu?: number;
}

export interface QaapHostedModelRate {
    readonly modelId: string;
    readonly label: string;
    readonly role: 'frontier' | 'balanced' | 'fast' | 'legacy';
    /** Wholesale API USD per 1M input tokens (short context). */
    readonly apiUsdPerMillionInput: number;
    readonly apiUsdPerMillionOutput: number;
    readonly creditsPerMillionInput: number;
    readonly creditsPerMillionOutput: number;
}

export interface QaapBillingAccount {
    readonly login: string;
    readonly planId: QaapBillingPlanId;
    /** Remaining included runtime this period, in whole minutes. */
    readonly includedRuntimeMinutesRemaining: number;
    /** Purchased top-up runtime that does not expire with the month, in minutes. */
    readonly purchasedRuntimeMinutes: number;
    readonly includedCreditsRemaining: number;
    readonly purchasedCredits: number;
    /** ISO timestamp of the current monthly included window. */
    readonly periodStart: string;
    readonly updatedAt: string;
    readonly stripeCustomerId?: string;
    readonly stripeSubscriptionId?: string;
}

export interface QaapBillingEntitlements {
    readonly planId: QaapBillingPlanId;
    readonly storageGb: number;
    readonly maxActiveRepos: number;
    readonly maxConcurrentAgents: number;
    readonly hostedModels: boolean;
    readonly runtimeFairUse: boolean;
    readonly includedRuntimeHoursPerMonth: number;
    /** `-1` when fair-use / unlimited. */
    readonly runtimeHoursRemaining: number;
    /** 0–1 of the included runtime quota used this period. Fair-use → 0. */
    readonly runtimeUsageRatio: number;
    readonly runtimeWarning: boolean;
    readonly canStartAgent: boolean;
    readonly includedCreditsPerMonth: number;
    readonly creditsRemaining: number;
}

/** Warn (do not stop) when this fraction of included runtime is gone. */
export const QAAP_RUNTIME_WARNING_RATIO = 0.8;

/** Top-up packs: €0.25 / agent-hour (Ona-like). Included Pro hours are cheaper blended. */
export const QAAP_RUNTIME_EUR_PER_HOUR = 0.25;

/**
 * Runtime top-up packs. 1 QCU = 1 hour of *agent* wall-clock (not idle IDE).
 */
export const QAAP_RUNTIME_PACKS: readonly QaapRuntimePack[] = [
    { monthlyPriceEur: 20, qcu: 80 },
    { monthlyPriceEur: 50, qcu: 200 },
    { monthlyPriceEur: 100, qcu: 400 },
];

export const QAAP_BILLING_PLANS: readonly QaapBillingPlan[] = [
    {
        id: 'starter',
        monthlyPriceEur: 12,
        storageGb: 5,
        maxActiveRepos: 3,
        maxConcurrentAgents: 2,
        includedRuntimeHoursPerMonth: -1,
        runtimeFairUse: true,
        hostedModels: false,
        includedCreditsPerMonth: 0,
    },
    {
        id: 'pro',
        monthlyPriceEur: 29,
        storageGb: 25,
        maxActiveRepos: 10,
        maxConcurrentAgents: 4,
        includedRuntimeHoursPerMonth: 160,
        runtimeFairUse: false,
        hostedModels: true,
        includedCreditsPerMonth: 2500,
    },
    {
        id: 'team',
        monthlyPriceEur: 79,
        storageGb: 100,
        maxActiveRepos: -1,
        maxConcurrentAgents: 8,
        includedRuntimeHoursPerMonth: 500,
        runtimeFairUse: false,
        hostedModels: true,
        includedCreditsPerMonth: 10000,
    },
];

/**
 * Keep model IDs in sync with `listStaticNativeAgentModels('codex')`.
 * gpt-5.5 uses Sol rates until OpenAI publishes a distinct legado price we want to honor.
 */
export const QAAP_CODEX_HOSTED_RATES: readonly QaapHostedModelRate[] = [
    {
        modelId: 'gpt-5.6-sol',
        label: 'GPT-5.6 Sol',
        role: 'frontier',
        apiUsdPerMillionInput: 5,
        apiUsdPerMillionOutput: 30,
        creditsPerMillionInput: 650,
        creditsPerMillionOutput: 3900,
    },
    {
        modelId: 'gpt-5.6-terra',
        label: 'GPT-5.6 Terra',
        role: 'balanced',
        apiUsdPerMillionInput: 2,
        apiUsdPerMillionOutput: 12,
        creditsPerMillionInput: 260,
        creditsPerMillionOutput: 1560,
    },
    {
        modelId: 'gpt-5.6-luna',
        label: 'GPT-5.6 Luna',
        role: 'fast',
        apiUsdPerMillionInput: 0.2,
        apiUsdPerMillionOutput: 1.2,
        creditsPerMillionInput: 26,
        creditsPerMillionOutput: 156,
    },
    {
        modelId: 'gpt-5.5',
        label: 'GPT-5.5 Legado',
        role: 'legacy',
        apiUsdPerMillionInput: 5,
        apiUsdPerMillionOutput: 30,
        creditsPerMillionInput: 650,
        creditsPerMillionOutput: 3900,
    },
];

export const QAAP_CODEX_HOSTED_MODEL_IDS: ReadonlySet<string> = new Set(
    QAAP_CODEX_HOSTED_RATES.map(rate => rate.modelId),
);

export function isQaapBillingPlanId(value: string): value is QaapBillingPlanId {
    return value === 'starter' || value === 'pro' || value === 'team';
}

export function getQaapBillingPlan(planId: QaapBillingPlanId): QaapBillingPlan {
    const plan = QAAP_BILLING_PLANS.find(entry => entry.id === planId);
    if (!plan) {
        throw new Error(`Unknown billing plan: ${planId}`);
    }
    return plan;
}

export function parseQaapBillingPlanId(value: string | undefined, fallback: QaapBillingPlanId = 'starter'): QaapBillingPlanId {
    const normalized = value?.trim().toLowerCase();
    return normalized && isQaapBillingPlanId(normalized) ? normalized : fallback;
}

export function getQaapHostedModelRate(modelId: string): QaapHostedModelRate | undefined {
    const id = modelId.trim().toLowerCase();
    return QAAP_CODEX_HOSTED_RATES.find(rate => rate.modelId === id);
}

export function isQaapCodexHostedModel(modelId: string): boolean {
    return QAAP_CODEX_HOSTED_MODEL_IDS.has(modelId.trim().toLowerCase());
}

export function hoursToMinutes(hours: number): number {
    if (hours < 0) {
        return 0;
    }
    return Math.max(0, Math.round(hours * 60));
}

export function minutesToHours(minutes: number): number {
    return Math.max(0, minutes) / 60;
}

export function runtimeMinutesRemaining(account: QaapBillingAccount): number {
    return Math.max(0, account.includedRuntimeMinutesRemaining) + Math.max(0, account.purchasedRuntimeMinutes);
}

export function runtimeHoursRemaining(account: QaapBillingAccount): number {
    return minutesToHours(runtimeMinutesRemaining(account));
}

export function creditsRemaining(account: QaapBillingAccount): number {
    return Math.max(0, account.includedCreditsRemaining) + Math.max(0, account.purchasedCredits);
}

export function entitlementsFor(account: QaapBillingAccount): QaapBillingEntitlements {
    const plan = getQaapBillingPlan(account.planId);
    const ratio = runtimeUsageRatio(account);
    return {
        planId: plan.id,
        storageGb: plan.storageGb,
        maxActiveRepos: plan.maxActiveRepos,
        maxConcurrentAgents: plan.maxConcurrentAgents,
        hostedModels: plan.hostedModels,
        runtimeFairUse: plan.runtimeFairUse,
        includedRuntimeHoursPerMonth: plan.includedRuntimeHoursPerMonth,
        runtimeHoursRemaining: plan.runtimeFairUse || plan.includedRuntimeHoursPerMonth < 0
            ? -1
            : runtimeHoursRemaining(account),
        runtimeUsageRatio: ratio,
        runtimeWarning: shouldWarnRuntime(account),
        canStartAgent: canStartNewAgentJob(account),
        includedCreditsPerMonth: plan.includedCreditsPerMonth,
        creditsRemaining: creditsRemaining(account),
    };
}

export function isRuntimeFairUse(planId: QaapBillingPlanId): boolean {
    return getQaapBillingPlan(planId).runtimeFairUse;
}

/** Fraction of *included* runtime consumed this period. Fair-use → 0. */
export function runtimeUsageRatio(account: QaapBillingAccount): number {
    const plan = getQaapBillingPlan(account.planId);
    if (plan.runtimeFairUse || plan.includedRuntimeHoursPerMonth <= 0) {
        return 0;
    }
    const includedMinutes = hoursToMinutes(plan.includedRuntimeHoursPerMonth);
    if (includedMinutes <= 0) {
        return 0;
    }
    const remainingIncluded = Math.max(0, account.includedRuntimeMinutesRemaining);
    const used = Math.max(0, includedMinutes - remainingIncluded);
    return Math.min(1, used / includedMinutes);
}

export function shouldWarnRuntime(account: QaapBillingAccount): boolean {
    return runtimeUsageRatio(account) >= QAAP_RUNTIME_WARNING_RATIO;
}

export function canStartNewAgentJob(account: QaapBillingAccount): boolean {
    if (isRuntimeFairUse(account.planId)) {
        return true;
    }
    return runtimeMinutesRemaining(account) > 0;
}

/** Whether the account may run a Codex hosted frontier model under the current plan. */
export function canUseCodexHostedModel(account: QaapBillingAccount, modelId: string | undefined): boolean {
    if (!modelId || !isQaapCodexHostedModel(modelId)) {
        return true;
    }
    const entitlements = entitlementsFor(account);
    if (!entitlements.hostedModels) {
        return false;
    }
    return entitlements.creditsRemaining > 0;
}

export function hostedModelDenialReason(account: QaapBillingAccount, modelId: string | undefined): string | undefined {
    if (!modelId || !isQaapCodexHostedModel(modelId)) {
        return undefined;
    }
    const entitlements = entitlementsFor(account);
    if (!entitlements.hostedModels) {
        return 'Hosted Codex models require Pro or Team. Starter is BYOK-only — pick a BYOK model or upgrade.';
    }
    if (entitlements.creditsRemaining <= 0) {
        return 'Codex hosted credits are exhausted for this billing period. Top up credits or wait for the next cycle.';
    }
    return undefined;
}

/** Codex frontier models billed as hosted credits — only when the agent is Codex. */
export function isHostedCodexUsage(agentId: string | undefined, modelId: string | undefined): boolean {
    if ((agentId ?? '').trim().toLowerCase() !== 'codex') {
        return false;
    }
    return !!modelId && isQaapCodexHostedModel(modelId);
}

export function filterModelsForHostedPlan<T extends { readonly modelId: string }>(
    agentId: string | undefined,
    models: readonly T[],
    hostedModelsAllowed: boolean,
): T[] {
    if (hostedModelsAllowed) {
        return [...models];
    }
    return models.filter(model => !isHostedCodexUsage(agentId, model.modelId));
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

/**
 * Charge up to `credits` without failing an in-flight turn (same spirit as runtime).
 */
export function spendCreditsUpTo(
    account: QaapBillingAccount,
    credits: number,
): { readonly account: QaapBillingAccount; readonly charged: number } {
    if (credits <= 0) {
        return { account, charged: 0 };
    }
    const available = creditsRemaining(account);
    const charge = Math.min(credits, available);
    if (charge <= 0) {
        return { account, charged: 0 };
    }
    const next = spendCredits(account, charge);
    return { account: next ?? account, charged: charge };
}

/**
 * Round up so we never under-charge. Zero tokens → 0 credits.
 */
export function creditsForTokenUsage(modelId: string, inputTokens: number, outputTokens: number): number | undefined {
    const rate = getQaapHostedModelRate(modelId);
    if (!rate) {
        return undefined;
    }
    const inTok = Math.max(0, inputTokens);
    const outTok = Math.max(0, outputTokens);
    if (inTok === 0 && outTok === 0) {
        return 0;
    }
    const raw = (inTok / 1_000_000) * rate.creditsPerMillionInput
        + (outTok / 1_000_000) * rate.creditsPerMillionOutput;
    return Math.max(1, Math.ceil(raw));
}

/**
 * Billable wall-clock minutes for an environment / agent run.
 * Sub-minute work still consumes 1 minute (same “never free” rule as model credits).
 */
export function runtimeMinutesForDurationMs(durationMs: number): number {
    if (durationMs <= 0) {
        return 0;
    }
    return Math.max(1, Math.ceil(durationMs / 60_000));
}

export function totalQcuForPack(pack: QaapRuntimePack): number {
    return pack.qcu + (pack.bonusQcu ?? 0);
}

export function startOfUtcMonth(now: Date = new Date()): string {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function isSameUtcMonth(iso: string, now: Date = new Date()): boolean {
    const then = new Date(iso);
    if (Number.isNaN(then.getTime())) {
        return false;
    }
    return then.getUTCFullYear() === now.getUTCFullYear() && then.getUTCMonth() === now.getUTCMonth();
}

export function applyMonthlyReset(account: QaapBillingAccount, now: Date = new Date()): QaapBillingAccount {
    if (isSameUtcMonth(account.periodStart, now)) {
        return account;
    }
    const plan = getQaapBillingPlan(account.planId);
    return {
        ...account,
        includedRuntimeMinutesRemaining: plan.runtimeFairUse ? 0 : hoursToMinutes(plan.includedRuntimeHoursPerMonth),
        includedCreditsRemaining: plan.includedCreditsPerMonth,
        periodStart: startOfUtcMonth(now),
        updatedAt: now.toISOString(),
    };
}

export function spendCredits(account: QaapBillingAccount, credits: number): QaapBillingAccount | undefined {
    if (credits <= 0) {
        return account;
    }
    const included = Math.max(0, account.includedCreditsRemaining);
    const purchased = Math.max(0, account.purchasedCredits);
    if (included + purchased < credits) {
        return undefined;
    }
    const fromIncluded = Math.min(included, credits);
    const fromPurchased = credits - fromIncluded;
    return {
        ...account,
        includedCreditsRemaining: included - fromIncluded,
        purchasedCredits: purchased - fromPurchased,
        updatedAt: new Date().toISOString(),
    };
}

/**
 * Spend up to `minutes` of remaining runtime. Never fails an in-flight job:
 * charges min(requested, remaining) so a turn that started can finish.
 */
export function spendRuntimeMinutes(account: QaapBillingAccount, minutes: number): QaapBillingAccount {
    if (minutes <= 0 || isRuntimeFairUse(account.planId)) {
        return account;
    }
    const included = Math.max(0, account.includedRuntimeMinutesRemaining);
    const purchased = Math.max(0, account.purchasedRuntimeMinutes);
    const available = included + purchased;
    if (available <= 0) {
        return account;
    }
    const charge = Math.min(minutes, available);
    const fromIncluded = Math.min(included, charge);
    const fromPurchased = charge - fromIncluded;
    return {
        ...account,
        includedRuntimeMinutesRemaining: included - fromIncluded,
        purchasedRuntimeMinutes: purchased - fromPurchased,
        updatedAt: new Date().toISOString(),
    };
}

export function chargedRuntimeMinutes(before: QaapBillingAccount, after: QaapBillingAccount): number {
    return runtimeMinutesRemaining(before) - runtimeMinutesRemaining(after);
}

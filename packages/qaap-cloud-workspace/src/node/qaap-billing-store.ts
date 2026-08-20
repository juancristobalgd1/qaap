// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { writeJsonAtomic } from './qaap-write-json-atomic';
import {
    applyMonthlyReset,
    canStartNewAgentJob,
    chargedRuntimeMinutes,
    creditsForTokenUsage,
    entitlementsFor,
    getQaapBillingPlan,
    hoursToMinutes,
    isRuntimeFairUse,
    parseQaapBillingPlanId,
    runtimeMinutesForDurationMs,
    spendCreditsUpTo,
    spendRuntimeMinutes,
    startOfUtcMonth,
    type QaapBillingAccount,
    type QaapBillingEntitlements,
    type QaapBillingPlanId,
} from '../common/qaap-billing-plans';

export type QaapBillingDebitResult =
    | { readonly ok: true; readonly account: QaapBillingAccount; readonly creditsCharged: number }
    | {
        readonly ok: false;
        readonly reason: 'not_hosted' | 'unknown_model' | 'insufficient_credits';
        readonly account: QaapBillingAccount;
        readonly creditsCharged?: number;
    };

export type QaapRuntimeDebitResult = {
    readonly ok: true;
    readonly account: QaapBillingAccount;
    readonly minutesCharged: number;
    readonly fairUse: boolean;
};

@injectable()
export class QaapBillingStore {

    protected filePath = process.env.QAAP_BILLING_STORE_PATH?.trim()
        || path.join(os.homedir(), '.qaap', 'billing-accounts.json');
    protected writeChain: Promise<void> = Promise.resolve();
    /** Warm sync peek for concurrency / catalog gates (keyed by normalized login). */
    protected entitlementsCache = new Map<string, QaapBillingEntitlements>();

    static normalizeLogin(login: string): string {
        return login.trim().toLowerCase();
    }

    async getEntitlements(login: string, now: Date = new Date()): Promise<QaapBillingEntitlements> {
        const account = await this.getOrCreateAccount(login, now);
        return entitlementsFor(account);
    }

    peekEntitlements(login: string | undefined): QaapBillingEntitlements | undefined {
        const key = login?.trim();
        if (!key) {
            return undefined;
        }
        return this.entitlementsCache.get(QaapBillingStore.normalizeLogin(key));
    }

    /**
     * Per-user concurrent agent cap: `min(ops ceiling, plan)`.
     * Ops can only lower the cap via `QAAP_MAX_CONCURRENT_AGENTS_PER_USER`.
     * Cold peek falls back to Starter (2) until the account is warmed.
     */
    maxConcurrentAgentsForOwner(login: string | undefined): number {
        return Math.min(this.envConcurrentAgentsCeiling(), this.planConcurrentAgentsForOwner(login));
    }

    protected envConcurrentAgentsCeiling(): number {
        const raw = process.env.QAAP_MAX_CONCURRENT_AGENTS_PER_USER?.trim();
        if (raw) {
            const parsed = Number.parseInt(raw, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
                return parsed;
            }
        }
        return getQaapBillingPlan('team').maxConcurrentAgents;
    }

    protected planConcurrentAgentsForOwner(login: string | undefined): number {
        return this.peekEntitlements(login)?.maxConcurrentAgents
            ?? getQaapBillingPlan('starter').maxConcurrentAgents;
    }

    protected rememberEntitlements(login: string, account: QaapBillingAccount): QaapBillingEntitlements {
        const entitlements = entitlementsFor(account);
        if (!this.entitlementsCache) {
            this.entitlementsCache = new Map();
        }
        this.entitlementsCache.set(QaapBillingStore.normalizeLogin(login), entitlements);
        return entitlements;
    }

    async getOrCreateAccount(login: string, now: Date = new Date()): Promise<QaapBillingAccount> {
        const key = QaapBillingStore.normalizeLogin(login);
        return this.withLock(async () => {
            const all = await this.readAll();
            const existing = all[key];
            const normalized = existing ? this.normalizeAccount(existing) : undefined;
            const next = normalized
                ? applyMonthlyReset(normalized, now)
                : this.createDefaultAccount(key, now);
            if (!existing || next !== normalized) {
                all[key] = next;
                await this.writeAll(all);
            }
            this.rememberEntitlements(key, next);
            return next;
        });
    }

    async debitHostedUsage(
        login: string,
        modelId: string,
        inputTokens: number,
        outputTokens: number,
        now: Date = new Date(),
    ): Promise<QaapBillingDebitResult> {
        const key = QaapBillingStore.normalizeLogin(login);
        return this.withLock(async () => {
            const all = await this.readAll();
            const current = applyMonthlyReset(
                this.normalizeAccount(all[key] ?? this.createDefaultAccount(key, now)),
                now,
            );
            const plan = getQaapBillingPlan(current.planId);
            if (!plan.hostedModels) {
                this.rememberEntitlements(key, current);
                return { ok: false, reason: 'not_hosted' as const, account: current };
            }
            const creditsCharged = creditsForTokenUsage(modelId, inputTokens, outputTokens);
            if (creditsCharged === undefined) {
                this.rememberEntitlements(key, current);
                return { ok: false, reason: 'unknown_model' as const, account: current };
            }
            if (creditsCharged === 0) {
                all[key] = current;
                await this.writeAll(all);
                this.rememberEntitlements(key, current);
                return { ok: true, account: current, creditsCharged: 0 };
            }
            const spent = spendCreditsUpTo(current, creditsCharged);
            all[key] = spent.account;
            await this.writeAll(all);
            this.rememberEntitlements(key, spent.account);
            if (spent.charged < creditsCharged) {
                return {
                    ok: false,
                    reason: 'insufficient_credits' as const,
                    account: spent.account,
                    creditsCharged: spent.charged,
                };
            }
            return { ok: true, account: spent.account, creditsCharged: spent.charged };
        });
    }

    async canStartAgent(login: string, now: Date = new Date()): Promise<boolean> {
        const account = await this.getOrCreateAccount(login, now);
        return canStartNewAgentJob(account);
    }

    /**
     * Charge agent wall-clock after the process exits. Fair-use (Starter) is a no-op.
     * Never fails: an in-flight turn is billed up to remaining minutes, then remaining = 0.
     */
    async debitRuntime(
        login: string,
        durationMs: number,
        now: Date = new Date(),
    ): Promise<QaapRuntimeDebitResult> {
        const key = QaapBillingStore.normalizeLogin(login);
        return this.withLock(async () => {
            const all = await this.readAll();
            const current = applyMonthlyReset(
                this.normalizeAccount(all[key] ?? this.createDefaultAccount(key, now)),
                now,
            );
            if (isRuntimeFairUse(current.planId)) {
                all[key] = current;
                await this.writeAll(all);
                this.rememberEntitlements(key, current);
                return { ok: true as const, account: current, minutesCharged: 0, fairUse: true };
            }
            const minutesRequested = runtimeMinutesForDurationMs(durationMs);
            if (minutesRequested === 0) {
                all[key] = current;
                await this.writeAll(all);
                this.rememberEntitlements(key, current);
                return { ok: true as const, account: current, minutesCharged: 0, fairUse: false };
            }
            const spent = spendRuntimeMinutes(current, minutesRequested);
            all[key] = spent;
            await this.writeAll(all);
            this.rememberEntitlements(key, spent);
            return {
                ok: true as const,
                account: spent,
                minutesCharged: chargedRuntimeMinutes(current, spent),
                fairUse: false,
            };
        });
    }

    async addPurchasedCredits(login: string, credits: number, now: Date = new Date()): Promise<QaapBillingAccount> {
        if (credits <= 0) {
            return this.getOrCreateAccount(login, now);
        }
        const key = QaapBillingStore.normalizeLogin(login);
        return this.withLock(async () => {
            const all = await this.readAll();
            const current = applyMonthlyReset(
                this.normalizeAccount(all[key] ?? this.createDefaultAccount(key, now)),
                now,
            );
            const next: QaapBillingAccount = {
                ...current,
                purchasedCredits: current.purchasedCredits + credits,
                updatedAt: now.toISOString(),
            };
            all[key] = next;
            await this.writeAll(all);
            this.rememberEntitlements(key, next);
            return next;
        });
    }

    async addPurchasedRuntimeHours(login: string, hours: number, now: Date = new Date()): Promise<QaapBillingAccount> {
        if (hours <= 0) {
            return this.getOrCreateAccount(login, now);
        }
        const key = QaapBillingStore.normalizeLogin(login);
        return this.withLock(async () => {
            const all = await this.readAll();
            const current = applyMonthlyReset(
                this.normalizeAccount(all[key] ?? this.createDefaultAccount(key, now)),
                now,
            );
            const next: QaapBillingAccount = {
                ...current,
                purchasedRuntimeMinutes: current.purchasedRuntimeMinutes + hoursToMinutes(hours),
                updatedAt: now.toISOString(),
            };
            all[key] = next;
            await this.writeAll(all);
            this.rememberEntitlements(key, next);
            return next;
        });
    }

    /**
     * Apply a plan change (Stripe webhook or local/dev activate).
     * Resets included runtime/credits to the new plan allowance; keeps purchased top-ups.
     */
    async setPlan(
        login: string,
        planId: QaapBillingPlanId,
        stripe?: {
            readonly customerId?: string;
            readonly subscriptionId?: string;
            readonly clearSubscription?: boolean;
        },
        now: Date = new Date(),
    ): Promise<QaapBillingAccount> {
        const key = QaapBillingStore.normalizeLogin(login);
        return this.withLock(async () => {
            const all = await this.readAll();
            const current = applyMonthlyReset(
                this.normalizeAccount(all[key] ?? this.createDefaultAccount(key, now)),
                now,
            );
            const plan = getQaapBillingPlan(planId);
            const next: QaapBillingAccount = {
                ...current,
                login: key,
                planId,
                includedRuntimeMinutesRemaining: plan.runtimeFairUse
                    ? 0
                    : hoursToMinutes(plan.includedRuntimeHoursPerMonth),
                includedCreditsRemaining: plan.includedCreditsPerMonth,
                updatedAt: now.toISOString(),
                stripeCustomerId: stripe?.customerId ?? current.stripeCustomerId,
                stripeSubscriptionId: stripe?.clearSubscription
                    ? undefined
                    : (stripe?.subscriptionId ?? current.stripeSubscriptionId),
            };
            all[key] = next;
            await this.writeAll(all);
            this.rememberEntitlements(key, next);
            return next;
        });
    }

    protected createDefaultAccount(login: string, now: Date): QaapBillingAccount {
        const planId: QaapBillingPlanId = parseQaapBillingPlanId(process.env.QAAP_BILLING_DEFAULT_PLAN, 'starter');
        const plan = getQaapBillingPlan(planId);
        return {
            login,
            planId,
            includedRuntimeMinutesRemaining: plan.runtimeFairUse ? 0 : hoursToMinutes(plan.includedRuntimeHoursPerMonth),
            purchasedRuntimeMinutes: 0,
            includedCreditsRemaining: plan.includedCreditsPerMonth,
            purchasedCredits: 0,
            periodStart: startOfUtcMonth(now),
            updatedAt: now.toISOString(),
        };
    }

    /** Migrate Phase-0 accounts that predate fair-use / 160h Pro. */
    protected normalizeAccount(account: QaapBillingAccount): QaapBillingAccount {
        const plan = getQaapBillingPlan(account.planId);
        if (plan.runtimeFairUse) {
            return {
                ...account,
                includedRuntimeMinutesRemaining: 0,
                purchasedRuntimeMinutes: typeof account.purchasedRuntimeMinutes === 'number'
                    ? account.purchasedRuntimeMinutes
                    : 0,
            };
        }
        const includedRuntime = typeof account.includedRuntimeMinutesRemaining === 'number'
            ? account.includedRuntimeMinutesRemaining
            : hoursToMinutes(plan.includedRuntimeHoursPerMonth);
        const purchasedRuntime = typeof account.purchasedRuntimeMinutes === 'number'
            ? account.purchasedRuntimeMinutes
            : 0;
        return {
            ...account,
            includedRuntimeMinutesRemaining: includedRuntime,
            purchasedRuntimeMinutes: purchasedRuntime,
        };
    }

    protected async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.writeChain.then(fn, fn);
        this.writeChain = run.then(() => undefined, () => undefined);
        return run;
    }

    protected async readAll(): Promise<Record<string, QaapBillingAccount>> {
        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            const parsed = JSON.parse(raw) as Record<string, QaapBillingAccount>;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return {};
            }
            // Migrate legacy mixed-case keys to lowercase.
            const normalized: Record<string, QaapBillingAccount> = {};
            for (const [key, account] of Object.entries(parsed)) {
                const login = QaapBillingStore.normalizeLogin(account?.login || key);
                normalized[login] = { ...account, login };
            }
            return normalized;
        } catch {
            return {};
        }
    }

    protected async writeAll(data: Record<string, QaapBillingAccount>): Promise<void> {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await writeJsonAtomic(this.filePath, data, { mode: 0o600 });
    }
}

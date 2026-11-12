// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteStore, resolveQaapSqlitePath } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import {
    QAAP_BILLING_PLANS,
    entitlementsFor,
    getQaapBillingPlan,
    parseQaapBillingPlanId,
    type QaapBillingAccount,
    type QaapBillingEntitlements,
    type QaapBillingPlanId,
} from '../common/qaap-billing-plans';
import { isStripeSubscriptionEnded, isStripeSubscriptionEntitled } from './qaap-stripe-billing';

/** Stripe retries a failed delivery for up to three days; keep handled ids well past that. */
const STRIPE_EVENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface QaapStripeSubscriptionUpdate {
    /** Stripe subscription status (`active`, `trialing`, `past_due`, `canceled`, …). */
    readonly status: string;
    /** Paid plan to grant while entitled; when absent an entitled status keeps the current plan. */
    readonly planId?: QaapBillingPlanId;
    readonly subscriptionId?: string;
    readonly customerId?: string;
    /** Unix seconds of the event (or Checkout session) this state comes from. */
    readonly eventCreated: number;
    /** Set by a completed Checkout: lets the account move to this subscription from another one. */
    readonly adoptSubscription?: boolean;
}

@injectable()
export class QaapBillingStore {

    protected filePath = process.env.QAAP_BILLING_STORE_PATH?.trim()
        || path.join(os.homedir(), '.qaap', 'billing-accounts.json');
    protected writeChain: Promise<void> = Promise.resolve();
    protected sqliteStore: QaapSqliteStore | undefined;
    protected stripeEventStore: QaapSqliteStore | undefined;
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
        return Math.max(...QAAP_BILLING_PLANS.map(plan => plan.maxConcurrentAgents));
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
            const next = this.normalizeAccount(existing ?? this.createDefaultAccount(key, now));
            if (!existing || JSON.stringify(existing) !== JSON.stringify(next)) {
                all[key] = next;
                await this.writeAll(all);
            }
            this.rememberEntitlements(key, next);
            return next;
        });
    }

    /**
     * Apply a plan change (Stripe webhook or local/dev activate). Only the plan and its subscription
     * references change: the workspace limits come from the catalog on every read.
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
            const current = this.normalizeAccount(all[key] ?? this.createDefaultAccount(key, now));
            const next: QaapBillingAccount = {
                ...this.withPlan(current, key, planId, now),
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

    /**
     * Applies a Stripe subscription state (webhook event or confirmed Checkout session). Entitled
     * statuses grant `planId` (or keep the current paid plan); any other status drops to Starter while
     * keeping the subscription id, so a recovered `past_due` is upgraded again by its next event.
     * Deliveries older than the newest applied one, and events of a subscription other than the
     * account's current one (unless `adoptSubscription`), are ignored.
     */
    async applyStripeSubscription(
        login: string,
        update: QaapStripeSubscriptionUpdate,
        now: Date = new Date(),
    ): Promise<{ readonly applied: boolean; readonly account: QaapBillingAccount }> {
        const key = QaapBillingStore.normalizeLogin(login);
        return this.withLock(async () => {
            const all = await this.readAll();
            const current = this.normalizeAccount(all[key] ?? this.createDefaultAccount(key, now));
            const entitled = isStripeSubscriptionEntitled(update.status);
            const stale = (current.stripeEventCreated ?? 0) > update.eventCreated;
            const otherSubscription = !!current.stripeSubscriptionId && !!update.subscriptionId
                && current.stripeSubscriptionId !== update.subscriptionId;
            // Only a completed Checkout (webhook or confirm) may switch the account to another
            // subscription; plain updates of an old one never change its plan or id.
            if (stale || (otherSubscription && !update.adoptSubscription)) {
                return { applied: false, account: current };
            }
            const planId: QaapBillingPlanId = entitled ? (update.planId ?? current.planId) : 'starter';
            const base = planId === current.planId ? current : this.withPlan(current, key, planId, now);
            const next: QaapBillingAccount = {
                ...base,
                updatedAt: now.toISOString(),
                stripeCustomerId: update.customerId ?? current.stripeCustomerId,
                stripeSubscriptionId: isStripeSubscriptionEnded(update.status)
                    ? undefined
                    : (update.subscriptionId ?? current.stripeSubscriptionId),
                stripeSubscriptionStatus: update.status,
                stripeEventCreated: Math.max(current.stripeEventCreated ?? 0, update.eventCreated),
            };
            all[key] = next;
            await this.writeAll(all);
            this.rememberEntitlements(key, next);
            return { applied: true, account: next };
        });
    }

    /** The login whose account holds `subscriptionId`, for Stripe objects without our metadata. */
    async findLoginByStripeSubscription(subscriptionId: string): Promise<string | undefined> {
        const all = await this.readAll();
        return Object.values(all).find(account => account.stripeSubscriptionId === subscriptionId)?.login;
    }

    async hasProcessedStripeEvent(eventId: string): Promise<boolean> {
        return this.getStripeEventStore().get<number>(eventId) !== undefined;
    }

    /** Records a handled Stripe event id; ids older than Stripe's retry window are pruned. */
    async markStripeEventProcessed(eventId: string, now: Date = new Date()): Promise<void> {
        const store = this.getStripeEventStore();
        store.set(eventId, now.getTime());
        for (const [id, processedAt] of store.list<number>()) {
            if (now.getTime() - processedAt > STRIPE_EVENT_RETENTION_MS) {
                store.delete(id);
            }
        }
    }

    protected withPlan(current: QaapBillingAccount, login: string, planId: QaapBillingPlanId, now: Date): QaapBillingAccount {
        return {
            ...current,
            login,
            planId,
            updatedAt: now.toISOString(),
        };
    }

    protected createDefaultAccount(login: string, now: Date): QaapBillingAccount {
        const planId: QaapBillingPlanId = parseQaapBillingPlanId(process.env.QAAP_BILLING_DEFAULT_PLAN, 'starter');
        return {
            login,
            planId,
            updatedAt: now.toISOString(),
        };
    }

    /**
     * Keeps only the current account fields. Records persisted before the plan catalog changed still
     * carry credit / runtime meters and the retired `team` plan: the meters are dropped and `team` maps to `pro`.
     */
    protected normalizeAccount(account: QaapBillingAccount): QaapBillingAccount {
        return {
            login: account.login,
            planId: parseQaapBillingPlanId(account.planId),
            updatedAt: account.updatedAt,
            stripeCustomerId: account.stripeCustomerId,
            stripeSubscriptionId: account.stripeSubscriptionId,
            stripeSubscriptionStatus: account.stripeSubscriptionStatus,
            stripeEventCreated: account.stripeEventCreated,
        };
    }

    protected async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.writeChain.then(fn, fn);
        this.writeChain = run.then(() => undefined, () => undefined);
        return run;
    }

    protected async readAll(): Promise<Record<string, QaapBillingAccount>> {
        try {
            const store = this.getSqliteStore();
            try {
                store.migrateLegacy<QaapBillingAccount>(raw => {
                    const parsed = JSON.parse(raw) as Record<string, QaapBillingAccount>;
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        return [];
                    }
                    // Migrate legacy mixed-case keys to lowercase.
                    return Object.entries(parsed).map(([key, account]) => {
                        const login = QaapBillingStore.normalizeLogin(account?.login || key);
                        return [login, { ...account, login }] as const;
                    });
                });
            } catch {
                // A malformed legacy file must not hide valid SQLite state.
            }
            const normalized: Record<string, QaapBillingAccount> = {};
            for (const [key, account] of store.list<QaapBillingAccount>()) {
                const login = QaapBillingStore.normalizeLogin(account?.login || key);
                normalized[login] = { ...account, login };
            }
            return normalized;
        } catch {
            return {};
        }
    }

    protected async writeAll(data: Record<string, QaapBillingAccount>): Promise<void> {
        this.getSqliteStore().replace(Object.entries(data));
    }

    protected getStripeEventStore(): QaapSqliteStore {
        return this.stripeEventStore ??= new QaapSqliteStore({
            databasePath: resolveQaapSqlitePath(this.filePath),
            namespace: 'billing-stripe-events',
        });
    }

    protected getSqliteStore(): QaapSqliteStore {
        return this.sqliteStore ??= new QaapSqliteStore({
            databasePath: resolveQaapSqlitePath(this.filePath),
            namespace: 'billing-accounts',
            legacyPath: this.filePath,
        });
    }
}

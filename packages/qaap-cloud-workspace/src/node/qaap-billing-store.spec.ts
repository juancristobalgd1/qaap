// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hoursToMinutes } from '../common/qaap-billing-plans';
import { QaapBillingStore } from './qaap-billing-store';

import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';

function makeStore(filePath: string): QaapBillingStore {
    const store = Object.create(QaapBillingStore.prototype) as QaapBillingStore;
    Object.assign(store, {
        filePath,
        writeChain: Promise.resolve(),
        entitlementsCache: new Map(),
    });
    return store;
}

describe('QaapBillingStore', () => {
    let tmpDir: string;
    let filePath: string;
    const savedDefault = process.env.QAAP_BILLING_DEFAULT_PLAN;
    const savedConcurrent = process.env.QAAP_MAX_CONCURRENT_AGENTS_PER_USER;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-billing-'));
        filePath = path.join(tmpDir, 'billing-accounts.json');
        delete process.env.QAAP_BILLING_DEFAULT_PLAN;
        delete process.env.QAAP_MAX_CONCURRENT_AGENTS_PER_USER;
    });

    afterEach(() => {
        QaapSqliteConnectionRegistry.shared.closeUnder(tmpDir);
        fs.rmSync(tmpDir, { recursive: true, force: true });
        if (savedDefault === undefined) {
            delete process.env.QAAP_BILLING_DEFAULT_PLAN;
        } else {
            process.env.QAAP_BILLING_DEFAULT_PLAN = savedDefault;
        }
        if (savedConcurrent === undefined) {
            delete process.env.QAAP_MAX_CONCURRENT_AGENTS_PER_USER;
        } else {
            process.env.QAAP_MAX_CONCURRENT_AGENTS_PER_USER = savedConcurrent;
        }
    });

    it('defaults new users to Starter fair-use (no clock, no hosted credits)', async () => {
        const entitlements = await makeStore(filePath).getEntitlements('alice');
        expect(entitlements.planId).to.equal('starter');
        expect(entitlements.hostedModels).to.equal(false);
        expect(entitlements.runtimeFairUse).to.equal(true);
        expect(entitlements.canStartAgent).to.equal(true);
        expect(entitlements.creditsRemaining).to.equal(0);
        expect(entitlements.runtimeHoursRemaining).to.equal(-1);
        expect(entitlements.storageGb).to.equal(5);
    });

    it('Starter fair-use does not debit runtime and always allows new jobs', async () => {
        const store = makeStore(filePath);
        const result = await store.debitRuntime('alice', 90_000);
        expect(result.ok).to.equal(true);
        expect(result.fairUse).to.equal(true);
        expect(result.minutesCharged).to.equal(0);
        expect(await store.canStartAgent('alice')).to.equal(true);
    });

    it('setPlan upgrades to Pro and resets included allowances', async () => {
        const store = makeStore(filePath);
        await store.getOrCreateAccount('alice');
        const next = await store.setPlan('alice', 'pro', {
            customerId: 'cus_test',
            subscriptionId: 'sub_test',
        });
        expect(next.planId).to.equal('pro');
        expect(next.includedCreditsRemaining).to.equal(2500);
        expect(next.includedRuntimeMinutesRemaining).to.equal(hoursToMinutes(160));
        expect(next.stripeCustomerId).to.equal('cus_test');
        expect(next.stripeSubscriptionId).to.equal('sub_test');
        expect(store.maxConcurrentAgentsForOwner('Alice')).to.equal(4);
    });

    it('normalizes login casing so Alice and alice share one wallet', async () => {
        const store = makeStore(filePath);
        await store.setPlan('Alice', 'pro');
        const entitlements = await store.getEntitlements('alice');
        expect(entitlements.planId).to.equal('pro');
        expect(entitlements.maxConcurrentAgents).to.equal(4);
        expect(entitlements.maxActiveRepos).to.equal(10);
        expect(entitlements.hostedModels).to.equal(true);
    });

    it('refuses hosted debit on Starter', async () => {
        const result = await makeStore(filePath).debitHostedUsage('alice', 'gpt-5.6-sol', 1000, 100);
        expect(result.ok).to.equal(false);
        if (!result.ok) {
            expect(result.reason).to.equal('not_hosted');
        }
    });

    it('debits Codex Sol from Pro included credits', async () => {
        process.env.QAAP_BILLING_DEFAULT_PLAN = 'pro';
        const result = await makeStore(filePath).debitHostedUsage('bob', 'gpt-5.6-sol', 100_000, 8_000);
        expect(result.ok).to.equal(true);
        if (result.ok) {
            expect(result.creditsCharged).to.equal(97);
            expect(result.account.includedCreditsRemaining).to.equal(2500 - 97);
        }
    });

    it('debits agent wall-clock minutes on Pro and still finishes if remaining is short', async () => {
        process.env.QAAP_BILLING_DEFAULT_PLAN = 'pro';
        const store = makeStore(filePath);
        const first = await store.debitRuntime('bob', 90_000);
        expect(first.minutesCharged).to.equal(2);
        expect(first.account.includedRuntimeMinutesRemaining).to.equal(hoursToMinutes(160) - 2);
        const drained = await store.debitRuntime('bob', hoursToMinutes(200) * 60_000);
        expect(drained.ok).to.equal(true);
        expect(drained.account.includedRuntimeMinutesRemaining).to.equal(0);
        expect(await store.canStartAgent('bob')).to.equal(false);
    });

    it('rejects unknown hosted models even on Pro', async () => {
        process.env.QAAP_BILLING_DEFAULT_PLAN = 'pro';
        const result = await makeStore(filePath).debitHostedUsage('bob', 'claude-fable-5', 1000, 100);
        expect(result.ok).to.equal(false);
        if (!result.ok) {
            expect(result.reason).to.equal('unknown_model');
        }
    });

    it('adds purchased credits that survive a hosted debit', async () => {
        process.env.QAAP_BILLING_DEFAULT_PLAN = 'pro';
        const store = makeStore(filePath);
        await store.addPurchasedCredits('bob', 50);
        const result = await store.debitHostedUsage('bob', 'gpt-5.6-luna', 100_000, 8_000);
        expect(result.ok).to.equal(true);
        if (result.ok) {
            expect(result.account.purchasedCredits).to.equal(50);
            expect(result.account.includedCreditsRemaining).to.equal(2500 - 4);
        }
    });

    it('warms peek entitlements and caps concurrency to the plan', async () => {
        const store = makeStore(filePath);
        expect(store.maxConcurrentAgentsForOwner('alice')).to.equal(2);
        await store.getOrCreateAccount('alice');
        expect(store.peekEntitlements('alice')?.planId).to.equal('starter');
        expect(store.maxConcurrentAgentsForOwner('alice')).to.equal(2);
        await store.setPlan('alice', 'pro');
        expect(store.maxConcurrentAgentsForOwner('alice')).to.equal(4);
        await store.setPlan('alice', 'team');
        expect(store.maxConcurrentAgentsForOwner('alice')).to.equal(8);
    });

    it('partial-charges hosted credits when remaining is short', async () => {
        process.env.QAAP_BILLING_DEFAULT_PLAN = 'pro';
        const store = makeStore(filePath);
        await store.getOrCreateAccount('bob');
        await store.setPlan('bob', 'pro');
        const drained = await store.debitHostedUsage('bob', 'gpt-5.6-sol', 100_000, 8_000);
        expect(drained.ok).to.equal(true);
        const leftover = await store.debitHostedUsage('bob', 'gpt-5.6-sol', 10_000_000, 10_000_000);
        expect(leftover.ok).to.equal(false);
        if (!leftover.ok) {
            expect(leftover.reason).to.equal('insufficient_credits');
            expect(leftover.creditsCharged).to.equal(2500 - 97);
            expect(leftover.account.includedCreditsRemaining).to.equal(0);
        }
    });

    describe('Stripe subscription lifecycle', () => {
        const active = { status: 'active', planId: 'pro' as const, subscriptionId: 'sub_1', customerId: 'cus_1' };

        it('drops a past_due subscription to Starter and restores Pro when it is active again', async () => {
            const store = makeStore(filePath);
            await store.applyStripeSubscription('alice', { ...active, eventCreated: 100 });
            expect((await store.getEntitlements('alice')).planId).to.equal('pro');

            const pastDue = await store.applyStripeSubscription('alice', { status: 'past_due', subscriptionId: 'sub_1', eventCreated: 200 });
            expect(pastDue.applied).to.equal(true);
            expect(pastDue.account.planId).to.equal('starter');
            expect(pastDue.account.stripeSubscriptionId).to.equal('sub_1');
            expect((await store.getEntitlements('alice')).hostedModels).to.equal(false);

            const recovered = await store.applyStripeSubscription('alice', { status: 'active', subscriptionId: 'sub_1', eventCreated: 300 });
            expect(recovered.account.planId).to.equal('starter', 'no planId in the event: an entitled status keeps the current plan');
            const withPlan = await store.applyStripeSubscription('alice', { ...active, eventCreated: 301 });
            expect(withPlan.account.planId).to.equal('pro');
        });

        it('ignores deliveries older than the newest applied event', async () => {
            const store = makeStore(filePath);
            await store.applyStripeSubscription('alice', { ...active, eventCreated: 100 });
            await store.applyStripeSubscription('alice', { status: 'canceled', subscriptionId: 'sub_1', eventCreated: 300 });
            const late = await store.applyStripeSubscription('alice', { ...active, eventCreated: 200 });
            expect(late.applied).to.equal(false);
            expect(late.account.planId).to.equal('starter');
            expect(late.account.stripeSubscriptionId).to.equal(undefined);
        });

        it('does not let a non-entitled event of another subscription downgrade the current one', async () => {
            const store = makeStore(filePath);
            await store.applyStripeSubscription('alice', { ...active, subscriptionId: 'sub_new', eventCreated: 100 });
            const old = await store.applyStripeSubscription('alice', { status: 'canceled', subscriptionId: 'sub_old', eventCreated: 200 });
            expect(old.applied).to.equal(false);
            expect(old.account.planId).to.equal('pro');
        });

        it('never switches to another subscription on a plain update, only from a completed Checkout', async () => {
            const store = makeStore(filePath);
            await store.applyStripeSubscription('alice', { ...active, subscriptionId: 'sub_team', planId: 'team', eventCreated: 100 });
            const oldActive = await store.applyStripeSubscription('alice', { ...active, subscriptionId: 'sub_old', planId: 'pro', eventCreated: 200 });
            expect(oldActive.applied).to.equal(false);
            expect(oldActive.account.planId).to.equal('team');
            expect(oldActive.account.stripeSubscriptionId).to.equal('sub_team');
            const checkout = await store.applyStripeSubscription('alice', {
                ...active, subscriptionId: 'sub_new', planId: 'pro', eventCreated: 300, adoptSubscription: true,
            });
            expect(checkout.applied).to.equal(true);
            expect(checkout.account.planId).to.equal('pro');
            expect(checkout.account.stripeSubscriptionId).to.equal('sub_new');
        });

        it('does not refill allowances when the plan is unchanged', async () => {
            const store = makeStore(filePath);
            await store.applyStripeSubscription('alice', { ...active, eventCreated: 100 });
            await store.debitHostedUsage('alice', 'gpt-5.6-sol', 100_000, 8_000);
            const before = (await store.getOrCreateAccount('alice')).includedCreditsRemaining;
            const again = await store.applyStripeSubscription('alice', { ...active, eventCreated: 150 });
            expect(again.account.includedCreditsRemaining).to.equal(before);
        });

        it('finds the login of a subscription and remembers handled event ids', async () => {
            const store = makeStore(filePath);
            await store.applyStripeSubscription('Alice', { ...active, eventCreated: 100 });
            expect(await store.findLoginByStripeSubscription('sub_1')).to.equal('alice');
            expect(await store.hasProcessedStripeEvent('evt_1')).to.equal(false);
            await store.markStripeEventProcessed('evt_1');
            expect(await store.hasProcessedStripeEvent('evt_1')).to.equal(true);
        });
    });
});

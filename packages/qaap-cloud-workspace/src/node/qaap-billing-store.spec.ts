// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

    it('defaults new users to Starter with the catalog allowances', async () => {
        const entitlements = await makeStore(filePath).getEntitlements('alice');
        expect(entitlements).to.deep.include({
            planId: 'starter',
            priceUsdMonthly: 4.99,
            storageGb: 10,
            maxActiveRepos: 3,
            maxConcurrentAgents: 2,
            idlePauseMinutes: 30,
        });
    });

    it('setPlan upgrades to Pro and records the subscription references', async () => {
        const store = makeStore(filePath);
        await store.getOrCreateAccount('alice');
        const next = await store.setPlan('alice', 'pro', {
            customerId: 'cus_test',
            subscriptionId: 'sub_test',
        });
        expect(next.planId).to.equal('pro');
        expect(next.stripeCustomerId).to.equal('cus_test');
        expect(next.stripeSubscriptionId).to.equal('sub_test');
        expect(store.maxConcurrentAgentsForOwner('Alice')).to.equal(4);
    });

    it('normalizes login casing so Alice and alice share one account', async () => {
        const store = makeStore(filePath);
        await store.setPlan('Alice', 'pro');
        const entitlements = await store.getEntitlements('alice');
        expect(entitlements.planId).to.equal('pro');
        expect(entitlements.maxConcurrentAgents).to.equal(4);
        expect(entitlements.maxActiveRepos).to.equal(10);
        expect(entitlements.storageGb).to.equal(30);
        expect(entitlements.memoryOptionsGb).to.deep.equal([2, 4]);
    });

    it('honours the operator concurrency ceiling below the plan cap', async () => {
        process.env.QAAP_MAX_CONCURRENT_AGENTS_PER_USER = '3';
        const store = makeStore(filePath);
        await store.setPlan('alice', 'pro');
        expect(store.maxConcurrentAgentsForOwner('alice')).to.equal(3);
    });

    it('warms peek entitlements and caps concurrency to the plan', async () => {
        const store = makeStore(filePath);
        expect(store.maxConcurrentAgentsForOwner('alice')).to.equal(2);
        await store.getOrCreateAccount('alice');
        expect(store.peekEntitlements('alice')?.planId).to.equal('starter');
        expect(store.maxConcurrentAgentsForOwner('alice')).to.equal(2);
        await store.setPlan('alice', 'pro');
        expect(store.maxConcurrentAgentsForOwner('alice')).to.equal(4);
    });

    it('maps a legacy team record to pro and drops its retired credit and runtime meters', async () => {
        fs.writeFileSync(filePath, JSON.stringify({
            Bob: {
                login: 'Bob',
                planId: 'team',
                includedCreditsRemaining: 10000,
                purchasedCredits: 5,
                includedRuntimeMinutesRemaining: 30000,
                purchasedRuntimeMinutes: 120,
                periodStart: '2026-08-01T00:00:00.000Z',
                updatedAt: '2026-08-01T00:00:00.000Z',
            },
        }));
        const store = makeStore(filePath);
        const account = await store.getOrCreateAccount('bob');
        expect(account.planId).to.equal('pro');
        expect(account).to.not.have.property('includedCreditsRemaining');
        expect(account).to.not.have.property('purchasedRuntimeMinutes');
        const entitlements = await store.getEntitlements('bob');
        expect(entitlements.planId).to.equal('pro');
        expect(entitlements.maxConcurrentAgents).to.equal(4);
        expect(entitlements).to.not.have.property('creditsRemaining');
        expect(entitlements).to.not.have.property('canStartAgent');
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
            expect((await store.getEntitlements('alice')).planId).to.equal('starter');

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
            await store.applyStripeSubscription('alice', { ...active, subscriptionId: 'sub_current', planId: 'pro', eventCreated: 100 });
            const oldActive = await store.applyStripeSubscription('alice', { ...active, subscriptionId: 'sub_old', planId: 'pro', eventCreated: 200 });
            expect(oldActive.applied).to.equal(false);
            expect(oldActive.account.stripeSubscriptionId).to.equal('sub_current');
            const checkout = await store.applyStripeSubscription('alice', {
                ...active, subscriptionId: 'sub_new', planId: 'pro', eventCreated: 300, adoptSubscription: true,
            });
            expect(checkout.applied).to.equal(true);
            expect(checkout.account.planId).to.equal('pro');
            expect(checkout.account.stripeSubscriptionId).to.equal('sub_new');
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

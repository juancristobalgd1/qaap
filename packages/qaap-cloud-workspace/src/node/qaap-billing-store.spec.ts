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
});

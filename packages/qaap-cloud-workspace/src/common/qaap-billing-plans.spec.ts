// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_BILLING_PLANS,
    entitlementsFor,
    getQaapBillingPlan,
    parseQaapBillingPlanId,
    wouldExceedActiveRepoLimit,
    type QaapBillingAccount,
} from './qaap-billing-plans';

function account(overrides: Partial<QaapBillingAccount> = {}): QaapBillingAccount {
    return {
        login: 'alice',
        planId: 'pro',
        updatedAt: '2026-08-01T00:00:00.000Z',
        ...overrides,
    };
}

describe('qaap-billing-plans', () => {
    it('catalog lists exactly Starter and Pro in USD', () => {
        expect(QAAP_BILLING_PLANS.map(plan => plan.id)).to.deep.equal(['starter', 'pro']);
        expect(QAAP_BILLING_PLANS.map(plan => plan.priceUsdMonthly)).to.deep.equal([4.99, 12]);
    });

    it('Starter: 2 GB memory only, 2 cores, 10 GB storage, 3 repos, 2 agents, 30 min idle pause', () => {
        const starter = entitlementsFor(account({ planId: 'starter' }));
        expect(starter).to.deep.include({
            planId: 'starter',
            priceUsdMonthly: 4.99,
            defaultMemoryGb: 2,
            cpuLimit: 2,
            storageGb: 10,
            maxActiveRepos: 3,
            maxConcurrentAgents: 2,
            idlePauseMinutes: 30,
        });
        expect(starter.memoryOptionsGb).to.deep.equal([2]);
    });

    it('Pro: 2 or 4 GB memory, 4 cores, 30 GB storage, 10 repos, 4 agents, 360 min idle pause', () => {
        const pro = entitlementsFor(account());
        expect(pro).to.deep.include({
            planId: 'pro',
            priceUsdMonthly: 12,
            defaultMemoryGb: 2,
            cpuLimit: 4,
            storageGb: 30,
            maxActiveRepos: 10,
            maxConcurrentAgents: 4,
            idlePauseMinutes: 360,
        });
        expect(pro.memoryOptionsGb).to.deep.equal([2, 4]);
    });

    it('entitlements copy the memory options so callers cannot mutate the catalog', () => {
        const pro = entitlementsFor(account());
        (pro.memoryOptionsGb as number[]).push(8);
        expect(getQaapBillingPlan('pro').memoryOptionsGb).to.deep.equal([2, 4]);
    });

    it('parses plan ids with starter fallback', () => {
        expect(parseQaapBillingPlanId('PRO')).to.equal('pro');
        expect(parseQaapBillingPlanId('nope')).to.equal('starter');
        expect(parseQaapBillingPlanId(undefined)).to.equal('starter');
    });

    it('maps the retired team plan to pro', () => {
        expect(parseQaapBillingPlanId('team')).to.equal('pro');
        expect(parseQaapBillingPlanId(' Team ')).to.equal('pro');
        expect(entitlementsFor(account({ planId: parseQaapBillingPlanId('team') })).planId).to.equal('pro');
    });

    it('enforces active-repo caps for Starter/Pro', () => {
        expect(wouldExceedActiveRepoLimit(3, 3, false)).to.equal(true);
        expect(wouldExceedActiveRepoLimit(3, 2, false)).to.equal(false);
        expect(wouldExceedActiveRepoLimit(3, 3, true)).to.equal(false);
        expect(wouldExceedActiveRepoLimit(-1, 99, false)).to.equal(false);
    });
});

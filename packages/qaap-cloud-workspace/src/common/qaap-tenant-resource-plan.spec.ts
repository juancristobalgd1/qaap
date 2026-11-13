// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_BILLING_PLANS } from './qaap-billing-plans';
import {
    clampProjectMemoryGb,
    effectiveTenantMemoryGb,
    isProjectMemoryAllowed,
    tenantPlanSizing,
} from './qaap-tenant-resource-plan';

const starter = QAAP_BILLING_PLANS.find(plan => plan.id === 'starter')!;
const pro = QAAP_BILLING_PLANS.find(plan => plan.id === 'pro')!;

describe('qaap-tenant-resource-plan', () => {

    it('snaps a request to the largest option not above it, or the smallest option below all', () => {
        expect(clampProjectMemoryGb([2, 4], 4)).to.equal(4);
        expect(clampProjectMemoryGb([2, 4], 3)).to.equal(2);
        expect(clampProjectMemoryGb([2, 4], 1)).to.equal(2);
        expect(clampProjectMemoryGb([2], 4)).to.equal(2);
    });

    it('accepts only the options of the plan', () => {
        expect(isProjectMemoryAllowed(starter, 2)).to.equal(true);
        expect(isProjectMemoryAllowed(starter, 4)).to.equal(false);
        expect(isProjectMemoryAllowed(pro, 4)).to.equal(true);
    });

    it('takes the largest saved project choice and falls back to the plan default', () => {
        expect(effectiveTenantMemoryGb(pro, [2, 4, 2])).to.equal(4);
        expect(effectiveTenantMemoryGb(pro, [])).to.equal(pro.defaultMemoryGb);
        expect(effectiveTenantMemoryGb(starter, [])).to.equal(2);
    });

    it('clamps a saved choice that the plan no longer offers (downgrade from Pro to Starter)', () => {
        expect(effectiveTenantMemoryGb(starter, [4])).to.equal(2);
    });

    it('converts the plan into Docker units: bytes memory, NanoCpus from cpuLimit', () => {
        const sizing = tenantPlanSizing(pro, [4]);
        expect(sizing.planId).to.equal('pro');
        expect(sizing.memoryGb).to.equal(4);
        expect(sizing.memoryBytes).to.equal(4 * 1024 ** 3);
        expect(sizing.nanoCpus).to.equal(4e9);
        expect(tenantPlanSizing(starter, []).nanoCpus).to.equal(2e9);
    });
});

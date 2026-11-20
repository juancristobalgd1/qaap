// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { MobileWorkHubBillingSheet } from './mobile-work-hub-billing-sheet';
import { rememberQaapAccountBillingPlanId } from './qaap-workbench-account-menu';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

const STARTER_PLAN = {
    id: 'starter',
    priceUsdMonthly: 4.99,
    memoryOptionsGb: [2],
    defaultMemoryGb: 2,
    cpuLimit: 2,
    storageGb: 10,
    maxActiveRepos: 3,
    maxConcurrentAgents: 2,
    idlePauseMinutes: 30,
};

const PRO_PLAN = {
    id: 'pro',
    priceUsdMonthly: 12,
    memoryOptionsGb: [2, 4],
    defaultMemoryGb: 2,
    cpuLimit: 4,
    storageGb: 30,
    maxActiveRepos: 10,
    maxConcurrentAgents: 4,
    idlePauseMinutes: 360,
};

/** Billing snapshot as `GET /qaap/api/billing` returns it for the given plan and subscription state. */
function billingSnapshot(planId: 'starter' | 'pro', subscriptionStatus?: string): object {
    const plan = planId === 'pro' ? PRO_PLAN : STARTER_PLAN;
    return {
        account: {
            login: 'octocat',
            planId,
            updatedAt: '2026-11-13T00:00:00.000Z',
            ...(subscriptionStatus ? { subscriptionId: 'sub_1', subscriptionStatus } : {}),
        },
        entitlements: { ...plan, planId },
        catalog: { plans: [STARTER_PLAN, PRO_PLAN] },
        checkout: { checkoutEnabled: true, devActivateEnabled: false, payablePlanIds: ['starter', 'pro'] },
    };
}

describe('MobileWorkHubBillingSheet plans', () => {

    useSuiteJSDOM();

    const originalFetch = globalThis.fetch;
    let originalRaf: typeof globalThis.requestAnimationFrame;
    let sheet: MobileWorkHubBillingSheet | undefined;

    function stubBilling(body: object): void {
        globalThis.fetch = (async (): Promise<Response> => new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;
    }

    async function open(body: object): Promise<HTMLElement> {
        stubBilling(body);
        sheet = new MobileWorkHubBillingSheet();
        await sheet.show();
        return sheet.node;
    }

    beforeEach(() => {
        originalRaf = globalThis.requestAnimationFrame;
        // Scroll-into-view after render is not part of these assertions.
        globalThis.requestAnimationFrame = (): number => 0;
    });

    afterEach(() => {
        sheet?.dispose();
        sheet = undefined;
        globalThis.fetch = originalFetch;
        globalThis.requestAnimationFrame = originalRaf;
        // show() remembers the plan for the account menu label; do not leak it into other suites.
        rememberQaapAccountBillingPlanId(undefined);
        document.body.innerHTML = '';
    });

    it('shows exactly two plans, Starter $4.99 and Pro $12 per month', async () => {
        const node = await open(billingSnapshot('starter'));
        const slides = Array.from(node.querySelectorAll<HTMLElement>('.theia-mobile-work-hub-billing-plan-slide'));
        expect(slides.map(slide => slide.dataset.planId)).to.deep.equal(['starter', 'pro']);
        const amounts = Array.from(node.querySelectorAll('.theia-mobile-work-hub-billing-plan-amount'))
            .map(amount => amount.textContent);
        expect(amounts).to.deep.equal(['$4.99', '$12']);
    });

    it('drops credits, runtime hours, EUR, Team and free-tier framing', async () => {
        const node = await open(billingSnapshot('starter'));
        const text = node.textContent ?? '';
        expect(text).to.not.match(/credit|runtime|€|Team|hosted|Stay on Starter|Fair-use/i);
        expect(text).to.include('Bring your own AI: sign in with your Claude, Codex or Copilot subscription, or use an API key.');
    });

    it('lists the Pro RAM choice per project and the Starter single size', async () => {
        const node = await open(billingSnapshot('starter'));
        const starter = node.querySelector<HTMLElement>('.theia-mobile-work-hub-billing-plan-slide[data-plan-id="starter"]');
        const pro = node.querySelector<HTMLElement>('.theia-mobile-work-hub-billing-plan-slide[data-plan-id="pro"]');
        expect(starter?.textContent).to.include('2 GB RAM');
        expect(pro?.textContent).to.include('2 or 4 GB RAM per project');
        const detail = Array.from(node.querySelectorAll('.theia-mobile-work-hub-billing-detail-list li')).map(li => li.textContent);
        expect(detail).to.deep.equal(['2 GB RAM', '2 vCPU', '10 GB storage', 'Up to 3 active repos', '2 parallel agents', 'Pauses after 30 min idle']);
    });

    it('marks the active plan as current and disables its button', async () => {
        const node = await open(billingSnapshot('pro'));
        const pro = node.querySelector<HTMLElement>('.theia-mobile-work-hub-billing-plan-slide[data-plan-id="pro"]');
        expect(pro?.classList.contains('theia-mod-current')).to.equal(true);
        const cta = node.querySelector<HTMLButtonElement>('.theia-mobile-work-hub-billing-cta-btn');
        expect(cta?.disabled).to.equal(true);
        expect(cta?.textContent).to.equal('Your current plan');
    });

    it('offers Cancel subscription only while a subscription is active', async () => {
        const active = await open(billingSnapshot('pro', 'active'));
        expect(active.querySelector('.theia-mobile-work-hub-billing-cancel-btn')).to.not.equal(null);
        sheet?.dispose();
        const free = await open(billingSnapshot('starter'));
        expect(free.querySelector('.theia-mobile-work-hub-billing-cancel-btn')).to.equal(null);
    });
});

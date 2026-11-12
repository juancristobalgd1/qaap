// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapUserFacingErrors } from '@theia/qaap-adapters/lib/common/qaap-user-facing-error';
import { nls } from '@theia/core/lib/common/nls';
import {
    activateQaapBillingPlanDev,
    cancelQaapBillingSubscription,
    createQaapBillingCheckout,
    fetchQaapBilling,
    type QaapBillingApiResponse,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { isWorkHubTheiaDialogOpen } from '../common/qaap-work-hub-dialog-utils';
import { rememberQaapAccountBillingPlanId } from './qaap-workbench-account-menu';

type BillingPlan = QaapBillingApiResponse['catalog']['plans'][number];
type BillingPlanId = 'starter' | 'pro';

/** The only two plans offered; the order is the slider order. */
const BILLING_PLAN_IDS: readonly BillingPlanId[] = ['starter', 'pro'];

function planDisplayName(planId: string): string {
    switch (planId) {
        case 'pro':
            return nls.localize('qaap/billing/planPro', 'Pro');
        default:
            return nls.localize('qaap/billing/planStarter', 'Starter');
    }
}

function planTagline(planId: string): string {
    switch (planId) {
        case 'pro':
            return nls.localize('qaap/billing/taglinePro', 'For parallel agent work');
        default:
            return nls.localize('qaap/billing/taglineStarter', 'For a few projects at a time');
    }
}

function formatUsd(value: number): string {
    return new Intl.NumberFormat(nls.locale ?? nls.defaultLocale, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(value);
}

function formatCount(value: number): string {
    return new Intl.NumberFormat(nls.locale ?? nls.defaultLocale, { maximumFractionDigits: 1 }).format(value);
}

function isBillingPlanId(planId: string): planId is BillingPlanId {
    return planId === 'starter' || planId === 'pro';
}

/** Work Hub overlay for plan picker, hosted checkout, cancellation, and plan allowances. */
export class MobileWorkHubBillingSheet {

    readonly node: HTMLElement;
    protected readonly contentHost: HTMLElement;
    protected readonly titleEl: HTMLElement;
    protected visible = false;
    protected loadToken = 0;
    protected data: QaapBillingApiResponse | undefined;
    protected selectedPlanId: BillingPlanId = 'starter';
    protected checkoutBusy = false;
    protected cancelBusy = false;
    protected detailHost: HTMLElement | undefined;
    protected ctaHost: HTMLElement | undefined;
    protected dotsHost: HTMLElement | undefined;

    protected readonly onKeyDown = (ev: KeyboardEvent): void => {
        if (ev.key === 'Escape' && this.visible) {
            if (isWorkHubTheiaDialogOpen()) {
                return;
            }
            ev.stopPropagation();
            this.hide();
        }
    };

    constructor() {
        this.node = document.createElement('div');
        this.node.className = 'theia-mobile-work-hub-preferences theia-mobile-work-hub-billing';
        this.node.setAttribute('role', 'dialog');
        this.node.setAttribute('aria-modal', 'true');
        this.node.setAttribute('aria-hidden', 'true');
        this.node.hidden = true;

        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-work-hub-preferences-backdrop';
        backdrop.addEventListener('click', () => this.hide());

        const sheet = document.createElement('section');
        sheet.className = 'theia-mobile-work-hub-preferences-sheet';

        const header = document.createElement('header');
        header.className = 'theia-mobile-work-hub-preferences-header';

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'theia-mobile-work-hub-preferences-back theia-mobile-projects-header-back';
        backBtn.title = nls.localize('qaap/mobileProjects/backToProjects', 'Back to projects');
        backBtn.setAttribute('aria-label', backBtn.title);
        backBtn.innerHTML = '<span class="codicon codicon-chevron-left" aria-hidden="true"></span>';
        backBtn.addEventListener('click', () => this.hide());

        this.titleEl = document.createElement('h2');
        this.titleEl.className = 'theia-mobile-work-hub-preferences-title';
        this.titleEl.textContent = nls.localize('qaap/accountMenu/billing', 'Billing');

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'theia-mobile-work-hub-preferences-close codicon codicon-close';
        closeBtn.title = nls.localize('qaap/mobileWorkHubPreferences/close', 'Close');
        closeBtn.setAttribute('aria-label', closeBtn.title);
        closeBtn.addEventListener('click', () => this.hide());

        header.append(backBtn, this.titleEl, closeBtn);

        this.contentHost = document.createElement('div');
        this.contentHost.className = 'theia-mobile-work-hub-billing-scroll';
        this.contentHost.setAttribute('role', 'region');
        this.contentHost.setAttribute('aria-label', this.titleEl.textContent ?? 'Billing');

        sheet.append(header, this.contentHost);
        this.node.append(backdrop, sheet);
    }

    isVisible(): boolean {
        return this.visible;
    }

    async show(options?: { readonly afterCheckout?: boolean }): Promise<void> {
        if (!this.node.parentElement) {
            document.body.appendChild(this.node);
        }
        this.node.hidden = false;
        this.node.classList.add('theia-mod-visible');
        this.node.setAttribute('aria-hidden', 'false');
        this.visible = true;
        document.addEventListener('keydown', this.onKeyDown, true);
        this.renderLoading();
        const token = ++this.loadToken;
        const data = await fetchQaapBilling();
        if (!this.visible || token !== this.loadToken) {
            return;
        }
        if (!data) {
            this.renderError();
            return;
        }
        this.data = data;
        // Focus the user's active plan so post-checkout (and revisits) show "Your current plan".
        this.selectedPlanId = isBillingPlanId(data.entitlements.planId) ? data.entitlements.planId : 'starter';
        rememberQaapAccountBillingPlanId(this.selectedPlanId);
        this.renderBilling(data, options?.afterCheckout === true);
        requestAnimationFrame(() => this.scrollSelectedPlanIntoView(true));
    }

    hide(): void {
        if (!this.visible) {
            return;
        }
        this.loadToken += 1;
        this.node.classList.remove('theia-mod-visible');
        this.node.hidden = true;
        this.node.setAttribute('aria-hidden', 'true');
        this.visible = false;
        document.removeEventListener('keydown', this.onKeyDown, true);
    }

    dispose(): void {
        this.hide();
        this.node.remove();
    }

    protected renderLoading(): void {
        this.contentHost.replaceChildren();
        const status = document.createElement('p');
        status.className = 'theia-mobile-work-hub-billing-status';
        status.textContent = nls.localize('qaap/billing/loading', 'Loading billing…');
        this.contentHost.append(status);
    }

    protected renderError(): void {
        this.contentHost.replaceChildren();
        const status = document.createElement('p');
        status.className = 'theia-mobile-work-hub-billing-status';
        status.textContent = nls.localize(
            'qaap/billing/loadError',
            'Could not load billing. Sign in and try again.',
        );
        this.contentHost.append(status);
    }

    protected renderBilling(data: QaapBillingApiResponse, afterCheckout: boolean = false): void {
        this.contentHost.replaceChildren();
        const currentPlanId = data.entitlements.planId;
        const currentName = planDisplayName(currentPlanId);
        const intro = document.createElement('section');
        intro.className = 'theia-mobile-work-hub-billing-intro';
        const eyebrow = document.createElement('p');
        eyebrow.className = 'theia-mobile-work-hub-billing-eyebrow';
        eyebrow.textContent = nls.localize('qaap/billing/eyebrow', 'Subscription');
        const headline = document.createElement('h3');
        headline.className = 'theia-mobile-work-hub-billing-headline';
        const sub = document.createElement('p');
        sub.className = 'theia-mobile-work-hub-billing-subhead';
        if (afterCheckout) {
            headline.textContent = nls.localize('qaap/billing/headlineAfterCheckout', 'You are on {0}', currentName);
            sub.textContent = nls.localize(
                'qaap/billing/subheadAfterCheckout',
                'Payment confirmed. This is your current plan. Allowances reset each billing period.',
            );
        } else {
            headline.textContent = nls.localize('qaap/billing/headline', 'Pick a plan that matches how you ship');
            sub.textContent = nls.localize(
                'qaap/billing/subhead',
                'Both plans are billed monthly in USD through Airwallex. Swipe to compare them.',
            );
        }
        const byo = document.createElement('p');
        byo.className = 'theia-mobile-work-hub-billing-byo';
        byo.textContent = nls.localize(
            'qaap/billing/byoLine',
            'Bring your own AI: sign in with your Claude, Codex or Copilot subscription, or use an API key.',
        );
        intro.append(eyebrow, headline, sub, byo);

        const sliderSection = document.createElement('section');
        sliderSection.className = 'theia-mobile-work-hub-billing-section theia-mobile-work-hub-billing-slider-section';
        const slider = document.createElement('div');
        slider.className = 'theia-mobile-work-hub-billing-plan-slider';
        slider.setAttribute('role', 'listbox');
        slider.setAttribute('aria-label', nls.localize('qaap/billing/allPlans', 'Plans'));
        for (const plan of this.catalogPlans(data)) {
            slider.append(this.createPlanSlide(plan, currentPlanId));
        }
        slider.addEventListener('scroll', () => this.syncDotsFromScroll(slider), { passive: true });
        this.dotsHost = document.createElement('div');
        this.dotsHost.className = 'theia-mobile-work-hub-billing-plan-dots';
        this.dotsHost.setAttribute('role', 'tablist');
        for (const plan of this.catalogPlans(data)) {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'theia-mobile-work-hub-billing-plan-dot';
            dot.dataset.planId = plan.id;
            dot.setAttribute('aria-label', planDisplayName(plan.id));
            if (plan.id === this.selectedPlanId) {
                dot.classList.add('theia-mod-active');
            }
            dot.addEventListener('click', () => this.selectPlan(plan.id, true));
            this.dotsHost.append(dot);
        }
        sliderSection.append(slider, this.dotsHost);

        this.detailHost = document.createElement('section');
        this.detailHost.className = 'theia-mobile-work-hub-billing-detail';
        this.ctaHost = document.createElement('div');
        this.ctaHost.className = 'theia-mobile-work-hub-billing-cta-host';

        this.contentHost.append(intro, sliderSection, this.detailHost, this.ctaHost);
        this.renderSelectedPlanDetail();
        this.renderCancelSection(data);
    }

    /** Only the two product plans, in slider order, whatever the backend catalog returns. */
    protected catalogPlans(data: QaapBillingApiResponse): BillingPlan[] {
        return BILLING_PLAN_IDS
            .map(id => data.catalog.plans.find(plan => plan.id === id))
            .filter((plan): plan is BillingPlan => plan !== undefined);
    }

    protected createPlanSlide(plan: BillingPlan, currentPlanId: string): HTMLElement {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'theia-mobile-work-hub-billing-plan-slide';
        card.dataset.planId = plan.id;
        card.setAttribute('role', 'option');
        card.setAttribute('aria-selected', plan.id === this.selectedPlanId ? 'true' : 'false');
        if (plan.id === this.selectedPlanId) {
            card.classList.add('theia-mod-selected');
        }
        if (plan.id === currentPlanId) {
            card.classList.add('theia-mod-current');
        }
        if (plan.id === 'pro') {
            card.classList.add('theia-mod-featured');
        }

        const top = document.createElement('div');
        top.className = 'theia-mobile-work-hub-billing-plan-slide-top';
        const name = document.createElement('span');
        name.className = 'theia-mobile-work-hub-billing-plan-name';
        name.textContent = planDisplayName(plan.id);
        const tag = document.createElement('span');
        tag.className = 'theia-mobile-work-hub-billing-plan-tagline';
        tag.textContent = planTagline(plan.id);
        top.append(name, tag);

        const priceRow = document.createElement('div');
        priceRow.className = 'theia-mobile-work-hub-billing-plan-price-row';
        const amount = document.createElement('span');
        amount.className = 'theia-mobile-work-hub-billing-plan-amount';
        amount.textContent = formatUsd(plan.priceUsdMonthly);
        const period = document.createElement('span');
        period.className = 'theia-mobile-work-hub-billing-plan-currency';
        period.textContent = nls.localize('qaap/billing/perMonth', '/ month');
        priceRow.append(amount, period);

        const preview = document.createElement('ul');
        preview.className = 'theia-mobile-work-hub-billing-plan-preview';
        for (const text of this.planHighlights(plan).slice(0, 3)) {
            const li = document.createElement('li');
            li.textContent = text;
            preview.append(li);
        }

        card.append(top, priceRow, preview);
        if (plan.id === currentPlanId) {
            const badge = document.createElement('span');
            badge.className = 'theia-mobile-work-hub-billing-plan-badge';
            badge.textContent = nls.localize('qaap/billing/currentBadge', 'Current');
            card.append(badge);
        }

        card.addEventListener('click', () => this.selectPlan(plan.id, true));
        return card;
    }

    /** The allowance rows shown for one plan: RAM, CPU, storage, repos, agents and idle pause. */
    protected planHighlights(plan: BillingPlan): string[] {
        const memory = plan.memoryOptionsGb.length > 1
            ? nls.localize(
                'qaap/billing/rowMemoryChoice',
                '{0} or {1} GB RAM per project',
                formatCount(plan.memoryOptionsGb[0]),
                formatCount(plan.memoryOptionsGb[plan.memoryOptionsGb.length - 1]),
            )
            : nls.localize('qaap/billing/rowMemory', '{0} GB RAM', formatCount(plan.defaultMemoryGb));
        const cpu = nls.localize('qaap/billing/rowCpu', '{0} vCPU', formatCount(plan.cpuLimit));
        const storage = nls.localize('qaap/billing/rowStorage', '{0} GB storage', formatCount(plan.storageGb));
        const repos = nls.localize('qaap/billing/rowRepos', 'Up to {0} active repos', formatCount(plan.maxActiveRepos));
        const agents = nls.localize('qaap/billing/rowAgents', '{0} parallel agents', formatCount(plan.maxConcurrentAgents));
        const idle = plan.idlePauseMinutes >= 60
            ? nls.localize('qaap/billing/rowIdleHours', 'Agents stay on up to {0} h idle', formatCount(plan.idlePauseMinutes / 60))
            : nls.localize('qaap/billing/rowIdleMinutes', 'Pauses after {0} min idle', formatCount(plan.idlePauseMinutes));
        return [memory, cpu, storage, repos, agents, idle];
    }

    protected selectPlan(planId: string, scrollIntoView: boolean): void {
        if (!this.data || !isBillingPlanId(planId)) {
            return;
        }
        this.selectedPlanId = planId;
        const slides = this.contentHost.querySelectorAll<HTMLElement>('.theia-mobile-work-hub-billing-plan-slide');
        for (const slide of slides) {
            const active = slide.dataset.planId === planId;
            slide.classList.toggle('theia-mod-selected', active);
            slide.setAttribute('aria-selected', active ? 'true' : 'false');
        }
        const dots = this.dotsHost?.querySelectorAll<HTMLElement>('.theia-mobile-work-hub-billing-plan-dot');
        dots?.forEach(dot => {
            dot.classList.toggle('theia-mod-active', dot.dataset.planId === planId);
        });
        this.renderSelectedPlanDetail();
        if (scrollIntoView) {
            this.scrollSelectedPlanIntoView(false);
        }
    }

    protected scrollSelectedPlanIntoView(instant: boolean): void {
        const slide = this.contentHost.querySelector<HTMLElement>(
            `.theia-mobile-work-hub-billing-plan-slide[data-plan-id="${CSS.escape(this.selectedPlanId)}"]`,
        );
        slide?.scrollIntoView({
            inline: 'center',
            block: 'nearest',
            behavior: instant ? 'auto' : 'smooth',
        });
    }

    protected syncDotsFromScroll(slider: HTMLElement): void {
        const slides = Array.from(slider.querySelectorAll<HTMLElement>('.theia-mobile-work-hub-billing-plan-slide'));
        if (!slides.length) {
            return;
        }
        const mid = slider.scrollLeft + slider.clientWidth / 2;
        let closest = slides[0];
        let best = Number.POSITIVE_INFINITY;
        for (const slide of slides) {
            const center = slide.offsetLeft + slide.offsetWidth / 2;
            const dist = Math.abs(center - mid);
            if (dist < best) {
                best = dist;
                closest = slide;
            }
        }
        const planId = closest.dataset.planId;
        if (planId && planId !== this.selectedPlanId) {
            this.selectPlan(planId, false);
        }
    }

    protected renderSelectedPlanDetail(): void {
        if (!this.data || !this.detailHost || !this.ctaHost) {
            return;
        }
        const plans = this.catalogPlans(this.data);
        const plan = plans.find(entry => entry.id === this.selectedPlanId) ?? plans[0];
        if (!plan) {
            return;
        }
        const isCurrent = plan.id === this.data.entitlements.planId;
        this.detailHost.replaceChildren();
        this.ctaHost.replaceChildren();

        const head = document.createElement('div');
        head.className = 'theia-mobile-work-hub-billing-detail-head';
        const title = document.createElement('h4');
        title.className = 'theia-mobile-work-hub-billing-detail-title';
        title.textContent = nls.localize(
            'qaap/billing/detailTitle',
            '{0} details',
            planDisplayName(plan.id),
        );
        const meta = document.createElement('p');
        meta.className = 'theia-mobile-work-hub-billing-detail-meta';
        meta.textContent = planTagline(plan.id);
        head.append(title, meta);

        const list = document.createElement('ul');
        list.className = 'theia-mobile-work-hub-billing-detail-list';
        for (const text of this.planHighlights(plan)) {
            const li = document.createElement('li');
            const icon = document.createElement('span');
            icon.className = 'codicon codicon-check';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.textContent = text;
            li.append(icon, label);
            list.append(li);
        }
        this.detailHost.append(head, list);

        this.ctaHost.append(this.createCta(plan, isCurrent));
    }

    protected createCta(plan: BillingPlan, isCurrent: boolean): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-work-hub-billing-cta';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-billing-cta-btn';
        const hint = document.createElement('p');
        hint.className = 'theia-mobile-work-hub-billing-cta-hint';

        if (isCurrent) {
            button.classList.add('theia-mod-current');
            button.disabled = true;
            button.textContent = nls.localize('qaap/billing/ctaCurrent', 'Your current plan');
            hint.textContent = nls.localize(
                'qaap/billing/ctaCurrentHint',
                'Included allowances reset each billing period.',
            );
            wrap.append(button, hint);
            return wrap;
        }

        const planId: BillingPlanId = plan.id === 'pro' ? 'pro' : 'starter';
        const checkoutEnabled = !!this.data?.checkout?.checkoutEnabled;
        const devEnabled = !!this.data?.checkout?.devActivateEnabled;
        button.classList.add('theia-mod-primary');
        button.textContent = nls.localize(
            'qaap/billing/ctaSubscribe',
            'Subscribe · {0} / month',
            formatUsd(plan.priceUsdMonthly),
        );
        button.addEventListener('click', () => {
            void this.handleSubscribe(planId, button);
        });
        if (checkoutEnabled) {
            hint.textContent = nls.localize(
                'qaap/billing/ctaCheckoutHint',
                'Secure monthly checkout powered by Airwallex. Cancel anytime from Billing.',
            );
        } else if (devEnabled) {
            hint.textContent = nls.localize(
                'qaap/billing/ctaDevHint',
                'Airwallex billing is not configured — local preview will activate this plan without payment.',
            );
        } else {
            hint.textContent = nls.localize(
                'qaap/billing/ctaCheckoutMissing',
                'Set AIRWALLEX_CLIENT_ID, AIRWALLEX_API_KEY, AIRWALLEX_PRICE_STARTER_MONTHLY and AIRWALLEX_PRICE_PRO_MONTHLY to enable checkout.',
            );
            button.disabled = true;
        }
        wrap.append(button, hint);
        return wrap;
    }

    /**
     * Cancel is offered only while the provider reports a live subscription. The first press asks for a
     * second press (an inline confirmation, not a blocking browser dialog).
     */
    protected renderCancelSection(data: QaapBillingApiResponse): void {
        if (!this.ctaHost) {
            return;
        }
        const status = data.account.subscriptionStatus;
        if (!data.account.subscriptionId || (status !== 'active' && status !== 'past_due')) {
            return;
        }
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-work-hub-billing-cancel';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-mobile-work-hub-billing-cancel-btn';
        button.textContent = nls.localize('qaap/billing/cancelSubscription', 'Cancel subscription');
        const hint = document.createElement('p');
        hint.className = 'theia-mobile-work-hub-billing-cta-hint';
        hint.textContent = nls.localize(
            'qaap/billing/cancelHint',
            'Your plan stays active until the end of the current billing period.',
        );
        let armed = false;
        button.addEventListener('click', () => {
            if (!armed) {
                armed = true;
                button.textContent = nls.localize('qaap/billing/cancelConfirm', 'Confirm cancellation');
                return;
            }
            void this.handleCancel(button);
        });
        wrap.append(button, hint);
        this.ctaHost.append(wrap);
    }

    protected async handleSubscribe(planId: BillingPlanId, button: HTMLButtonElement): Promise<void> {
        if (this.checkoutBusy || !this.data) {
            return;
        }
        this.checkoutBusy = true;
        this.ctaHost?.querySelector('.theia-mobile-work-hub-billing-cta-error')?.remove();
        const previous = button.textContent;
        button.disabled = true;
        button.textContent = nls.localize('qaap/billing/ctaRedirecting', 'Opening checkout…');
        try {
            if (this.data.checkout?.checkoutEnabled) {
                const { url } = await createQaapBillingCheckout(planId);
                window.location.assign(url);
                return;
            }
            if (this.data.checkout?.devActivateEnabled) {
                await this.runDevActivate(planId, button);
                return;
            }
            button.textContent = nls.localize('qaap/billing/ctaCheckoutMissingShort', 'Checkout not configured');
        } catch (error) {
            const err = error as Error & { code?: string; devActivateEnabled?: boolean };
            if (err.code === 'checkout_not_configured' && (err.devActivateEnabled || this.data.checkout?.devActivateEnabled)) {
                await this.runDevActivate(planId, button);
                return;
            }
            // The button only ever carries a short label; the (possibly long) server message goes to its own line.
            button.textContent = nls.localize('qaap/billing/ctaFailed', 'Checkout failed');
            this.showCheckoutError(QaapUserFacingErrors.toMessageAndLog(err));
        } finally {
            this.checkoutBusy = false;
            if (this.visible && button.isConnected && button.textContent !== previous) {
                window.setTimeout(() => {
                    if (button.isConnected && !this.checkoutBusy) {
                        button.disabled = false;
                        button.textContent = previous;
                    }
                }, 1800);
            }
        }
    }

    protected async handleCancel(button: HTMLButtonElement): Promise<void> {
        if (this.cancelBusy) {
            return;
        }
        this.cancelBusy = true;
        button.disabled = true;
        button.textContent = nls.localize('qaap/billing/cancelling', 'Cancelling…');
        this.ctaHost?.querySelector('.theia-mobile-work-hub-billing-cta-error')?.remove();
        try {
            const refreshed = await cancelQaapBillingSubscription();
            if (!this.visible) {
                return;
            }
            this.data = refreshed;
            this.selectedPlanId = isBillingPlanId(refreshed.entitlements.planId) ? refreshed.entitlements.planId : 'starter';
            rememberQaapAccountBillingPlanId(this.selectedPlanId);
            this.renderBilling(refreshed);
            requestAnimationFrame(() => this.scrollSelectedPlanIntoView(true));
        } catch (error) {
            button.disabled = false;
            button.textContent = nls.localize('qaap/billing/cancelSubscription', 'Cancel subscription');
            this.showCheckoutError(QaapUserFacingErrors.toMessageAndLog(error as Error));
        } finally {
            this.cancelBusy = false;
        }
    }

    protected showCheckoutError(message: string): void {
        if (!this.ctaHost) {
            return;
        }
        const line = document.createElement('p');
        line.className = 'theia-mobile-work-hub-billing-status theia-mobile-work-hub-billing-cta-error';
        line.setAttribute('role', 'alert');
        line.textContent = message;
        this.ctaHost.append(line);
    }

    protected async runDevActivate(
        planId: BillingPlanId,
        button: HTMLButtonElement,
    ): Promise<void> {
        button.textContent = nls.localize('qaap/billing/ctaActivating', 'Activating…');
        const refreshed = await activateQaapBillingPlanDev(planId);
        if (!refreshed || !this.visible) {
            return;
        }
        this.data = refreshed;
        this.selectedPlanId = isBillingPlanId(refreshed.entitlements.planId) ? refreshed.entitlements.planId : 'starter';
        this.renderBilling(refreshed);
        requestAnimationFrame(() => this.scrollSelectedPlanIntoView(true));
    }
}

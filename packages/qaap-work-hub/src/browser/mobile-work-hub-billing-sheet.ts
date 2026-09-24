// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import {
    activateQaapBillingPlanDev,
    createQaapBillingCheckout,
    fetchQaapBilling,
    type QaapBillingApiResponse,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { isWorkHubTheiaDialogOpen } from '../common/qaap-work-hub-dialog-utils';
import { rememberQaapAccountBillingPlanId } from './qaap-workbench-account-menu';

type BillingPlan = QaapBillingApiResponse['catalog']['plans'][number];

function planDisplayName(planId: string): string {
    switch (planId) {
        case 'pro':
            return nls.localize('qaap/billing/planPro', 'Pro');
        case 'team':
            return nls.localize('qaap/billing/planTeam', 'Team');
        default:
            return nls.localize('qaap/billing/planStarter', 'Starter');
    }
}

function planTagline(planId: string): string {
    switch (planId) {
        case 'pro':
            return nls.localize('qaap/billing/taglinePro', 'For daily agent work');
        case 'team':
            return nls.localize('qaap/billing/taglineTeam', 'For multi-agent teams');
        default:
            return nls.localize('qaap/billing/taglineStarter', 'Fair-use BYOK start');
    }
}

function formatHours(hours: number): string {
    if (hours < 0) {
        return nls.localize('qaap/billing/unlimited', 'Unlimited');
    }
    if (Number.isInteger(hours)) {
        return String(hours);
    }
    return hours.toFixed(1);
}

function formatCredits(credits: number): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(credits);
}

function isPayablePlan(planId: string): planId is 'pro' | 'team' {
    return planId === 'pro' || planId === 'team';
}

/** Work Hub overlay for plan picker, Stripe Checkout, and usage meters. */
export class MobileWorkHubBillingSheet {

    readonly node: HTMLElement;
    protected readonly contentHost: HTMLElement;
    protected readonly titleEl: HTMLElement;
    protected visible = false;
    protected loadToken = 0;
    protected data: QaapBillingApiResponse | undefined;
    protected selectedPlanId = 'starter';
    protected checkoutBusy = false;
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
        this.selectedPlanId = data.entitlements.planId || 'starter';
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
        const intro = document.createElement('section');
        intro.className = 'theia-mobile-work-hub-billing-intro';
        const eyebrow = document.createElement('p');
        eyebrow.className = 'theia-mobile-work-hub-billing-eyebrow';
        eyebrow.textContent = nls.localize('qaap/billing/eyebrow', 'Subscription');
        const headline = document.createElement('h3');
        headline.className = 'theia-mobile-work-hub-billing-headline';
        const currentName = planDisplayName(data.entitlements.planId);
        if (afterCheckout && data.entitlements.planId !== 'starter') {
            headline.textContent = nls.localize(
                'qaap/billing/headlineAfterCheckout',
                'You are on {0}',
                currentName,
            );
        } else {
            headline.textContent = nls.localize('qaap/billing/headline', 'Pick a plan that matches how you ship');
        }
        const sub = document.createElement('p');
        sub.className = 'theia-mobile-work-hub-billing-subhead';
        if (afterCheckout && data.entitlements.planId !== 'starter') {
            sub.textContent = nls.localize(
                'qaap/billing/subheadAfterCheckout',
                'Payment confirmed. This is your current plan — allowances reset each billing period.',
            );
        } else if (data.entitlements.planId !== 'starter') {
            sub.textContent = nls.localize(
                'qaap/billing/subheadCurrent',
                'Your current plan is {0}. Swipe to compare other plans.',
                currentName,
            );
        } else {
            sub.textContent = nls.localize(
                'qaap/billing/subhead',
                'Starter is selected by default. Swipe to compare Pro and Team, then subscribe monthly with Stripe.',
            );
        }
        intro.append(eyebrow, headline, sub);

        const sliderSection = document.createElement('section');
        sliderSection.className = 'theia-mobile-work-hub-billing-section theia-mobile-work-hub-billing-slider-section';
        const slider = document.createElement('div');
        slider.className = 'theia-mobile-work-hub-billing-plan-slider';
        slider.setAttribute('role', 'listbox');
        slider.setAttribute('aria-label', nls.localize('qaap/billing/allPlans', 'Plans'));
        for (const plan of data.catalog.plans) {
            slider.append(this.createPlanSlide(plan, data.entitlements.planId));
        }
        slider.addEventListener('scroll', () => this.syncDotsFromScroll(slider), { passive: true });
        this.dotsHost = document.createElement('div');
        this.dotsHost.className = 'theia-mobile-work-hub-billing-plan-dots';
        this.dotsHost.setAttribute('role', 'tablist');
        for (const plan of data.catalog.plans) {
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
        amount.textContent = `${plan.monthlyPriceEur}`;
        const currency = document.createElement('span');
        currency.className = 'theia-mobile-work-hub-billing-plan-currency';
        currency.textContent = nls.localize('qaap/billing/eurPerMonth', '€ / mo');
        priceRow.append(amount, currency);

        const preview = document.createElement('ul');
        preview.className = 'theia-mobile-work-hub-billing-plan-preview';
        for (const text of this.planHighlights(plan).slice(0, 3)) {
            const li = document.createElement('li');
            li.textContent = text;
            preview.append(li);
        }

        if (plan.id === currentPlanId) {
            const badge = document.createElement('span');
            badge.className = 'theia-mobile-work-hub-billing-plan-badge';
            badge.textContent = nls.localize('qaap/billing/currentBadge', 'Current');
            card.append(top, priceRow, preview, badge);
        } else if (plan.id === 'pro') {
            const badge = document.createElement('span');
            badge.className = 'theia-mobile-work-hub-billing-plan-badge theia-mod-popular';
            badge.textContent = nls.localize('qaap/billing/popularBadge', 'Popular');
            card.append(top, priceRow, preview, badge);
        } else {
            card.append(top, priceRow, preview);
        }

        card.addEventListener('click', () => this.selectPlan(plan.id, true));
        return card;
    }

    protected planHighlights(plan: BillingPlan): string[] {
        const runtime = plan.runtimeFairUse
            ? nls.localize('qaap/billing/planFairUseRuntime', 'Fair-use agent runtime')
            : nls.localize(
                'qaap/billing/planRuntimeHours',
                '{0} agent hours / month',
                formatHours(plan.includedRuntimeHoursPerMonth),
            );
        const credits = plan.hostedModels
            ? nls.localize(
                'qaap/billing/planCredits',
                '{0} Codex hosted credits / month',
                formatCredits(plan.includedCreditsPerMonth),
            )
            : nls.localize('qaap/billing/planByok', 'BYOK models (your API keys)');
        const storage = nls.localize(
            'qaap/billing/planStorage',
            '{0} GB storage · {1} concurrent agents',
            String(plan.storageGb),
            plan.maxConcurrentAgents < 0 ? '∞' : String(plan.maxConcurrentAgents),
        );
        return [runtime, credits, storage];
    }

    protected selectPlan(planId: string, scrollIntoView: boolean): void {
        if (!this.data) {
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
        const plan = this.data.catalog.plans.find(entry => entry.id === this.selectedPlanId)
            ?? this.data.catalog.plans[0];
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

        if (isCurrent) {
            const meters = document.createElement('div');
            meters.className = 'theia-mobile-work-hub-billing-meters';
            const { entitlements } = this.data;
            meters.append(
                this.createMeter(
                    nls.localize('qaap/billing/agentRuntime', 'Agent runtime'),
                    entitlements.runtimeFairUse
                        ? nls.localize('qaap/billing/fairUse', 'Fair use — no hard stop')
                        : nls.localize(
                            'qaap/billing/runtimeRemaining',
                            '{0} h remaining this period',
                            formatHours(entitlements.runtimeHoursRemaining),
                        ),
                    entitlements.runtimeFairUse ? undefined : entitlements.runtimeUsageRatio,
                    entitlements.runtimeWarning,
                ),
                this.createMeter(
                    nls.localize('qaap/billing/hostedCredits', 'Codex hosted credits'),
                    entitlements.hostedModels
                        ? nls.localize(
                            'qaap/billing/creditsRemaining',
                            '{0} credits remaining',
                            formatCredits(entitlements.creditsRemaining),
                        )
                        : nls.localize('qaap/billing/byokOnly', 'BYOK — bring your own keys'),
                    entitlements.hostedModels && entitlements.includedCreditsPerMonth > 0
                        ? Math.min(1, 1 - (entitlements.creditsRemaining / entitlements.includedCreditsPerMonth))
                        : undefined,
                    false,
                ),
            );
            this.detailHost.append(meters);
            if (!entitlements.canStartAgent) {
                const warn = document.createElement('p');
                warn.className = 'theia-mobile-work-hub-billing-warning';
                warn.textContent = nls.localize(
                    'qaap/billing/runtimeExhausted',
                    'Agent runtime is exhausted. New jobs are blocked until the period resets or you add hours.',
                );
                this.detailHost.append(warn);
            } else if (entitlements.runtimeWarning) {
                const warn = document.createElement('p');
                warn.className = 'theia-mobile-work-hub-billing-warning';
                warn.textContent = nls.localize(
                    'qaap/billing/runtimeWarning',
                    'You have used most of your included agent runtime this period.',
                );
                this.detailHost.append(warn);
            }
        }

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

        if (plan.id === 'starter') {
            button.textContent = nls.localize('qaap/billing/ctaStayStarter', 'Stay on Starter');
            button.addEventListener('click', () => {
                void this.handleStayOrDevActivate('starter', button);
            });
            hint.textContent = nls.localize(
                'qaap/billing/ctaStarterHint',
                'No card required. Bring your own API keys.',
            );
            wrap.append(button, hint);
            return wrap;
        }

        if (!isPayablePlan(plan.id)) {
            button.disabled = true;
            button.textContent = planDisplayName(plan.id);
            wrap.append(button);
            return wrap;
        }

        const payablePlanId = plan.id;
        const stripeEnabled = !!this.data?.checkout?.stripeEnabled;
        const devEnabled = !!this.data?.checkout?.devActivateEnabled;
        button.classList.add('theia-mod-primary');
        button.textContent = nls.localize(
            'qaap/billing/ctaSubscribe',
            'Subscribe · {0} € / month',
            String(plan.monthlyPriceEur),
        );
        button.addEventListener('click', () => {
            void this.handleSubscribe(payablePlanId, button);
        });
        if (stripeEnabled) {
            hint.textContent = nls.localize(
                'qaap/billing/ctaStripeHint',
                'Secure monthly checkout powered by Stripe. Cancel anytime from Stripe.',
            );
        } else if (devEnabled) {
            hint.textContent = nls.localize(
                'qaap/billing/ctaDevHint',
                'Stripe keys are not set — local preview will activate this plan without payment.',
            );
        } else {
            hint.textContent = nls.localize(
                'qaap/billing/ctaStripeMissing',
                'Set STRIPE_SECRET_KEY and STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_TEAM_MONTHLY to enable checkout.',
            );
            button.disabled = true;
        }
        wrap.append(button, hint);
        return wrap;
    }

    protected async handleStayOrDevActivate(planId: 'starter', button: HTMLButtonElement): Promise<void> {
        if (!this.data?.checkout?.devActivateEnabled || this.data.entitlements.planId === 'starter') {
            this.selectPlan('starter', true);
            return;
        }
        await this.runDevActivate(planId, button);
    }

    protected async handleSubscribe(planId: 'pro' | 'team', button: HTMLButtonElement): Promise<void> {
        if (this.checkoutBusy || !this.data) {
            return;
        }
        this.checkoutBusy = true;
        const previous = button.textContent;
        button.disabled = true;
        button.textContent = nls.localize('qaap/billing/ctaRedirecting', 'Opening Stripe…');
        try {
            if (this.data.checkout?.stripeEnabled) {
                const { url } = await createQaapBillingCheckout(planId);
                window.location.assign(url);
                return;
            }
            if (this.data.checkout?.devActivateEnabled) {
                await this.runDevActivate(planId, button);
                return;
            }
            button.textContent = nls.localize('qaap/billing/ctaStripeMissingShort', 'Stripe not configured');
        } catch (error) {
            const err = error as Error & { code?: string; devActivateEnabled?: boolean };
            if (err.code === 'stripe_not_configured' && (err.devActivateEnabled || this.data.checkout?.devActivateEnabled)) {
                await this.runDevActivate(planId, button);
                return;
            }
            button.textContent = err.message || nls.localize('qaap/billing/ctaFailed', 'Checkout failed');
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

    protected async runDevActivate(
        planId: 'starter' | 'pro' | 'team',
        button: HTMLButtonElement,
    ): Promise<void> {
        button.textContent = nls.localize('qaap/billing/ctaActivating', 'Activating…');
        const refreshed = await activateQaapBillingPlanDev(planId);
        if (!refreshed || !this.visible) {
            return;
        }
        this.data = refreshed;
        this.selectedPlanId = refreshed.entitlements.planId;
        this.renderBilling(refreshed);
        requestAnimationFrame(() => this.scrollSelectedPlanIntoView(true));
    }

    protected createMeter(
        label: string,
        value: string,
        usageRatio: number | undefined,
        warning: boolean,
    ): HTMLElement {
        const meter = document.createElement('div');
        meter.className = 'theia-mobile-work-hub-billing-meter';
        if (warning) {
            meter.classList.add('theia-mod-warning');
        }
        const labelEl = document.createElement('div');
        labelEl.className = 'theia-mobile-work-hub-billing-meter-label';
        labelEl.textContent = label;
        const valueEl = document.createElement('div');
        valueEl.className = 'theia-mobile-work-hub-billing-meter-value';
        valueEl.textContent = value;
        meter.append(labelEl, valueEl);
        if (usageRatio !== undefined) {
            const track = document.createElement('div');
            track.className = 'theia-mobile-work-hub-billing-meter-track';
            track.setAttribute('role', 'progressbar');
            track.setAttribute('aria-valuemin', '0');
            track.setAttribute('aria-valuemax', '100');
            const percent = Math.round(Math.max(0, Math.min(1, usageRatio)) * 100);
            track.setAttribute('aria-valuenow', String(percent));
            const fill = document.createElement('div');
            fill.className = 'theia-mobile-work-hub-billing-meter-fill';
            fill.style.width = `${percent}%`;
            track.append(fill);
            meter.append(track);
        }
        return meter;
    }
}

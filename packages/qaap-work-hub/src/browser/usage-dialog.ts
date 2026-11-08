// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { QaapUserFacingErrors } from '@theia/qaap-adapters/lib/common/qaap-user-facing-error';
import type {
    QaapUsageLimits,
    QaapUsageProviderId,
    QaapUsageRange,
    QaapUsageSummary
} from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';
import { UsageClient } from './usage-client';
import { USAGE_RANGE_OPTIONS, UsageDialogBody } from './usage-dialog-body';

/** Tabs of the dialog: the two summary measures and the rate limits. */
export type UsageDialogTab = 'cost' | 'tokens' | 'limits';

/** Delay between polls while the server's first log scan is still running. */
const SCAN_RETRY_MS = 1500;
const MAX_SCAN_RETRIES = 40;
/** Limits are re-rendered this often so the reset countdowns stay current. */
const LIMITS_TICK_MS = 30000;

const PROVIDER_CHOICES: ReadonlyArray<{ value: QaapUsageProviderId; label: string }> = [
    { value: 'claude', label: 'Claude' },
    { value: 'codex', label: 'Codex' },
    { value: 'opencode', label: 'OpenCode' },
    { value: 'pi', label: 'Pi' },
    { value: 'grok', label: 'Grok' },
    { value: 'copilot', label: 'Copilot' }
];

/**
 * Usage dialog: a centered modal on desktop and a full-screen sheet on narrow viewports.
 * It owns the state (range, provider filter, tab, fetched data) and the request lifecycle.
 * The DOM for the summary and limits lives in `UsageDialogBody`.
 */
export class UsageDialog {

    protected readonly client = new UsageClient();
    protected readonly body = new UsageDialogBody();

    protected backdrop: HTMLElement | undefined;
    protected dialogElement: HTMLElement | undefined;
    protected providerSelect: HTMLSelectElement | undefined;
    protected rangeGroup: HTMLElement | undefined;
    protected tabGroup: HTMLElement | undefined;
    protected refreshButton: HTMLButtonElement | undefined;
    protected bodyElement: HTMLElement | undefined;

    protected range: QaapUsageRange = '7d';
    protected tab: UsageDialogTab = 'cost';
    protected provider: QaapUsageProviderId | undefined;
    protected summary: QaapUsageSummary | undefined;
    protected limits: QaapUsageLimits | undefined;
    protected errorMessage: string | undefined;
    protected summaryLoading = false;
    protected limitsLoading = false;
    protected summaryRequest = 0;
    protected limitsRequest = 0;
    protected scanRetries = 0;
    protected visible = false;
    protected scanTimer: number | undefined;
    protected limitsTimer: number | undefined;
    /** Element focused before the dialog opened, restored on close. */
    protected previousFocus: HTMLElement | undefined;

    protected readonly onDocumentKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.close();
        }
    };

    isOpen(): boolean {
        return this.visible;
    }

    /** Opens the dialog on the Cost tab, loading the summary (and limits when that tab is active). */
    open(): void {
        this.ensureDom();
        if (this.visible) {
            return;
        }
        this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        this.visible = true;
        this.scanRetries = 0;
        this.backdrop!.hidden = false;
        document.addEventListener('keydown', this.onDocumentKeyDown, true);
        this.render();
        this.dialogElement?.focus();
        void this.refreshSummary();
        if (this.tab === 'limits') {
            void this.refreshLimits();
        }
    }

    close(): void {
        if (!this.visible) {
            return;
        }
        this.visible = false;
        this.summaryRequest++;
        this.limitsRequest++;
        this.clearScanTimer();
        this.clearLimitsTimer();
        document.removeEventListener('keydown', this.onDocumentKeyDown, true);
        if (this.backdrop) {
            this.backdrop.hidden = true;
        }
        const focus = this.previousFocus;
        this.previousFocus = undefined;
        focus?.focus?.();
    }

    /** Selects a tab; the summary tabs share one fetch, the limits tab fetches its own data. */
    selectTab(tab: UsageDialogTab): void {
        this.tab = tab;
        if (tab === 'limits') {
            if (!this.limits) {
                void this.refreshLimits();
            }
            this.startLimitsTimer();
        } else {
            this.clearLimitsTimer();
            if (!this.summary) {
                void this.refreshSummary();
            }
        }
        this.render();
    }

    selectRange(range: QaapUsageRange): void {
        if (range === this.range) {
            return;
        }
        this.range = range;
        this.summary = undefined;
        this.scanRetries = 0;
        this.render();
        void this.refreshSummary();
    }

    selectProvider(provider: QaapUsageProviderId | undefined): void {
        if (provider === this.provider) {
            return;
        }
        this.provider = provider;
        this.summary = undefined;
        this.scanRetries = 0;
        this.render();
        void this.refreshSummary();
    }

    /** Refetches whatever the active tab shows. */
    refresh(): void {
        this.scanRetries = 0;
        if (this.tab === 'limits') {
            void this.refreshLimits();
        } else {
            void this.refreshSummary();
        }
    }

    protected async refreshSummary(): Promise<void> {
        const request = ++this.summaryRequest;
        this.clearScanTimer();
        this.summaryLoading = true;
        this.render();
        try {
            const summary = await this.client.fetchSummary(this.range, this.provider, this.client.browserTimezone());
            if (request !== this.summaryRequest || !this.visible) {
                return;
            }
            this.summary = summary;
            this.errorMessage = undefined;
            if (summary.scanning && this.scanRetries < MAX_SCAN_RETRIES) {
                this.scanRetries++;
                this.scanTimer = window.setTimeout(() => void this.refreshSummary(), SCAN_RETRY_MS);
            }
        } catch (error) {
            if (request === this.summaryRequest && this.visible) {
                this.errorMessage = QaapUserFacingErrors.toMessage(error, nls.localize('qaap/usage/loadFailed', 'Could not load usage data.'));
            }
        } finally {
            if (request === this.summaryRequest) {
                this.summaryLoading = false;
                this.render();
            }
        }
    }

    protected async refreshLimits(): Promise<void> {
        const request = ++this.limitsRequest;
        this.limitsLoading = true;
        this.render();
        try {
            const limits = await this.client.fetchLimits();
            if (request === this.limitsRequest && this.visible) {
                this.limits = limits;
                this.errorMessage = undefined;
            }
        } catch (error) {
            if (request === this.limitsRequest && this.visible) {
                this.errorMessage = QaapUserFacingErrors.toMessage(error, nls.localize('qaap/usage/loadFailed', 'Could not load usage data.'));
            }
        } finally {
            if (request === this.limitsRequest) {
                this.limitsLoading = false;
                this.render();
            }
        }
    }

    protected ensureDom(): void {
        if (this.backdrop) {
            return;
        }
        const backdrop = document.createElement('div');
        backdrop.className = 'theia-qaap-usage-backdrop';
        backdrop.hidden = true;
        backdrop.addEventListener('pointerdown', event => {
            if (event.target === backdrop) {
                this.close();
            }
        });

        const dialog = document.createElement('div');
        dialog.className = 'theia-qaap-usage-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.tabIndex = -1;

        const header = document.createElement('header');
        header.className = 'theia-qaap-usage-header';
        const title = document.createElement('h2');
        title.className = 'theia-qaap-usage-title';
        title.id = 'theia-qaap-usage-title';
        title.textContent = nls.localize('qaap/usage/title', 'Usage');
        dialog.setAttribute('aria-labelledby', title.id);

        const providerSelect = document.createElement('select');
        providerSelect.className = 'theia-qaap-usage-provider-select';
        providerSelect.setAttribute('aria-label', nls.localize('qaap/usage/providerFilter', 'Provider'));
        providerSelect.append(new Option(nls.localize('qaap/usage/allProviders', 'All providers'), ''));
        for (const choice of PROVIDER_CHOICES) {
            providerSelect.append(new Option(choice.label, choice.value));
        }
        providerSelect.addEventListener('change', () => {
            const value = providerSelect.value as QaapUsageProviderId | '';
            this.selectProvider(value || undefined);
        });

        const refreshButton = this.iconButton('codicon-refresh', nls.localize('qaap/usage/refresh', 'Refresh'));
        refreshButton.addEventListener('click', () => this.refresh());
        const closeButton = this.iconButton('codicon-close', nls.localize('qaap/usage/close', 'Close'));
        closeButton.addEventListener('click', () => this.close());

        const rangeGroup = this.segmentGroup(nls.localize('qaap/usage/rangeLabel', 'Time range'));
        for (const option of USAGE_RANGE_OPTIONS) {
            rangeGroup.append(this.segmentButton(option.label(), () => this.selectRange(option.value), option.value));
        }
        const tabGroup = this.segmentGroup(nls.localize('qaap/usage/measureLabel', 'Measure'));
        const tabs: Array<{ id: UsageDialogTab; label: string }> = [
            { id: 'cost', label: nls.localize('qaap/usage/tabCost', 'Cost') },
            { id: 'tokens', label: nls.localize('qaap/usage/tabTokens', 'Tokens') },
            { id: 'limits', label: nls.localize('qaap/usage/tabLimits', 'Limits') }
        ];
        for (const tab of tabs) {
            tabGroup.append(this.segmentButton(tab.label, () => this.selectTab(tab.id), tab.id));
        }

        const controls = document.createElement('div');
        controls.className = 'theia-qaap-usage-controls';
        controls.append(rangeGroup, tabGroup);
        const headRow = document.createElement('div');
        headRow.className = 'theia-qaap-usage-head-row';
        headRow.append(title, providerSelect, refreshButton, closeButton);
        header.append(headRow, controls);

        const bodyElement = document.createElement('div');
        bodyElement.className = 'theia-qaap-usage-body';

        dialog.append(header, bodyElement);
        backdrop.append(dialog);
        document.body.append(backdrop);

        this.backdrop = backdrop;
        this.dialogElement = dialog;
        this.providerSelect = providerSelect;
        this.rangeGroup = rangeGroup;
        this.tabGroup = tabGroup;
        this.refreshButton = refreshButton;
        this.bodyElement = bodyElement;
    }

    protected render(): void {
        if (!this.backdrop || !this.bodyElement) {
            return;
        }
        const limitsTab = this.tab === 'limits';
        this.rangeGroup!.hidden = limitsTab;
        this.providerSelect!.hidden = limitsTab;
        this.providerSelect!.value = this.provider ?? '';
        this.setPressed(this.rangeGroup!, this.range);
        this.setPressed(this.tabGroup!, this.tab);
        this.refreshButton!.disabled = this.summaryLoading || this.limitsLoading;

        const content = document.createElement('div');
        content.className = 'theia-qaap-usage-content';
        if (this.errorMessage) {
            const error = document.createElement('p');
            error.className = 'theia-qaap-usage-error';
            error.setAttribute('role', 'alert');
            error.textContent = this.errorMessage;
            content.append(error);
        }
        const timezone = this.client.browserTimezone();
        if (limitsTab) {
            if (this.limits) {
                content.append(this.body.renderLimits(this.limits, Date.now()));
            } else if (!this.errorMessage) {
                content.append(this.loadingBlock());
            }
        } else if (this.summary) {
            const measure = this.tab === 'tokens' ? 'tokens' : 'cost';
            content.append(this.body.renderSummary(this.summary, measure, timezone));
        } else if (!this.errorMessage) {
            content.append(this.loadingBlock());
        }
        this.bodyElement.replaceChildren(content);
    }

    protected loadingBlock(): HTMLElement {
        const block = document.createElement('div');
        block.className = 'theia-qaap-usage-loading';
        block.textContent = nls.localize('qaap/usage/loading', 'Loading usage…');
        const skeleton = document.createElement('div');
        skeleton.className = 'theia-qaap-usage-skeleton';
        block.append(skeleton);
        return block;
    }

    protected startLimitsTimer(): void {
        this.clearLimitsTimer();
        this.limitsTimer = window.setInterval(() => {
            if (this.visible && this.tab === 'limits') {
                this.render();
            }
        }, LIMITS_TICK_MS);
    }

    protected clearLimitsTimer(): void {
        if (this.limitsTimer !== undefined) {
            window.clearInterval(this.limitsTimer);
            this.limitsTimer = undefined;
        }
    }

    protected clearScanTimer(): void {
        if (this.scanTimer !== undefined) {
            window.clearTimeout(this.scanTimer);
            this.scanTimer = undefined;
        }
    }

    protected setPressed(group: HTMLElement, value: string): void {
        for (const button of Array.from(group.querySelectorAll<HTMLButtonElement>('button'))) {
            const pressed = button.dataset.value === value;
            button.setAttribute('aria-pressed', String(pressed));
            button.classList.toggle('theia-qaap-usage-segment-active', pressed);
        }
    }

    protected segmentGroup(label: string): HTMLElement {
        const group = document.createElement('div');
        group.className = 'theia-qaap-usage-segmented';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', label);
        return group;
    }

    protected segmentButton(label: string, onClick: () => void, value: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'theia-qaap-usage-segment';
        button.dataset.value = value;
        button.textContent = label;
        button.addEventListener('click', onClick);
        return button;
    }

    protected iconButton(icon: string, label: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `theia-qaap-usage-icon-button codicon ${icon}`;
        button.title = label;
        button.setAttribute('aria-label', label);
        return button;
    }
}

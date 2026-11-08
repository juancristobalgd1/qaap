// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { UsageDialog } from './usage-dialog';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import type { QaapUsageLimits, QaapUsageSummary } from '@theia/qaap-shared-core/lib/common/qaap-usage-summary-protocol';

disableImportJSDOM();

/** Synthetic fixture: no real usage data. */
const breakdown = { input: 100, cachedInput: 50, cacheWrite: 10, output: 20, reasoning: 5 };

function summaryFixture(overrides: Partial<QaapUsageSummary> = {}): QaapUsageSummary {
    return {
        range: '7d',
        timezone: 'UTC',
        generatedAt: '2026-11-08T10:00:00.000Z',
        totals: { sessions: 3, tokens: 9_380_000_000, costUsd: 1.48, cacheSavingsUsd: 0.2, breakdown },
        providers: [
            { provider: 'claude', sessions: 2, tokens: 9_000_000_000, costUsd: 1.2, unpricedTokens: 0, breakdown },
            { provider: 'codex', sessions: 1, tokens: 380_000_000, costUsd: 0.28, unpricedTokens: 0, breakdown }
        ],
        buckets: [
            { start: '2026-11-06T00:00:00.000Z', perProvider: { claude: { tokens: 1000, costUsd: 0.1 }, codex: { tokens: 200, costUsd: 0.02 } } },
            { start: '2026-11-07T00:00:00.000Z', perProvider: { claude: { tokens: 0, costUsd: 0 } } },
            { start: '2026-11-08T00:00:00.000Z', perProvider: { claude: { tokens: 3000, costUsd: 0.4 }, codex: { tokens: 50, costUsd: 0.01 } } }
        ],
        skippedRecords: 0,
        scanning: false,
        ...overrides
    };
}

function limitsFixture(): QaapUsageLimits {
    const resetsAt = new Date(Date.now() + (2 * 24 + 3) * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString();
    return {
        providers: [
            { provider: 'codex', status: 'ok', windows: [{ id: 'primary', label: 'Session', usedPercent: 30, resetsAt }] },
            { provider: 'claude', status: 'unavailable', reason: 'Sign in to Claude Code on this machine', windows: [] }
        ]
    };
}

describe('UsageDialog', () => {

    useSuiteJSDOM();

    let dialog: UsageDialog;

    /** Replaces the network client with fixtures; the dialog only ever sees synthetic data. */
    function stubClient(summary: () => Promise<QaapUsageSummary>, limits: () => Promise<QaapUsageLimits> = async () => limitsFixture()): void {
        const client = dialog['client'];
        client.fetchSummary = summary;
        client.fetchLimits = limits;
    }

    function settle(): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, 10));
    }

    function bodyOf(): HTMLElement {
        return document.querySelector('.theia-qaap-usage-body') as HTMLElement;
    }

    beforeEach(() => {
        dialog = new UsageDialog();
    });

    afterEach(() => {
        dialog.close();
        document.querySelectorAll('.theia-qaap-usage-backdrop').forEach(node => node.remove());
    });

    it('renders provider rows, the total and one area per provider on the cost tab', async () => {
        stubClient(async () => summaryFixture());
        dialog.open();
        await settle();
        const body = bodyOf();
        expect(body.querySelector('.theia-qaap-usage-total')?.textContent).to.equal('$1.48');
        expect(body.querySelectorAll('.theia-qaap-usage-provider-row')).to.have.length(2);
        const areas = body.querySelectorAll<SVGPathElement>('.theia-qaap-usage-area');
        expect(areas).to.have.length(2);
        expect(areas[0].getAttribute('d')?.startsWith('M')).to.equal(true);
    });

    it('switches the headline to abbreviated tokens on the tokens tab', async () => {
        stubClient(async () => summaryFixture());
        dialog.open();
        await settle();
        dialog.selectTab('tokens');
        expect(bodyOf().querySelector('.theia-qaap-usage-total')?.textContent).to.equal('9.38B');
    });

    it('shows the skipped-record notice for inconsistent usage', async () => {
        stubClient(async () => summaryFixture({ skippedRecords: 2 }));
        dialog.open();
        await settle();
        expect(bodyOf().querySelector('.theia-qaap-usage-notice')?.textContent)
            .to.equal('2 malformed or inconsistent usage record(s) were skipped; usage may be incomplete.');
    });

    it('shows the scanning text while the first scan runs', async () => {
        stubClient(async () => summaryFixture({ scanning: true }));
        dialog.open();
        await settle();
        expect(bodyOf().querySelector('.theia-qaap-usage-scanning-text')?.textContent).to.equal('Scanning local agent logs…');
        dialog.close();
    });

    it('renders limit cards with the reset countdown and the unavailable reason', async () => {
        stubClient(async () => summaryFixture());
        dialog.open();
        dialog.selectTab('limits');
        await settle();
        const cards = bodyOf().querySelectorAll('.theia-qaap-usage-limit-card');
        expect(cards).to.have.length(2);
        expect(cards[0].querySelector('.theia-qaap-usage-limit-left')?.textContent).to.equal('70% left');
        expect(cards[0].querySelector('.theia-qaap-usage-limit-reset')?.textContent).to.equal('↻ 2d 3h');
        expect(cards[1].querySelector('.theia-qaap-usage-limit-reason')?.textContent).to.equal('Sign in to Claude Code on this machine');
    });

    it('shows an error message when the summary request fails', async () => {
        stubClient(async () => { throw new Error('Synthetic failure'); });
        dialog.open();
        await settle();
        expect(bodyOf().querySelector('.theia-qaap-usage-error')).to.not.equal(null);
    });

    it('closes on Escape and hides the backdrop', async () => {
        stubClient(async () => summaryFixture());
        dialog.open();
        await settle();
        expect(dialog.isOpen()).to.equal(true);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(dialog.isOpen()).to.equal(false);
        const backdrop = document.querySelector('.theia-qaap-usage-backdrop') as HTMLElement;
        expect(backdrop.hidden).to.equal(true);
    });
});

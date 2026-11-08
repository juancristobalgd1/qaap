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
        expect(body.querySelector('.theia-qaap-usage-total-sub')?.textContent).to.contain('3 sessions · API estimate');
        expect(body.querySelector('.theia-qaap-usage-provider-sub')?.textContent).to.equal('2 sessions');
        const areas = body.querySelectorAll<SVGPathElement>('.theia-qaap-usage-area');
        expect(areas).to.have.length(2);
        expect(areas[0].getAttribute('d')?.startsWith('M')).to.equal(true);
    });

    it('uses the singular session label for one session', async () => {
        stubClient(async () => summaryFixture({
            totals: { sessions: 1, tokens: 1, costUsd: 0.1, cacheSavingsUsd: 0, breakdown },
            providers: [{ provider: 'codex', sessions: 1, tokens: 1, costUsd: 0.1, unpricedTokens: 0, breakdown }]
        }));
        dialog.open();
        await settle();
        expect(bodyOf().querySelector('.theia-qaap-usage-provider-sub')?.textContent).to.equal('1 session');
        expect(bodyOf().querySelector('.theia-qaap-usage-total-sub')?.textContent).to.contain('1 session · API estimate');
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

    describe('provider filter menu', () => {

        const KEY = 'qaap.usage.providers';
        let requested: string[][];

        beforeEach(() => {
            window.sessionStorage.removeItem(KEY);
            requested = [];
            dialog = new UsageDialog();
            stubClient(async () => summaryFixture());
            dialog['client'].fetchSummary = async (_range, providers) => {
                requested.push([...providers]);
                return summaryFixture();
            };
        });

        afterEach(() => {
            window.sessionStorage.removeItem(KEY);
        });

        function menuRow(label: string): HTMLButtonElement {
            const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('.theia-qaap-usage-provider-option'));
            const row = rows.find(candidate => candidate.textContent === label);
            if (!row) {
                throw new Error(`no menu row ${label}`);
            }
            return row;
        }

        function buttonLabel(): string | null | undefined {
            return document.querySelector('.theia-qaap-usage-provider-button-label')?.textContent;
        }

        it('toggles providers from the menu, keeps it open, and labels the button', async () => {
            dialog.open();
            await settle();
            expect(buttonLabel()).to.equal('All providers');
            (document.querySelector('.theia-qaap-usage-provider-button') as HTMLButtonElement).click();
            const menu = document.querySelector('.theia-qaap-usage-provider-menu') as HTMLElement;
            expect(menu.hidden).to.equal(false);
            expect(document.querySelectorAll('.theia-qaap-usage-provider-option')).to.have.length(7);

            menuRow('Claude').click();
            await settle();
            expect(buttonLabel()).to.equal('Claude');
            expect(menu.hidden).to.equal(false);
            menuRow('Codex').click();
            await settle();
            expect(buttonLabel()).to.equal('2 providers');
            expect(requested[requested.length - 1]).to.deep.equal(['claude', 'codex']);
            expect(menuRow('Codex').getAttribute('aria-checked')).to.equal('true');

            menuRow('All providers').click();
            await settle();
            expect(buttonLabel()).to.equal('All providers');
            expect(requested[requested.length - 1]).to.deep.equal([]);
        });

        it('unchecking the last provider returns to all providers', async () => {
            dialog.open();
            await settle();
            (document.querySelector('.theia-qaap-usage-provider-button') as HTMLButtonElement).click();
            menuRow('Pi').click();
            await settle();
            expect(buttonLabel()).to.equal('Pi');
            menuRow('Pi').click();
            await settle();
            expect(buttonLabel()).to.equal('All providers');
        });

        it('Escape closes only the menu, a second Escape closes the dialog', async () => {
            dialog.open();
            await settle();
            (document.querySelector('.theia-qaap-usage-provider-button') as HTMLButtonElement).click();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect((document.querySelector('.theia-qaap-usage-provider-menu') as HTMLElement).hidden).to.equal(true);
            expect(dialog.isOpen()).to.equal(true);
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(dialog.isOpen()).to.equal(false);
        });

        it('restores the selection from sessionStorage and ignores unknown ids', () => {
            window.sessionStorage.setItem(KEY, JSON.stringify(['pi', 'vscode', 'claude']));
            const restored = new UsageDialog();
            expect(restored['providers']).to.deep.equal(['claude', 'pi']);
        });

        it('falls back to all providers when storage holds invalid data', () => {
            window.sessionStorage.setItem(KEY, '{not json');
            expect(new UsageDialog()['providers']).to.deep.equal([]);
        });
    });
});

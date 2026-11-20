// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_USAGE_MODEL_PRICES } from './qaap-usage-model-prices-data';
import { QaapUsagePriceList } from './qaap-usage-prices';

describe('QaapUsagePriceList', () => {

    const table = QaapUsagePriceList.fromJson({
        'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        'plain-model': { input: 2, output: 4 },
        'broken-model': { input: 'free', output: 1 },
    });

    it('normalizes provider prefixes, free suffixes and release dates', () => {
        expect(QaapUsagePriceList.normalizeModelId('anthropic/Claude-Sonnet-4-5-20250929')).to.equal('claude-sonnet-4-5');
        expect(QaapUsagePriceList.normalizeModelId('kimi-k2.5-free')).to.equal('kimi-k2.5');
        expect(QaapUsagePriceList.normalizeModelId('openrouter/glm-4.7:free')).to.equal('glm-4.7');
        expect(table.lookup('anthropic/claude-sonnet-4-5-20250929')).to.deep.equal({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
    });

    it('drops entries without numeric input and output rates', () => {
        expect(table.lookup('broken-model')).to.be.undefined;
        expect(table.lookup('unknown-model')).to.be.undefined;
    });

    it('prices each token class and reports cache savings against the input rate', () => {
        const cost = table.costOf('claude-sonnet-4-5', { input: 1_000_000, cachedInput: 2_000_000, cacheWrite: 0, output: 500_000, reasoning: 0 });
        // 1M input at $3, 2M cache reads at $0.30, 0.5M output at $15.
        expect(cost?.costUsd).to.be.closeTo(3 + 0.6 + 7.5, 1e-9);
        // 2M cached tokens would have cost $6 at the input rate, so $5.40 was saved.
        expect(cost?.cacheSavingsUsd).to.be.closeTo(5.4, 1e-9);
    });

    it('falls back to the input rate when cache rates are missing', () => {
        const cost = table.costOf('plain-model', { input: 0, cachedInput: 1_000_000, cacheWrite: 1_000_000, output: 0, reasoning: 0 });
        expect(cost?.costUsd).to.be.closeTo(4, 1e-9);
        expect(cost?.cacheSavingsUsd).to.equal(0);
    });

    it('returns undefined for unpriced models', () => {
        expect(table.costOf('mystery', { input: 1, cachedInput: 0, cacheWrite: 0, output: 1, reasoning: 0 })).to.be.undefined;
    });

    it('loads the compiled-in catalogue with entries for the common CLI models', () => {
        const bundled = QaapUsagePriceList.loadBundled();
        expect(Object.keys(QAAP_USAGE_MODEL_PRICES).length).to.be.greaterThan(100);
        expect(bundled.lookup('claude-sonnet-4-5-20250929')?.input).to.equal(3);
        expect(bundled.lookup('gpt-5-codex')?.output).to.be.a('number');
    });

    it('prices a bundled Claude model to a non-zero cost', () => {
        const cost = QaapUsagePriceList.loadBundled().costOf('claude-sonnet-4-5', { input: 1_000_000, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 });
        expect(cost?.costUsd).to.equal(3);
    });

    it('prices Claude Fable 5.2 at its published first-party rates', () => {
        const bundled = QaapUsagePriceList.loadBundled();
        const fable = bundled.lookup('claude-fable-5-2');
        expect(fable).to.deep.include({ input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 });
        expect(bundled.lookup('claude-mythos-5-2')?.input).to.equal(8);
        const cost = bundled.costOf('claude-fable-5-2', { input: 1_000_000, cachedInput: 0, cacheWrite: 0, output: 1_000_000, reasoning: 0 });
        expect(cost?.costUsd).to.equal(48);
    });
});

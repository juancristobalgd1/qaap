// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// All records are synthetic.

import { expect } from 'chai';
import type { QaapUsageRecord } from './qaap-usage-record';
import { QaapUsageAggregator } from './qaap-usage-aggregator';
import { QaapUsageLedger, type QaapUsageLedgerEntry } from './qaap-usage-ledger';
import { QaapUsagePriceList } from './qaap-usage-prices';
import { QaapUsageTime } from './qaap-usage-time';

const NOW = Date.parse('2026-01-03T12:00:00.000Z');

function record(overrides: Partial<QaapUsageRecord> & { provider: QaapUsageRecord['provider'] }): QaapUsageRecord {
    return {
        sessionId: 's1',
        model: 'claude-sonnet-4-5',
        timestampMs: NOW - 60_000,
        tokens: { input: 1_000_000, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 },
        ...overrides,
    };
}

function ledgerOf(records: { file: string; record: QaapUsageRecord }[]): QaapUsageLedger {
    const ledger = new QaapUsageLedger();
    const files = new Map<string, Map<string, QaapUsageLedgerEntry>>();
    for (const { file, record: entry } of records) {
        let entries = files.get(file);
        if (!entries) {
            entries = new Map();
            files.set(file, entries);
        }
        QaapUsageLedger.merge(entries, entry);
    }
    for (const [file, entries] of files) {
        ledger.set(file, { size: 0, mtimeMs: 0, offset: 0, context: { fallbackSessionId: file }, entries, skipped: 0 });
    }
    return ledger;
}

describe('QaapUsageAggregator', () => {

    const aggregator = new QaapUsageAggregator(QaapUsagePriceList.fromJson({
        'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    }));

    it('sums providers, sorts them by cost and counts distinct sessions', () => {
        const ledger = ledgerOf([
            { file: 'a', record: record({ provider: 'claude', sessionId: 'x' }) },
            { file: 'a', record: record({ provider: 'claude', sessionId: 'y' }) },
            { file: 'b', record: record({ provider: 'codex', model: 'unlisted-model', sessionId: 'z', reportedCostUsd: 9 }) },
        ]);
        const summary = aggregator.summarize(ledger, { range: '7d', timezone: 'UTC', nowMs: NOW, scanning: false });
        expect(summary.providers.map(row => row.provider)).to.deep.equal(['codex', 'claude']);
        expect(summary.providers[1]).to.deep.include({ sessions: 2, tokens: 2_000_000, costUsd: 6 });
        expect(summary.providers[0]).to.deep.include({ sessions: 1, costUsd: 9, unpricedTokens: 0 });
        expect(summary.totals).to.deep.include({ sessions: 3, costUsd: 15 });
        expect(summary.scanning).to.be.false;
    });

    it('reports unpriced tokens and cache savings', () => {
        const ledger = ledgerOf([
            { file: 'a', record: record({ provider: 'grok', model: 'mystery', tokens: { input: 500, cachedInput: 0, cacheWrite: 0, output: 500, reasoning: 0 } }) },
            { file: 'a', record: record({ provider: 'claude', tokens: { input: 0, cachedInput: 2_000_000, cacheWrite: 0, output: 0, reasoning: 0 } }) },
        ]);
        const summary = aggregator.summarize(ledger, { range: '7d', timezone: 'UTC', nowMs: NOW, scanning: true });
        expect(summary.providers.find(row => row.provider === 'grok')?.unpricedTokens).to.equal(1000);
        expect(summary.totals.cacheSavingsUsd).to.be.closeTo(5.4, 1e-9);
        expect(summary.scanning).to.be.true;
    });

    it('counts a message logged in two files once', () => {
        const duplicate = record({ provider: 'claude', tokens: { input: 10, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 }, dedupeKey: 'msg-1:req-1' });
        const ledger = ledgerOf([
            { file: 'parent.jsonl', record: duplicate },
            { file: 'subagent.jsonl', record: duplicate },
        ]);
        const summary = aggregator.summarize(ledger, { range: '7d', timezone: 'UTC', nowMs: NOW, scanning: false });
        expect(summary.totals.tokens).to.equal(10);
    });

    it('ignores records outside the range and filters by provider', () => {
        const ledger = ledgerOf([
            { file: 'a', record: record({ provider: 'claude', timestampMs: NOW - 10 * 86_400_000 }) },
            { file: 'a', record: record({ provider: 'pi', tokens: { input: 5, cachedInput: 0, cacheWrite: 0, output: 5, reasoning: 0 } }) },
        ]);
        const claudeOnly = aggregator.summarize(ledger, { range: '7d', timezone: 'UTC', provider: 'claude', nowMs: NOW, scanning: false });
        expect(claudeOnly.providers).to.have.length(0);
        const all = aggregator.summarize(ledger, { range: '7d', timezone: 'UTC', nowMs: NOW, scanning: false });
        expect(all.providers.map(row => row.provider)).to.deep.equal(['pi']);
    });

    it('returns one bucket per day for 7 days and one per hour for 24 hours', () => {
        const ledger = ledgerOf([]);
        expect(aggregator.summarize(ledger, { range: '7d', timezone: 'UTC', nowMs: NOW, scanning: false }).buckets).to.have.length(7);
        expect(aggregator.summarize(ledger, { range: '24h', timezone: 'UTC', nowMs: NOW, scanning: false }).buckets).to.have.length(24);
        expect(aggregator.summarize(ledger, { range: '90d', timezone: 'UTC', nowMs: NOW, scanning: false }).buckets).to.have.length(90);
    });

    it('assigns records to the local day of the requested timezone', () => {
        // 20:00 UTC on 2 January is already 3 January in Kolkata (UTC+5:30).
        const evening = Date.parse('2026-01-02T20:00:00.000Z');
        const ledger = ledgerOf([{ file: 'a', record: record({ provider: 'claude', timestampMs: evening, tokens: { input: 7, cachedInput: 0, cacheWrite: 0, output: 0, reasoning: 0 } }) }]);
        const kolkata = aggregator.summarize(ledger, { range: '7d', timezone: 'Asia/Kolkata', nowMs: NOW, scanning: false });
        const utc = aggregator.summarize(ledger, { range: '7d', timezone: 'UTC', nowMs: NOW, scanning: false });
        const bucketWithTokens = (summary: typeof utc): number => summary.buckets.findIndex(bucket => bucket.perProvider.claude?.tokens === 7);
        expect(bucketWithTokens(kolkata)).to.equal(6);
        expect(bucketWithTokens(utc)).to.equal(5);
    });

    it('computes the local midnight of a day with a DST change', () => {
        // Sao Paulo has no DST since 2019; New York moved clocks on 8 March 2026.
        expect(QaapUsageTime.startOfLocalDay('2026-03-08', 'America/New_York')).to.equal(Date.parse('2026-03-08T05:00:00.000Z'));
        expect(QaapUsageTime.localDateKey(Date.parse('2026-01-02T23:30:00.000Z'), 'America/Sao_Paulo')).to.equal('2026-01-02');
    });
});

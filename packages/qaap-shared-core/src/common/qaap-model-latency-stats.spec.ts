// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    canonicalModelStatsKey,
    formatTurnDuration,
    medianDuration,
    MODEL_TURN_STATS_RING_SIZE,
    pushTurnDuration,
    recordModelTurnDuration,
    resolveModelTurnStats,
} from './qaap-model-latency-stats';

describe('qaap-model-latency-stats', () => {
    const storage = new Map<string, string>();

    beforeEach(() => {
        storage.clear();
        (global as unknown as { window: Window }).window = {
            localStorage: {
                getItem: (key: string) => storage.get(key) ?? null,
                setItem: (key: string, value: string) => { storage.set(key, value); },
                removeItem: (key: string) => { storage.delete(key); },
                clear: () => { storage.clear(); },
                key: () => null,
                length: 0,
            },
        } as unknown as Window;
    });

    describe('canonicalModelStatsKey', () => {
        it('joins provider and modelId, lowercased', () => {
            expect(canonicalModelStatsKey({ provider: 'OpenAI', modelId: 'GPT-4o' })).to.equal('openai/gpt-4o');
        });
    });

    describe('pushTurnDuration (pure ring logic)', () => {
        it('appends within capacity', () => {
            expect(pushTurnDuration([1, 2], 3)).to.deep.equal([1, 2, 3]);
        });

        it('drops the oldest sample once the ring is full', () => {
            const full = Array.from({ length: MODEL_TURN_STATS_RING_SIZE }, (_, i) => i + 1);
            const result = pushTurnDuration(full, 999);
            expect(result).to.have.lengthOf(MODEL_TURN_STATS_RING_SIZE);
            expect(result[0]).to.equal(2);
            expect(result[result.length - 1]).to.equal(999);
        });
    });

    describe('medianDuration (pure)', () => {
        it('computes the middle value for an odd-length list', () => {
            expect(medianDuration([5, 1, 3])).to.equal(3);
        });

        it('averages the two middle values for an even-length list', () => {
            expect(medianDuration([1, 2, 3, 4])).to.equal(2.5);
        });
    });

    describe('recordModelTurnDuration / resolveModelTurnStats', () => {
        it('returns undefined when no samples were recorded', () => {
            expect(resolveModelTurnStats('openai/gpt-4o')).to.be.undefined;
        });

        it('records a sample and resolves its median and sample count', () => {
            recordModelTurnDuration('openai/gpt-4o', 45_000);
            const stats = resolveModelTurnStats('openai/gpt-4o');
            expect(stats).to.deep.equal({ median: 45_000, samples: 1 });
        });

        it('keeps only the last MODEL_TURN_STATS_RING_SIZE samples and updates the median', () => {
            for (let i = 1; i <= MODEL_TURN_STATS_RING_SIZE + 2; i++) {
                recordModelTurnDuration('anthropic/claude', i * 1000);
            }
            const stats = resolveModelTurnStats('anthropic/claude');
            expect(stats?.samples).to.equal(MODEL_TURN_STATS_RING_SIZE);
            // Samples 3..10 (ms: 3000..10000) survive the ring; median of that set is 6500.
            expect(stats?.median).to.equal(6500);
        });

        it('keeps stats for different models independent', () => {
            recordModelTurnDuration('openai/gpt-4o', 10_000);
            recordModelTurnDuration('anthropic/claude-sonnet', 200_000);
            expect(resolveModelTurnStats('openai/gpt-4o')?.median).to.equal(10_000);
            expect(resolveModelTurnStats('anthropic/claude-sonnet')?.median).to.equal(200_000);
        });

        it('ignores non-positive or non-finite durations', () => {
            recordModelTurnDuration('openai/gpt-4o', 0);
            recordModelTurnDuration('openai/gpt-4o', -5);
            recordModelTurnDuration('openai/gpt-4o', NaN);
            expect(resolveModelTurnStats('openai/gpt-4o')).to.be.undefined;
        });

        it('ignores an empty model key', () => {
            recordModelTurnDuration('   ', 1000);
            expect(resolveModelTurnStats('   ')).to.be.undefined;
        });

        it('persists across independent reads of localStorage (survives "reload")', () => {
            recordModelTurnDuration('openai/gpt-4o', 30_000);
            recordModelTurnDuration('openai/gpt-4o', 50_000);
            // Simulate a fresh module read by just calling resolve again — storage is the source of truth.
            expect(resolveModelTurnStats('openai/gpt-4o')).to.deep.equal({ median: 40_000, samples: 2 });
        });

        it('tolerates malformed JSON in storage', () => {
            storage.set('qaap.modelTurnStats.v1', '{not-json');
            expect(resolveModelTurnStats('openai/gpt-4o')).to.be.undefined;
            // Recording afterwards should still work (malformed storage is treated as empty, not fatal).
            recordModelTurnDuration('openai/gpt-4o', 15_000);
            expect(resolveModelTurnStats('openai/gpt-4o')).to.deep.equal({ median: 15_000, samples: 1 });
        });

        it('tolerates a non-object JSON payload', () => {
            storage.set('qaap.modelTurnStats.v1', '"just a string"');
            expect(resolveModelTurnStats('openai/gpt-4o')).to.be.undefined;
        });

        it('tolerates malformed per-model entries (non-array durations, garbage values)', () => {
            storage.set('qaap.modelTurnStats.v1', JSON.stringify({
                'openai/gpt-4o': { durations: 'not-an-array' },
                'anthropic/claude': { durations: [1000, 'nope', -5, NaN, 2000] },
                'broken/entry': 'not-even-an-object',
            }));
            expect(resolveModelTurnStats('openai/gpt-4o')).to.be.undefined;
            expect(resolveModelTurnStats('anthropic/claude')).to.deep.equal({ median: 1500, samples: 2 });
            expect(resolveModelTurnStats('broken/entry')).to.be.undefined;
        });

        it('does not throw when window/localStorage is unavailable', () => {
            (global as unknown as { window: unknown }).window = undefined;
            expect(() => recordModelTurnDuration('openai/gpt-4o', 1000)).to.not.throw();
            expect(resolveModelTurnStats('openai/gpt-4o')).to.be.undefined;
        });
    });

    describe('formatTurnDuration', () => {
        it('formats sub-minute durations as seconds', () => {
            expect(formatTurnDuration(45_000)).to.equal('45s');
            expect(formatTurnDuration(500)).to.equal('1s');
            expect(formatTurnDuration(0)).to.equal('0s');
        });

        it('formats minute-only durations without a seconds component', () => {
            expect(formatTurnDuration(120_000)).to.equal('2m');
        });

        it('formats minutes and seconds together', () => {
            expect(formatTurnDuration(130_000)).to.equal('2m 10s');
        });
    });
});

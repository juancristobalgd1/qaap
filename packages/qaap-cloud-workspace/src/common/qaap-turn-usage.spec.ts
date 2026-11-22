// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    parseQaapClaudeResultUsage,
    parseQaapCodexTurnUsage,
    parseQaapOpenCodeStepUsage,
    sumQaapTurnUsage,
} from './qaap-turn-usage';

describe('qaap-turn-usage', () => {

    describe('parseQaapClaudeResultUsage', () => {
        it('reads the reported cost and every input-side token of a result event', () => {
            const line = JSON.stringify({
                type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0421,
                usage: { input_tokens: 120, output_tokens: 45, cache_creation_input_tokens: 300, cache_read_input_tokens: 9000 },
            });
            expect(parseQaapClaudeResultUsage(line)).to.deep.equal({ inputTokens: 9420, outputTokens: 45, costUsd: 0.0421, source: 'reported' });
        });

        it('reports no cost when the result carries none', () => {
            const line = JSON.stringify({ type: 'result', usage: { input_tokens: 10, output_tokens: 2 } });
            expect(parseQaapClaudeResultUsage(line)).to.deep.equal({ inputTokens: 10, outputTokens: 2, source: 'none' });
        });

        it('ignores a result without a usage block, other events and non-JSON lines', () => {
            expect(parseQaapClaudeResultUsage('{"type":"result","subtype":"success"}')).to.equal(undefined);
            expect(parseQaapClaudeResultUsage('{"type":"assistant","message":{}}')).to.equal(undefined);
            expect(parseQaapClaudeResultUsage('not json')).to.equal(undefined);
        });
    });

    describe('parseQaapCodexTurnUsage', () => {
        it('reads the tokens of a turn.completed event and never a cost', () => {
            const line = JSON.stringify({
                type: 'turn.completed',
                usage: { input_tokens: 2000, cached_input_tokens: 1500, output_tokens: 80, reasoning_output_tokens: 20 },
            });
            expect(parseQaapCodexTurnUsage(line)).to.deep.equal({ inputTokens: 2000, outputTokens: 80, source: 'none' });
        });

        it('ignores other Codex events', () => {
            expect(parseQaapCodexTurnUsage('{"type":"item.completed","item":{}}')).to.equal(undefined);
        });
    });

    describe('parseQaapOpenCodeStepUsage', () => {
        it('reads the reported cost and the tokens of a step_finish part', () => {
            const line = JSON.stringify({
                type: 'step_finish',
                part: { type: 'step-finish', cost: 0.0123, tokens: { input: 500, output: 30, reasoning: 5, cache: { read: 800, write: 40 } } },
            });
            expect(parseQaapOpenCodeStepUsage(line)).to.deep.equal({ inputTokens: 1340, outputTokens: 35, costUsd: 0.0123, source: 'reported' });
        });

        it('reports tokens without a cost when the step carries none', () => {
            const line = JSON.stringify({ type: 'step_finish', part: { tokens: { input: 7, output: 3 } } });
            expect(parseQaapOpenCodeStepUsage(line)).to.deep.equal({ inputTokens: 7, outputTokens: 3, source: 'none' });
        });

        it('ignores other OpenCode events', () => {
            expect(parseQaapOpenCodeStepUsage('{"type":"text","part":{}}')).to.equal(undefined);
        });
    });

    describe('sumQaapTurnUsage', () => {
        it('returns undefined for no turns', () => {
            expect(sumQaapTurnUsage([])).to.equal(undefined);
        });

        it('keeps a cost only when every turn has one', () => {
            const priced = { inputTokens: 10, outputTokens: 1, costUsd: 0.5, source: 'reported' as const };
            const unpriced = { inputTokens: 20, outputTokens: 2, source: 'none' as const };
            expect(sumQaapTurnUsage([priced, priced])).to.deep.equal({ inputTokens: 20, outputTokens: 2, costUsd: 1, source: 'reported' });
            expect(sumQaapTurnUsage([priced, unpriced])).to.deep.equal({ inputTokens: 30, outputTokens: 3, source: 'none' });
        });

        it('calls a priced total of mixed origins an estimate', () => {
            const reported = { inputTokens: 1, outputTokens: 1, costUsd: 0.2, source: 'reported' as const };
            const table = { inputTokens: 1, outputTokens: 1, costUsd: 0.3, source: 'price-table' as const };
            expect(sumQaapTurnUsage([reported, table])).to.deep.equal({ inputTokens: 2, outputTokens: 2, costUsd: 0.5, source: 'estimate' });
        });
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { extractAgentTextFromLog } from './qaap-research-agent-log';
import { parseExperimentProposal } from './qaap-research-ledger';

/** Real QAIQ/Claude Code stream-json log captured from a smoke test of the auto-researcher
 *  (agent-task id f22eb985-9fb5-4e6b-9626-df533170ed76). The whole point of this fixture is that
 *  it is NOT hand-idealized: the `[QAAP experiment]` block only exists JSON-escaped inside a
 *  `stream_event`/`content_block_delta`/`text_delta` envelope, and the final `result` event's
 *  `result` field is empty — exactly the shape that made the parser silently fall back to
 *  `(not declared)` on every round before this fix. */
function loadRealFixture(): string {
    return fs.readFileSync(path.resolve(__dirname, '../../test-resources/qaap-research-agent-log-real.jsonl'), 'utf8');
}

describe('extractAgentTextFromLog', () => {

    it('REGRESSION: pulls the [QAAP experiment] block out of a real stream-json log and it parses', () => {
        const extracted = extractAgentTextFromLog(loadRealFixture());
        expect(extracted).to.contain('[QAAP experiment]');
        const proposal = parseExperimentProposal(extracted);
        expect(proposal).to.deep.equal({
            symptom: 'The score was 75 with x=2',
            hypothesis: 'The score increased because x was increased from 1 to 2',
            lever: 'x',
            config: { x: 2 },
        });
    });

    it('is a passthrough for a plain-text agent log (no structured JSON envelopes at all)', () => {
        const log = [
            'Some reasoning text before the marker.',
            '[QAAP experiment]',
            '```json',
            '{"hypothesis": "lr too low", "lever": "learning_rate", "config": {"learning_rate": 0.01}}',
            '```',
        ].join('\n');
        const extracted = extractAgentTextFromLog(log);
        const proposal = parseExperimentProposal(extracted);
        expect(proposal).to.deep.equal({
            symptom: undefined,
            hypothesis: 'lr too low',
            lever: 'learning_rate',
            config: { learning_rate: 0.01 },
        });
    });

    it('handles a mixed log: plain-text lines interleaved with stream-json envelopes', () => {
        const log = [
            'booting agent runtime...',
            JSON.stringify({ type: 'system', subtype: 'init' }),
            'agent connected.',
            JSON.stringify({
                type: 'stream_event',
                event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '[QAAP experiment]\n```json\n{"hypothesis": "h", "config": {"x": 1}}\n```' } },
            }),
        ].join('\n');
        const extracted = extractAgentTextFromLog(log);
        expect(extracted).to.contain('booting agent runtime...');
        expect(extracted).to.contain('agent connected.');
        const proposal = parseExperimentProposal(extracted);
        expect(proposal).to.deep.equal({ symptom: undefined, hypothesis: 'h', lever: undefined, config: { x: 1 } });
    });

    it('extracts from a full "assistant" message snapshot (non-streaming agents)', () => {
        const log = JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: '[QAAP experiment]\n```json\n{"hypothesis": "h2", "config": {}}\n```' }] },
        });
        const proposal = parseExperimentProposal(extractAgentTextFromLog(log));
        expect(proposal).to.deep.equal({ symptom: undefined, hypothesis: 'h2', lever: undefined, config: {} });
    });

    it('falls back to a non-empty "result" event when there was no streamed text', () => {
        const log = JSON.stringify({ type: 'result', result: '[QAAP experiment]\n```json\n{"hypothesis": "h3", "config": {}}\n```' });
        const proposal = parseExperimentProposal(extractAgentTextFromLog(log));
        expect(proposal).to.deep.equal({ symptom: undefined, hypothesis: 'h3', lever: undefined, config: {} });
    });

    it('ignores tool_use / tool_result / system envelopes entirely', () => {
        const log = [
            JSON.stringify({ type: 'system', subtype: 'init' }),
            JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } }),
            JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file contents with [QAAP experiment] inside them' }] } }),
        ].join('\n');
        expect(extractAgentTextFromLog(log)).to.equal('');
    });

    it('returns an empty string for a log with no assistant text anywhere', () => {
        const log = [
            JSON.stringify({ type: 'system', subtype: 'init' }),
            JSON.stringify({ type: 'result', result: '' }),
        ].join('\n');
        expect(extractAgentTextFromLog(log)).to.equal('');
    });

    it('never throws on malformed JSON lines and treats them as plain text', () => {
        const log = '{not valid json at all';
        expect(() => extractAgentTextFromLog(log)).to.not.throw();
        expect(extractAgentTextFromLog(log)).to.equal(log);
    });
});

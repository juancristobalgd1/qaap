// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { detectEmptyAgentTurn, summarizeAgentResultText } from './qaap-agent-empty-turn';

/** Shapes below are trimmed copies of real `~/.qaap/agent-tasks/<id>.log` records. */
const INIT = JSON.stringify({ type: 'system', subtype: 'init', cwd: '/tmp/repo' });

function resultLine(result: string): string {
    return JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, result });
}

function toolUseLine(): string {
    return JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'Edit', input: { file_path: '/tmp/repo/cart.js' } }] },
    });
}

describe('detectEmptyAgentTurn', () => {

    it('flags the live failure: tool call emitted as TEXT, no tool ran, empty final message', () => {
        // The model wrote the call as prose in a stream delta, so nothing executed and the repo
        // was untouched — yet the CLI exited 0 and the run reported success.
        const fakeToolCall = JSON.stringify({
            type: 'stream_event',
            event: {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: '{"type": "function", "name": "Edit", "parameters": {}}' },
            },
        });
        const log = [INIT, fakeToolCall, resultLine('')].join('\n');

        const result = detectEmptyAgentTurn(log, { complete: true });
        expect(result.empty).to.equal(true);
        expect(result.reason).to.contain('no tools');
    });

    it('never flags a turn that ran a tool, even with an empty final message', () => {
        const log = [INIT, toolUseLine(), resultLine('')].join('\n');
        expect(detectEmptyAgentTurn(log, { complete: true }).empty).to.equal(false);
    });

    it('never flags a prose answer with no tools (a question, not a coding task)', () => {
        const log = [INIT, resultLine('Hi! How can I help you today?')].join('\n');
        expect(detectEmptyAgentTurn(log, { complete: true }).empty).to.equal(false);
    });

    it('never flags a log it could not fully read — the tools may be in the truncated part', () => {
        const log = [INIT, resultLine('')].join('\n');
        expect(detectEmptyAgentTurn(log, { complete: false }).empty).to.equal(false);
    });

    it('never flags a CLI whose format carries no result record', () => {
        const log = [INIT, JSON.stringify({ type: 'stream_event', event: { type: 'message_stop' } })].join('\n');
        expect(detectEmptyAgentTurn(log, { complete: true }).empty).to.equal(false);
    });

    it('never flags an empty or unreadable log', () => {
        expect(detectEmptyAgentTurn(undefined, { complete: true }).empty).to.equal(false);
        expect(detectEmptyAgentTurn('   ', { complete: true }).empty).to.equal(false);
        expect(detectEmptyAgentTurn('not json at all\nplain text output', { complete: true }).empty).to.equal(false);
    });

    it('judges by the LAST result record when a CLI writes several', () => {
        const log = [INIT, resultLine(''), resultLine('Done: fixed the discount rounding.')].join('\n');
        expect(detectEmptyAgentTurn(log, { complete: true }).empty).to.equal(false);
    });

    it('treats whitespace-only final text as no final message', () => {
        const log = [INIT, resultLine('   \n  ')].join('\n');
        expect(detectEmptyAgentTurn(log, { complete: true }).empty).to.equal(true);
    });

    it('sees a tool_result even when the tool_use itself is outside the log', () => {
        const log = [INIT, JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }), resultLine('')].join('\n');
        expect(detectEmptyAgentTurn(log, { complete: true }).empty).to.equal(false);
    });
});

describe('summarizeAgentResultText', () => {
    it('collapses whitespace and caps the length', () => {
        expect(summarizeAgentResultText('  a\n\n  b  ')).to.equal('a b');
        expect(summarizeAgentResultText('x'.repeat(300))).to.have.length(201);
    });
});

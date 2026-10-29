// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapClaudeUsageParser, resolveClaudeBilling } from './qaap-claude-usage';

const context = { taskId: 't1', turnId: 'u1', agentId: 'claude' };

// Shapes captured from `claude` 2.1.312 (--output-format stream-json --verbose), OAuth login.
const INIT = JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'none', model: 'claude-haiku-5-5' });
const RESULT = JSON.stringify({
    type: 'result', subtype: 'success', total_cost_usd: 0.00331576,
    usage: {
        input_tokens: 2, cache_creation_input_tokens: 15509, cache_read_input_tokens: 21176, output_tokens: 4,
        output_tokens_details: { thinking_tokens: 0 },
    },
});

describe('QaapClaudeUsageParser', () => {

    it('reads the cumulative reported cost and marks OAuth runs as subscription', () => {
        const parser = new QaapClaudeUsageParser(context);
        expect(parser.parseLine(INIT)).to.equal(undefined);
        expect(parser.parseLine('{"type":"assistant"}')).to.equal(undefined);
        expect(parser.parseLine(RESULT)).to.deep.equal({
            ...context, model: 'claude-haiku-5-5', provider: 'anthropic',
            inputTokens: 2, outputTokens: 4, cacheReadTokens: 21176, cacheWriteTokens: 15509, reasoningTokens: 0,
            costUsd: 0.00331576, costSource: 'reported', billing: 'subscription', cumulative: true,
        });
    });

    it('marks key-authenticated runs as metered api spend', () => {
        const parser = new QaapClaudeUsageParser(context);
        parser.parseLine(JSON.stringify({ type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' }));
        expect(parser.parseLine(RESULT)?.billing).to.equal('api');
    });

    it('reports unknown billing and no cost when init or total_cost_usd is missing', () => {
        const parser = new QaapClaudeUsageParser(context);
        const event = parser.parseLine('{"type":"result","usage":{"input_tokens":3,"output_tokens":1}}');
        expect(event).to.include({ billing: 'unknown', costSource: 'none', inputTokens: 3, outputTokens: 1 });
        expect(event).to.not.have.property('costUsd');
    });

    it('ignores noise and malformed lines, and rejects nonsense numbers', () => {
        const parser = new QaapClaudeUsageParser(context);
        expect(parser.parseLine('not json')).to.equal(undefined);
        expect(parser.parseLine('{broken')).to.equal(undefined);
        const event = parser.parseLine('{"type":"result","total_cost_usd":-1,"usage":{"input_tokens":"x"}}');
        expect(event).to.include({ costSource: 'none', inputTokens: 0 });
    });

    it('classifies the key source', () => {
        expect(resolveClaudeBilling('none')).to.equal('subscription');
        expect(resolveClaudeBilling('apiKeyHelper')).to.equal('api');
        expect(resolveClaudeBilling(undefined)).to.equal('unknown');
        expect(resolveClaudeBilling('')).to.equal('unknown');
    });
});

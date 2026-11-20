// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { aggregateQaapAgentToolUsage, classifyQaapAgentToolCall } from './qaap-agent-tool-usage';

const tool = (name: string, args = '{}') => ({ type: 'tool', name, args });

describe('classifyQaapAgentToolCall', () => {
    it('names skills by their skill, MCP calls by their server, and keeps plain tools', () => {
        expect(classifyQaapAgentToolCall(tool('Skill', '{"skill":"checkout"}'))).to.deep.equal({ name: '$checkout', kind: 'skill' });
        expect(classifyQaapAgentToolCall(tool('skill', '$pricing'))).to.deep.equal({ name: '$pricing', kind: 'skill' });
        expect(classifyQaapAgentToolCall(tool('mcp__github__get_pull_request'))).to.deep.equal({ name: 'github', kind: 'mcp' });
        expect(classifyQaapAgentToolCall(tool('mcp__qaap-github__search_code'))).to.deep.equal({ name: 'qaap-github', kind: 'mcp' });
        expect(classifyQaapAgentToolCall(tool('Bash'))).to.deep.equal({ name: 'Bash', kind: 'tool' });
    });

    it('ignores text segments and nameless calls', () => {
        expect(classifyQaapAgentToolCall({ type: 'text', name: 'x' })).to.equal(undefined);
        expect(classifyQaapAgentToolCall({ type: 'tool', name: '  ' })).to.equal(undefined);
    });
});

describe('aggregateQaapAgentToolUsage', () => {
    it('counts runs across conversations, ranks skills and MCP first on ties, and caps the list', () => {
        const rows = aggregateQaapAgentToolUsage([
            { messages: [{ segments: [tool('Skill', '{"skill":"checkout"}'), tool('Bash'), tool('Bash'), { type: 'text' }] }] },
            { messages: [{ segments: [tool('Skill', '{"skill":"checkout"}'), tool('mcp__github__x'), tool('mcp__github__y')] }, {}] },
        ], 3);
        expect(rows).to.deep.equal([
            { name: '$checkout', kind: 'skill', runs: 2 },
            { name: 'github', kind: 'mcp', runs: 2 },
            { name: 'Bash', kind: 'tool', runs: 2 },
        ]);
    });

    it('is empty without tool calls', () => {
        expect(aggregateQaapAgentToolUsage([{ messages: [{ segments: [] }] }])).to.deep.equal([]);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    collectTranscriptDelegationChildren,
    countTranscriptDelegationWaitChildIds,
    formatTranscriptDelegationCost,
    formatTranscriptDelegationTokens,
    parseTranscriptDelegationChildren,
    resolveTranscriptDelegationChipState,
    resolveTranscriptDelegationTotals,
    resolveTranscriptDelegationToolKind,
    resolveTranscriptDelegationToolLabel,
    type TranscriptDelegationChild,
} from './qaap-transcript-delegation-core';

function delegateResult(childId: string, state: string, usage?: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
    return JSON.stringify({
        child: { childId, title: `Task ${childId}`, state, isolation: 'worktree', agent: 'claude', model: 'sonnet', ...(usage ? { usage } : {}), ...extra },
    });
}

function child(childId: string, overrides: Partial<TranscriptDelegationChild> = {}): TranscriptDelegationChild {
    return { childId, title: childId, state: 'running', ...overrides };
}

describe('qaap-transcript-delegation-core', () => {

    describe('resolveTranscriptDelegationToolKind', () => {
        it('maps the MCP-prefixed and bare delegation tool names', () => {
            expect(resolveTranscriptDelegationToolKind('mcp__qaaq__qaaq_delegate')).to.equal('delegate');
            expect(resolveTranscriptDelegationToolKind('mcp__qaaq__qaaq_task_wait')).to.equal('wait');
            expect(resolveTranscriptDelegationToolKind('qaaq_task_status')).to.equal('status');
            expect(resolveTranscriptDelegationToolKind('mcp__qaaq__qaaq_task_cancel')).to.equal('cancel');
            expect(resolveTranscriptDelegationToolKind('mcp__qaaq__qaaq_child_apply')).to.equal('childApply');
            // Per-task server names (every task gets its own nonce), as Claude/Codex and OpenCode spell them.
            expect(resolveTranscriptDelegationToolKind('mcp__qaaq_0123456789abcdef__qaaq_delegate')).to.equal('delegate');
            expect(resolveTranscriptDelegationToolKind('qaaq_0123456789abcdef_qaaq_task_wait')).to.equal('wait');
        });

        it('ignores other tools, including other MCP servers and unknown qaaq names', () => {
            expect(resolveTranscriptDelegationToolKind('Bash')).to.equal(undefined);
            expect(resolveTranscriptDelegationToolKind('mcp__other__qaaq_delegate')).to.equal(undefined);
            expect(resolveTranscriptDelegationToolKind('mcp__qaaq__qaaq_unknown')).to.equal(undefined);
            expect(resolveTranscriptDelegationToolKind(undefined)).to.equal(undefined);
        });
    });

    describe('parseTranscriptDelegationChildren', () => {
        it('reads the child of a delegate result with its cost and tokens', () => {
            const [parsed] = parseTranscriptDelegationChildren('delegate', delegateResult('c1', 'running', {
                inputTokens: 1200, outputTokens: 300, costUsd: 0.12, source: 'reported',
            }));
            expect(parsed).to.deep.include({
                childId: 'c1', title: 'Task c1', state: 'running', agent: 'claude', model: 'sonnet',
                costUsd: 0.12, inputTokens: 1200, outputTokens: 300,
            });
        });

        it('leaves the cost undefined when the usage carries none (never a fake number)', () => {
            const [parsed] = parseTranscriptDelegationChildren('delegate', delegateResult('c1', 'completed', {
                inputTokens: 500, outputTokens: 100, source: 'none',
            }));
            expect(parsed.costUsd).to.equal(undefined);
            expect(parsed.inputTokens).to.equal(500);
        });

        it('reads status children and both finished and pending of a wait', () => {
            const status = JSON.stringify({ children: [{ childId: 'a', state: 'queued' }, { childId: 'b', state: 'completed' }], totals: {} });
            expect(parseTranscriptDelegationChildren('status', status).map(c => c.childId)).to.deep.equal(['a', 'b']);
            const wait = JSON.stringify({
                finished: [{ childId: 'b', state: 'completed', summary: '' }],
                pending: [{ childId: 'a', state: 'running' }],
                timedOut: false,
                totals: {},
            });
            expect(parseTranscriptDelegationChildren('wait', wait).map(c => c.state)).to.deep.equal(['completed', 'running']);
        });

        it('returns nothing for apply, missing results, malformed JSON or an unknown state', () => {
            expect(parseTranscriptDelegationChildren('childApply', '{"ok":true}')).to.deep.equal([]);
            expect(parseTranscriptDelegationChildren('delegate', undefined)).to.deep.equal([]);
            expect(parseTranscriptDelegationChildren('delegate', '{not json')).to.deep.equal([]);
            expect(parseTranscriptDelegationChildren('delegate', delegateResult('x', 'exploded'))).to.deep.equal([]);
        });
    });

    describe('collectTranscriptDelegationChildren', () => {
        it('lets a later snapshot win for the state but keeps a cost already seen', () => {
            const byId = collectTranscriptDelegationChildren([
                { toolUseId: 't1', name: 'mcp__qaaq__qaaq_delegate', result: delegateResult('c1', 'running') },
                { toolUseId: 't2', name: 'mcp__qaaq__qaaq_task_status', result: JSON.stringify({ children: [{ childId: 'c1', state: 'completed', usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.3, source: 'reported' } }] }) },
                { toolUseId: 't3', name: 'mcp__qaaq__qaaq_task_status', result: JSON.stringify({ children: [{ childId: 'c1', state: 'completed' }] }) },
            ]);
            expect(byId.get('c1')).to.deep.include({ state: 'completed', costUsd: 0.3, inputTokens: 10, outputTokens: 5 });
        });

        it('ignores calls that are not delegation', () => {
            const byId = collectTranscriptDelegationChildren([{ toolUseId: 't1', name: 'Bash', result: delegateResult('c1', 'running') }]);
            expect(byId.size).to.equal(0);
        });
    });

    describe('totals and cost formatting', () => {
        it('sums the cost only when every child is priced', () => {
            expect(resolveTranscriptDelegationTotals([child('a', { costUsd: 0.1 }), child('b', { costUsd: 0.25 })]))
                .to.deep.equal({ count: 2, costUsd: 0.35 });
        });

        it('omits the total when any child has no price, and reports the count', () => {
            expect(resolveTranscriptDelegationTotals([child('a', { costUsd: 0.1 }), child('b')]))
                .to.deep.equal({ count: 2 });
        });

        it('reports zero children without a cost', () => {
            expect(resolveTranscriptDelegationTotals([])).to.deep.equal({ count: 0 });
        });

        it('formats dollars, tiny costs and absent costs', () => {
            expect(formatTranscriptDelegationCost(0.12)).to.equal('$0.12');
            expect(formatTranscriptDelegationCost(0.004)).to.equal('<$0.01');
            expect(formatTranscriptDelegationCost(0)).to.equal('$0.00');
            expect(formatTranscriptDelegationCost(undefined)).to.equal(undefined);
            expect(formatTranscriptDelegationCost(Number.NaN)).to.equal(undefined);
        });

        it('formats tokens only when some are known', () => {
            expect(formatTranscriptDelegationTokens({ inputTokens: 900, outputTokens: 50 })).to.equal('950');
            expect(formatTranscriptDelegationTokens({ inputTokens: 12000, outputTokens: 400 })).to.equal('12.4k');
            expect(formatTranscriptDelegationTokens({})).to.equal(undefined);
        });
    });

    describe('resolveTranscriptDelegationChipState', () => {
        it('trusts a terminal snapshot over the live status', () => {
            expect(resolveTranscriptDelegationChipState(child('a', { state: 'cancelled' }), 'streaming')).to.equal('cancelled');
        });

        it('maps the live status while the snapshot is not terminal', () => {
            expect(resolveTranscriptDelegationChipState(child('a', { state: 'queued' }), 'streaming')).to.equal('running');
            expect(resolveTranscriptDelegationChipState(child('a', { state: 'running' }), 'settled')).to.equal('completed');
            expect(resolveTranscriptDelegationChipState(child('a', { state: 'running' }), 'failed')).to.equal('failed');
        });

        it('falls back to the snapshot, then to queued', () => {
            expect(resolveTranscriptDelegationChipState(child('a', { state: 'running' }), 'idle')).to.equal('running');
            expect(resolveTranscriptDelegationChipState(undefined, undefined)).to.equal('queued');
        });
    });

    describe('friendly tool labels', () => {
        it('names the wait by its child count', () => {
            expect(countTranscriptDelegationWaitChildIds('{"childIds":["a","b"]}')).to.equal(2);
            expect(countTranscriptDelegationWaitChildIds('{"mode":"any"}')).to.equal(0);
            expect(countTranscriptDelegationWaitChildIds('not json')).to.equal(0);
            expect(resolveTranscriptDelegationToolLabel('wait', 2)).to.deep.include({ defaultText: 'Waiting for {0} helpers', args: ['2'] });
            expect(resolveTranscriptDelegationToolLabel('wait', 1)).to.deep.include({ defaultText: 'Waiting for 1 helper' });
            expect(resolveTranscriptDelegationToolLabel('wait', 0)).to.deep.include({ defaultText: 'Waiting for helpers' });
        });

        it('labels apply and the other delegation tools, and nothing else', () => {
            expect(resolveTranscriptDelegationToolLabel('childApply')).to.deep.include({ defaultText: 'Applied helper changes' });
            expect(resolveTranscriptDelegationToolLabel('cancel')).to.deep.include({ defaultText: 'Cancelled a helper' });
            expect(resolveTranscriptDelegationToolLabel('status')).to.deep.include({ defaultText: 'Checking helpers' });
            expect(resolveTranscriptDelegationToolLabel('delegate')).to.deep.include({ defaultText: 'Started a helper' });
            expect(resolveTranscriptDelegationToolLabel(undefined)).to.equal(undefined);
        });
    });
});

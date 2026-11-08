// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// All fixtures are synthetic. Never paste real session logs into this file.

import { expect } from 'chai';
import { QaapUsageClaudeReader } from './qaap-usage-claude-reader';
import { QaapUsageCodexReader } from './qaap-usage-codex-reader';
import { QaapUsageCopilotReader } from './qaap-usage-copilot-reader';
import { QaapUsageGrokReader } from './qaap-usage-grok-reader';
import { QaapUsageOpenCodeReader } from './qaap-usage-opencode-reader';
import { QaapUsagePiReader } from './qaap-usage-pi-reader';
import type { QaapUsageLineContext } from './qaap-usage-record';

function context(overrides: Partial<QaapUsageLineContext> = {}): QaapUsageLineContext {
    return { fallbackSessionId: 'file-session', ...overrides };
}

describe('QaapUsageClaudeReader', () => {

    const assistant = (overrides: Record<string, unknown> = {}): string => JSON.stringify({
        type: 'assistant',
        sessionId: 'claude-s1',
        requestId: 'req-1',
        timestamp: '2026-01-02T10:00:00.000Z',
        message: {
            id: 'msg-1',
            model: 'claude-sonnet-4-5-20250929',
            usage: {
                input_tokens: 100,
                cache_read_input_tokens: 40,
                cache_creation_input_tokens: 10,
                output_tokens: 30,
                output_tokens_details: { thinking_tokens: 5 },
            },
        },
        ...overrides,
    });

    it('maps usage fields to the token breakdown', () => {
        const result = QaapUsageClaudeReader.parseLine(assistant(), context());
        expect(result?.record).to.deep.include({ provider: 'claude', sessionId: 'claude-s1', model: 'claude-sonnet-4-5-20250929' });
        expect(result?.record?.tokens).to.deep.equal({ input: 100, cachedInput: 40, cacheWrite: 10, output: 30, reasoning: 5 });
        expect(result?.record?.dedupeKey).to.equal('msg-1:req-1');
    });

    it('ignores synthetic messages and non-assistant lines', () => {
        expect(QaapUsageClaudeReader.parseLine(assistant({ message: { id: 'x', model: '<synthetic>', usage: { input_tokens: 5 } } }), context())).to.be.undefined;
        expect(QaapUsageClaudeReader.parseLine(JSON.stringify({ type: 'user', message: {} }), context())).to.be.undefined;
    });

    it('uses the file session when the line has none', () => {
        const line = JSON.parse(assistant());
        delete line.sessionId;
        expect(QaapUsageClaudeReader.parseLine(JSON.stringify(line), context())?.record?.sessionId).to.equal('file-session');
    });

    it('skips malformed JSON, negative counts and reasoning above output', () => {
        expect(QaapUsageClaudeReader.parseLine('{"type":"assistant"', context())).to.deep.equal({ skipped: true });
        expect(QaapUsageClaudeReader.parseLine(assistant({ message: { id: 'n', model: 'm', usage: { input_tokens: -1, output_tokens: 1 } } }), context()))
            .to.deep.equal({ skipped: true });
        expect(QaapUsageClaudeReader.parseLine(assistant({ message: { id: 'r', model: 'm', usage: { output_tokens: 2, output_tokens_details: { thinking_tokens: 9 } } } }), context()))
            .to.deep.equal({ skipped: true });
    });
});

describe('QaapUsageCodexReader', () => {

    const tokenCount = (last: Record<string, number>, timestamp = '2026-01-02T10:00:00.000Z'): string => JSON.stringify({
        type: 'event_msg',
        timestamp,
        payload: {
            type: 'token_count',
            info: { last_token_usage: last, total_token_usage: last },
            rate_limits: {
                primary: { used_percent: 12, window_minutes: 300, resets_at: 1780056297 },
                secondary: { used_percent: 40, window_minutes: 10080, resets_at: 1780188880 },
            },
        },
    });

    it('takes the model and session from earlier lines and splits cached input', () => {
        const ctx = context();
        expect(QaapUsageCodexReader.parseLine(JSON.stringify({ type: 'session_meta', payload: { id: 'codex-s1' } }), ctx)).to.be.undefined;
        expect(QaapUsageCodexReader.parseLine(JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.1-codex' } }), ctx)).to.be.undefined;
        const result = QaapUsageCodexReader.parseLine(tokenCount({ input_tokens: 120, cached_input_tokens: 20, output_tokens: 50, reasoning_output_tokens: 8, total_tokens: 170 }), ctx);
        expect(result?.record).to.deep.include({ provider: 'codex', sessionId: 'codex-s1', model: 'gpt-5.1-codex' });
        expect(result?.record?.tokens).to.deep.equal({ input: 100, cachedInput: 20, cacheWrite: 0, output: 50, reasoning: 8 });
    });

    it('reports rate limit windows with their observation time', () => {
        const result = QaapUsageCodexReader.parseLine(tokenCount({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 }), context());
        expect(result?.record).to.be.undefined;
        expect(result?.rateLimits?.observedAtMs).to.equal(Date.parse('2026-01-02T10:00:00.000Z'));
        expect(result?.rateLimits?.primary).to.deep.equal({ usedPercent: 12, windowMinutes: 300, resetsAtMs: 1780056297000 });
        expect(result?.rateLimits?.secondary?.windowMinutes).to.equal(10080);
    });

    it('skips inconsistent totals and negative counts', () => {
        expect(QaapUsageCodexReader.parseLine(tokenCount({ input_tokens: 10, cached_input_tokens: 2, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 99 }), context()))
            .to.deep.include({ skipped: true });
        expect(QaapUsageCodexReader.parseLine(tokenCount({ input_tokens: -4, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 1 }), context()))
            .to.deep.include({ skipped: true });
    });
});

describe('QaapUsagePiReader', () => {

    it('derives output from the total and keeps the reported cost', () => {
        const ctx = context();
        expect(QaapUsagePiReader.parseLine(JSON.stringify({ type: 'session', id: 'pi-s1' }), ctx)).to.be.undefined;
        const line = JSON.stringify({
            type: 'message',
            id: 'pi-m1',
            timestamp: '2026-01-03T08:00:00.000Z',
            message: {
                role: 'assistant',
                model: 'synthetic-model',
                usage: { input: 50, cacheRead: 20, cacheWrite: 5, totalTokens: 100, cost: { total: 0.0021 } },
            },
        });
        const result = QaapUsagePiReader.parseLine(line, ctx);
        expect(result?.record?.tokens).to.deep.equal({ input: 50, cachedInput: 20, cacheWrite: 5, output: 25, reasoning: 0 });
        expect(result?.record?.reportedCostUsd).to.equal(0.0021);
        expect(result?.record?.sessionId).to.equal('pi-s1');
    });

    it('skips usage whose total is smaller than its parts', () => {
        const line = JSON.stringify({
            type: 'message',
            timestamp: '2026-01-03T08:00:00.000Z',
            message: { role: 'assistant', usage: { input: 50, cacheRead: 20, cacheWrite: 5, totalTokens: 60 } },
        });
        expect(QaapUsagePiReader.parseLine(line, context())).to.deep.equal({ skipped: true });
    });
});

describe('QaapUsageOpenCodeReader', () => {

    it('joins a step-finish part with its message and keeps the reported cost', () => {
        const message = QaapUsageOpenCodeReader.parseMessage(JSON.stringify({
            id: 'msg-oc-1',
            sessionID: 'oc-s1',
            role: 'assistant',
            time: { created: Date.parse('2026-01-04T12:00:00.000Z') },
            model: { providerID: 'p', modelID: 'oc-model' },
        }));
        expect(message?.meta.model).to.equal('oc-model');
        const part = JSON.stringify({
            id: 'prt-1',
            sessionID: 'oc-s1',
            messageID: 'msg-oc-1',
            type: 'step-finish',
            cost: 0.5,
            tokens: { input: 10, output: 4, reasoning: 1, cache: { read: 3, write: 2 } },
        });
        const result = QaapUsageOpenCodeReader.parsePart(part, id => (id === 'msg-oc-1' ? message?.meta : undefined), 0);
        expect(result?.record).to.deep.include({ provider: 'opencode', model: 'oc-model', sessionId: 'oc-s1', reportedCostUsd: 0.5 });
        expect(result?.record?.timestampMs).to.equal(Date.parse('2026-01-04T12:00:00.000Z'));
        expect(result?.record?.tokens).to.deep.equal({ input: 10, cachedInput: 3, cacheWrite: 2, output: 4, reasoning: 1 });
    });

    it('ignores non step-finish parts and falls back to unknown models', () => {
        expect(QaapUsageOpenCodeReader.parsePart(JSON.stringify({ type: 'text', text: 'x' }), () => undefined, 1)).to.be.undefined;
        const part = JSON.stringify({ id: 'p2', sessionID: 's', messageID: 'missing', type: 'step-finish', tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } } });
        const result = QaapUsageOpenCodeReader.parsePart(part, () => undefined, 42);
        expect(result?.record?.model).to.equal('unknown');
        expect(result?.record?.timestampMs).to.equal(42);
        expect(result?.record?.reportedCostUsd).to.be.undefined;
    });
});

describe('QaapUsageGrokReader', () => {

    it('reads per-turn entries and prefers them over session totals', () => {
        const document = JSON.stringify({
            sessionId: 'grok-s1',
            updatedAt: '2026-01-05T09:00:00.000Z',
            session: { inputTokens: 999, outputTokens: 999 },
            turns: [
                { turnNumber: 1, endedAt: '2026-01-05T08:00:00.000Z', inputTokens: 30, outputTokens: 7, cachedReadTokens: 10, cacheCreationTokens: 0, reasoningTokens: 2, primaryModelId: 'grok-4.7' },
            ],
        });
        const results = QaapUsageGrokReader.parseDocument(document, 'fallback');
        expect(results).to.have.length(1);
        expect(results[0].record?.tokens).to.deep.equal({ input: 20, cachedInput: 10, cacheWrite: 0, output: 7, reasoning: 2 });
        expect(results[0].record?.model).to.equal('grok-4.7');
    });

    it('falls back to the session totals when there are no turns', () => {
        const results = QaapUsageGrokReader.parseDocument(JSON.stringify({
            session: { inputTokens: 5, outputTokens: 5, cachedReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, primaryModelId: 'g' },
            updatedAt: '2026-01-05T09:00:00.000Z',
        }), 'fallback');
        expect(results[0].record?.sessionId).to.equal('fallback');
        expect(results[0].record?.dedupeKey).to.equal('grok:fallback:session');
    });

    it('marks unreadable documents as skipped', () => {
        expect(QaapUsageGrokReader.parseDocument('not json', 'x')).to.deep.equal([{ skipped: true }]);
    });
});

describe('QaapUsageCopilotReader', () => {

    it('reads a usage row and treats input as inclusive of cache reads', () => {
        const result = QaapUsageCopilotReader.parseRow({
            id: 7,
            session_id: 'cp-s1',
            model: 'copilot-model',
            input_tokens: 100,
            output_tokens: 20,
            cache_read_tokens: 60,
            cache_write_tokens: 0,
            reasoning_tokens: 3,
            created_at: '2026-01-06 14:30:00',
        });
        expect(result?.record).to.deep.include({ provider: 'copilot', sessionId: 'cp-s1', model: 'copilot-model', dedupeKey: 'copilot:7' });
        expect(result?.record?.tokens).to.deep.equal({ input: 40, cachedInput: 60, cacheWrite: 0, output: 20, reasoning: 3 });
        expect(result?.record?.timestampMs).to.equal(Date.parse('2026-01-06T14:30:00.000Z'));
    });

    it('skips rows without a usable timestamp', () => {
        expect(QaapUsageCopilotReader.parseRow({ id: 1, session_id: 's', input_tokens: 1, output_tokens: 1, created_at: 'soon' }))
            .to.deep.equal({ skipped: true });
    });
});

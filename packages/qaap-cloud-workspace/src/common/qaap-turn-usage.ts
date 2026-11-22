// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QaapClaudeUsageParser } from './qaap-claude-usage';

/**
 * What one finished CLI turn consumed. Persisted on the turn's verdict so it outlives the task.
 * `inputTokens` is every input-side token (uncached input + cache reads + cache writes), so it is
 * comparable across harnesses; `costUsd` is undefined when the harness reports no cost.
 */
export interface QaapTurnUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly costUsd?: number;
    readonly source: 'reported' | 'price-table' | 'estimate' | 'none';
}

const asCount = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

function parseJsonObject(line: string): Record<string, unknown> | undefined {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
        return undefined;
    }
    try {
        const parsed: unknown = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The usage of a Claude Code (or QAIQ) stream-json `result` line, through the same parser the usage
 * ledger uses. Returns `undefined` for any other line. The CLI's own `total_cost_usd` is the cost.
 */
export function parseQaapClaudeResultUsage(line: string): QaapTurnUsage | undefined {
    // A result without a usage block carries nothing to record (the parser would return zero tokens).
    const record = parseJsonObject(line);
    if (record?.type !== 'result' || !record.usage || typeof record.usage !== 'object') {
        return undefined;
    }
    const event = new QaapClaudeUsageParser({ taskId: '', turnId: '', agentId: '' }).parseLine(line);
    if (!event) {
        return undefined;
    }
    return {
        inputTokens: event.inputTokens + (event.cacheReadTokens ?? 0) + (event.cacheWriteTokens ?? 0),
        outputTokens: event.outputTokens,
        ...(event.costUsd !== undefined ? { costUsd: event.costUsd } : {}),
        source: event.costUsd !== undefined ? 'reported' : 'none',
    };
}

/**
 * The usage of a Codex `turn.completed` line (`codex exec --json`). Codex reports tokens only, so the
 * cost is undefined and the source `none`. Returns `undefined` for any other line.
 */
export function parseQaapCodexTurnUsage(line: string): QaapTurnUsage | undefined {
    const record = parseJsonObject(line);
    if (record?.type !== 'turn.completed') {
        return undefined;
    }
    const usage = record.usage && typeof record.usage === 'object' ? record.usage as Record<string, unknown> : {};
    return {
        inputTokens: asCount(usage.input_tokens),
        outputTokens: asCount(usage.output_tokens),
        source: 'none',
    };
}

/**
 * The usage of an OpenCode `step_finish` line (`opencode run --format json`). Tokens and cost sit on the
 * event or on its `part`; a reported cost is `reported`. Returns `undefined` for any other line.
 */
export function parseQaapOpenCodeStepUsage(line: string): QaapTurnUsage | undefined {
    const record = parseJsonObject(line);
    if (record?.type !== 'step_finish') {
        return undefined;
    }
    const part = record.part && typeof record.part === 'object' ? record.part as Record<string, unknown> : {};
    const tokens = part.tokens && typeof part.tokens === 'object' ? part.tokens as Record<string, unknown> : {};
    const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache as Record<string, unknown> : {};
    const cost = typeof part.cost === 'number' && Number.isFinite(part.cost) && part.cost >= 0 ? part.cost : undefined;
    return {
        inputTokens: asCount(tokens.input) + asCount(cache.read) + asCount(cache.write),
        outputTokens: asCount(tokens.output) + asCount(tokens.reasoning),
        ...(cost !== undefined ? { costUsd: cost } : {}),
        source: cost !== undefined ? 'reported' : 'none',
    };
}

/** Sums the usage of several turns. Cost is kept only when every turn has one (otherwise it would be a partial sum). */
export function sumQaapTurnUsage(turns: readonly QaapTurnUsage[]): QaapTurnUsage | undefined {
    if (turns.length === 0) {
        return undefined;
    }
    const inputTokens = turns.reduce((sum, turn) => sum + turn.inputTokens, 0);
    const outputTokens = turns.reduce((sum, turn) => sum + turn.outputTokens, 0);
    const allPriced = turns.every(turn => turn.costUsd !== undefined);
    const costUsd = allPriced ? turns.reduce((sum, turn) => sum + (turn.costUsd ?? 0), 0) : undefined;
    const sources = new Set(turns.map(turn => turn.source));
    // Mixed origins with a cost are no longer one harness's own figure: call the total an estimate.
    const source: QaapTurnUsage['source'] = sources.size === 1 ? turns[0].source : costUsd !== undefined ? 'estimate' : 'none';
    return {
        inputTokens,
        outputTokens,
        ...(costUsd !== undefined ? { costUsd } : {}),
        source,
    };
}

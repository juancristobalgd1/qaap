// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/*
 * Transcript view of agent delegation (`doc/` contract: `qaap-agent-delegation-protocol.ts` in qaap-cloud-workspace).
 * The parent agent calls the `qaaq_*` MCP tools; this module reads their tool results and turns them into
 * child chips, friendly tool labels and the "N helpers · $X" summary. Pure data, no DOM, no nls: the browser
 * layer localizes the labels.
 *
 * Tool names are mirrored here on purpose (qaap-transcript does not depend on qaap-cloud-workspace).
 */

export type TranscriptDelegationToolKind = 'delegate' | 'wait' | 'status' | 'cancel' | 'childApply';

/**
 * Server prefixes a harness puts in front of a delegation tool: `mcp__qaaq_<nonce>__` (Claude Code, Codex),
 * `qaaq_<nonce>_` (OpenCode), where each task gets its own nonce, and the plain `mcp__qaaq__`. Display only: which
 * calls run without approval is decided by the backend gate against the exact server name of the task.
 */
const DELEGATION_MCP_PREFIX = /^(?:mcp__qaaq(?:_[0-9a-f]{16})?__|qaaq_[0-9a-f]{16}_)/;

const DELEGATION_TOOL_KINDS: Readonly<Record<string, TranscriptDelegationToolKind>> = {
    qaaq_delegate: 'delegate',
    qaaq_task_wait: 'wait',
    qaaq_task_status: 'status',
    qaaq_task_cancel: 'cancel',
    qaaq_child_apply: 'childApply',
};

/** Child lifecycle as the protocol reports it. */
export type TranscriptDelegationChildState = 'queued' | 'running' | 'completed' | 'blocked' | 'failed' | 'cancelled';

const CHILD_STATES: ReadonlySet<string> = new Set<string>(['queued', 'running', 'completed', 'blocked', 'failed', 'cancelled']);
const TERMINAL_CHILD_STATES: ReadonlySet<string> = new Set<string>(['completed', 'blocked', 'failed', 'cancelled']);

/** One child as last reported by a delegation tool result. `costUsd` is undefined when the harness reports no price. */
export interface TranscriptDelegationChild {
    readonly childId: string;
    readonly title: string;
    readonly state: TranscriptDelegationChildState;
    readonly agent?: string;
    readonly model?: string;
    readonly costUsd?: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
}

/** The subset of a tool segment this module reads. */
export interface TranscriptDelegationToolCall {
    readonly toolUseId: string;
    readonly name: string;
    readonly args?: string;
    readonly result?: string;
}

/** Maps a harness tool name (`mcp__qaaq_<nonce>__qaaq_delegate`, `qaaq_<nonce>_qaaq_delegate` or bare) to its operation. */
export function resolveTranscriptDelegationToolKind(toolName: string | undefined): TranscriptDelegationToolKind | undefined {
    const trimmed = toolName?.trim() ?? '';
    const bare = trimmed.replace(DELEGATION_MCP_PREFIX, '');
    return Object.prototype.hasOwnProperty.call(DELEGATION_TOOL_KINDS, bare) ? DELEGATION_TOOL_KINDS[bare] : undefined;
}

/** True for a terminal child state (no further change). */
export function isTranscriptDelegationTerminalState(state: TranscriptDelegationChildState): boolean {
    return TERMINAL_CHILD_STATES.has(state);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && Boolean(value) && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function parseChild(value: unknown): TranscriptDelegationChild | undefined {
    if (!isRecord(value) || typeof value.childId !== 'string' || typeof value.state !== 'string' || !CHILD_STATES.has(value.state)) {
        return undefined;
    }
    const usage = isRecord(value.usage) ? value.usage : undefined;
    const costUsd = finiteNumber(usage?.costUsd);
    const inputTokens = finiteNumber(usage?.inputTokens);
    const outputTokens = finiteNumber(usage?.outputTokens);
    return {
        childId: value.childId,
        title: typeof value.title === 'string' && value.title.trim() ? value.title : value.childId,
        state: value.state as TranscriptDelegationChildState,
        ...(typeof value.agent === 'string' ? { agent: value.agent } : {}),
        ...(typeof value.model === 'string' ? { model: value.model } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
    };
}

/**
 * Children named by one delegation tool result. `qaaq_delegate` and `qaaq_task_cancel` return `child`,
 * `qaaq_task_status` returns `children`, `qaaq_task_wait` returns `finished` + `pending`. Apply returns none.
 * Malformed JSON yields no children (never throws).
 */
export function parseTranscriptDelegationChildren(kind: TranscriptDelegationToolKind, result: string | undefined): readonly TranscriptDelegationChild[] {
    if (!result) {
        return [];
    }
    let root: unknown;
    try {
        root = JSON.parse(result);
    } catch {
        return [];
    }
    if (!isRecord(root)) {
        return [];
    }
    let candidates: unknown[];
    switch (kind) {
        case 'delegate':
        case 'cancel':
            candidates = [root.child];
            break;
        case 'status':
            candidates = Array.isArray(root.children) ? root.children : [];
            break;
        case 'wait':
            candidates = [
                ...(Array.isArray(root.finished) ? root.finished : []),
                ...(Array.isArray(root.pending) ? root.pending : []),
            ];
            break;
        default:
            candidates = [];
    }
    return candidates.map(parseChild).filter((child): child is TranscriptDelegationChild => child !== undefined);
}

/**
 * Latest known view of every child of a conversation, keyed by child id. Later results win for state and
 * title; a price or token count already seen is kept when a later snapshot omits it, so a cost never
 * disappears from a chip.
 */
export function collectTranscriptDelegationChildren(calls: readonly TranscriptDelegationToolCall[]): ReadonlyMap<string, TranscriptDelegationChild> {
    const byId = new Map<string, TranscriptDelegationChild>();
    for (const call of calls) {
        const kind = resolveTranscriptDelegationToolKind(call.name);
        if (!kind) {
            continue;
        }
        for (const child of parseTranscriptDelegationChildren(kind, call.result)) {
            const previous = byId.get(child.childId);
            byId.set(child.childId, previous ? {
                ...previous,
                ...child,
                costUsd: child.costUsd ?? previous.costUsd,
                inputTokens: child.inputTokens ?? previous.inputTokens,
                outputTokens: child.outputTokens ?? previous.outputTokens,
            } : child);
        }
    }
    return byId;
}

/** Live conversation status of a child, as the thread store reports it (`streaming` = its agent is working). */
export type TranscriptDelegationLiveStatus = 'idle' | 'streaming' | 'settled' | 'failed';

/**
 * State shown on a chip. A terminal snapshot is authoritative. Otherwise the live conversation status wins
 * (`streaming` is running, `settled` is completed, `failed` is failed); without either, the snapshot or queued.
 */
export function resolveTranscriptDelegationChipState(
    snapshot: TranscriptDelegationChild | undefined,
    live: TranscriptDelegationLiveStatus | undefined,
): TranscriptDelegationChildState {
    if (snapshot && isTranscriptDelegationTerminalState(snapshot.state)) {
        return snapshot.state;
    }
    if (live === 'streaming') {
        return 'running';
    }
    if (live === 'failed') {
        return 'failed';
    }
    if (live === 'settled') {
        return 'completed';
    }
    return snapshot?.state ?? 'queued';
}

/** Totals over children: the count, and the cost only when every child has a known price. */
export interface TranscriptDelegationTotals {
    readonly count: number;
    /** Set only when `count > 0` and every child reports a cost. Never a partial sum. */
    readonly costUsd?: number;
}

export function resolveTranscriptDelegationTotals(children: Iterable<TranscriptDelegationChild>): TranscriptDelegationTotals {
    let count = 0;
    let total = 0;
    let allPriced = true;
    for (const child of children) {
        count++;
        if (child.costUsd === undefined) {
            allPriced = false;
        } else {
            total += child.costUsd;
        }
    }
    return count > 0 && allPriced ? { count, costUsd: total } : { count };
}

/** `$0.12`, `<$0.01` for a real but tiny cost, undefined when there is no cost (never a fake number). */
export function formatTranscriptDelegationCost(costUsd: number | undefined): string | undefined {
    if (costUsd === undefined || !Number.isFinite(costUsd) || costUsd < 0) {
        return undefined;
    }
    if (costUsd > 0 && costUsd < 0.01) {
        return '<$0.01';
    }
    return `$${costUsd.toFixed(2)}`;
}

/** Input plus output tokens as `950` or `12.4k`; undefined when neither is known. */
export function formatTranscriptDelegationTokens(child: Pick<TranscriptDelegationChild, 'inputTokens' | 'outputTokens'>): string | undefined {
    if (child.inputTokens === undefined && child.outputTokens === undefined) {
        return undefined;
    }
    const total = (child.inputTokens ?? 0) + (child.outputTokens ?? 0);
    return total < 1000 ? String(total) : `${(total / 1000).toFixed(1)}k`;
}

/** A localizable label: the browser layer calls `nls.localize(key, defaultText, ...args)`. */
export interface TranscriptDelegationToolLabel {
    readonly key: string;
    readonly defaultText: string;
    readonly args: readonly string[];
}

/**
 * Friendly label for a delegation tool pill, or undefined for a tool that is not delegation. `waitCount` is the
 * number of child ids named by a wait call (0 when the wait covers all children).
 */
export function resolveTranscriptDelegationToolLabel(kind: TranscriptDelegationToolKind | undefined, waitCount = 0): TranscriptDelegationToolLabel | undefined {
    switch (kind) {
        case 'delegate':
            return { key: 'theia/qaap/delegation/toolDelegate', defaultText: 'Started a helper', args: [] };
        case 'wait':
            if (waitCount === 1) {
                return { key: 'theia/qaap/delegation/toolWaitOne', defaultText: 'Waiting for 1 helper', args: [] };
            }
            if (waitCount > 1) {
                return { key: 'theia/qaap/delegation/toolWaitCount', defaultText: 'Waiting for {0} helpers', args: [String(waitCount)] };
            }
            return { key: 'theia/qaap/delegation/toolWaitAll', defaultText: 'Waiting for helpers', args: [] };
        case 'status':
            return { key: 'theia/qaap/delegation/toolStatus', defaultText: 'Checking helpers', args: [] };
        case 'cancel':
            return { key: 'theia/qaap/delegation/toolCancel', defaultText: 'Cancelled a helper', args: [] };
        case 'childApply':
            return { key: 'theia/qaap/delegation/toolApply', defaultText: 'Applied helper changes', args: [] };
        default:
            return undefined;
    }
}

/** Number of child ids a wait call names (from its JSON args). Zero when absent or malformed. */
export function countTranscriptDelegationWaitChildIds(args: string | undefined): number {
    if (!args) {
        return 0;
    }
    try {
        const parsed: unknown = JSON.parse(args);
        return isRecord(parsed) && Array.isArray(parsed.childIds) ? parsed.childIds.length : 0;
    } catch {
        return 0;
    }
}

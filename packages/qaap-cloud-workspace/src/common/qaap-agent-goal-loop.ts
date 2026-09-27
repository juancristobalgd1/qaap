// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Agent goal loop ("Until done"): protocol DTOs and the pure decision logic of the loop.
 *
 * The backend drives a conversation toward a user goal by repeating
 * `executing → verifying → evaluating` until an evaluator agent says the goal is met
 * (`completed`), a budget runs out (`blocked`) or the user stops it (`cancelled`).
 * Everything here is side-effect free so the runner (`node/qaap-agent-goal-loop-runner.ts`)
 * only orchestrates I/O. See `doc/qaap-agent-goal-loop.md`.
 *
 * Mirrored (types only) in `@theia/qaap-shared-core` `qaap-agent-conversation-client.ts`.
 */

import type { QaapAgentConversation, QaapAgentMessage } from './qaap-agent-conversation';

export type QaapAgentGoalLoopPhase = 'executing' | 'verifying' | 'evaluating' | 'completed' | 'blocked' | 'cancelled';

export interface QaapAgentGoalLoopBudget {
    /** Agent turns started by the loop (the first turn included). */
    readonly maxIterations: number;
    /** Wall clock from start. */
    readonly maxDurationMs: number;
    /** Evaluator one-shot calls. Defaults to {@link maxIterations}. */
    readonly maxEvaluatorCalls: number;
    /** Summed agent turn runtime — the "cost" billing debits. */
    readonly maxAgentRuntimeMs: number;
}

export interface QaapAgentGoalLoopUsage {
    readonly evaluatorCalls: number;
    readonly agentRuntimeMs: number;
}

export type QaapAgentGoalLoopVerifyStatus = 'passed' | 'failed' | 'skipped';

export interface QaapAgentGoalLoopVerifyResult {
    readonly status: QaapAgentGoalLoopVerifyStatus;
    /** Failing (or last passing) command, e.g. `npm run test`. */
    readonly command?: string;
    /** Failure summary / log tail when {@link status} is `failed`; skip reason when `skipped`. */
    readonly summary?: string;
    readonly checkedAt: number;
}

export type QaapAgentGoalLoopConfidence = 'high' | 'medium' | 'low';

export interface QaapAgentGoalLoopEvaluation {
    readonly done: boolean;
    readonly confidence: QaapAgentGoalLoopConfidence;
    readonly reasoning: string;
    readonly gaps: string[];
    /** `fallback` = deterministic verdict from verify only (evaluator unparseable or failed). */
    readonly source: 'evaluator' | 'fallback';
    readonly evaluatedAt: number;
}

/** Persisted on {@link QaapAgentConversation.goalLoop}. */
export interface QaapAgentGoalLoopState {
    readonly phase: QaapAgentGoalLoopPhase;
    readonly goal: string;
    readonly startedAt: number;
    readonly updatedAt: number;
    /** 1-based number of agent turns the loop has started. */
    readonly iteration: number;
    /** First user message posted by the loop. */
    readonly anchorUserMessageId: string;
    /** User message of the turn the loop is currently waiting on / evaluating. */
    readonly currentTurnUserMessageId?: string;
    readonly budget: QaapAgentGoalLoopBudget;
    readonly usage: QaapAgentGoalLoopUsage;
    readonly lastVerify?: QaapAgentGoalLoopVerifyResult;
    readonly lastEvaluation?: QaapAgentGoalLoopEvaluation;
    /** Why the loop ended in `blocked` / `cancelled` (or a short note for `completed`). */
    readonly stopReason?: string;
    readonly finishedAt?: number;
}

/** POST body for `/agent-conversations/:id/goal-loop/start`. */
export interface QaapStartAgentGoalLoopRequest {
    readonly goal: string;
    readonly budget?: Partial<QaapAgentGoalLoopBudget>;
    /** First prompt of the loop; defaults to {@link goal}. */
    readonly initialPrompt?: string;
}

/** Response of the goal-loop routes. */
export interface QaapAgentGoalLoopResponse {
    readonly conversationId: string;
    readonly goalLoop?: QaapAgentGoalLoopState;
}

const MINUTE_MS = 60 * 1000;

/** Design defaults (`doc/qaap-agent-goal-loop.md`). */
export const QAAP_AGENT_GOAL_LOOP_DEFAULT_BUDGET: QaapAgentGoalLoopBudget = {
    maxIterations: 8,
    maxDurationMs: 120 * MINUTE_MS,
    maxEvaluatorCalls: 8,
    maxAgentRuntimeMs: 60 * MINUTE_MS,
};

/** Hard ceilings a client-supplied budget is clamped to. */
export const QAAP_AGENT_GOAL_LOOP_BUDGET_CEILING: QaapAgentGoalLoopBudget = {
    maxIterations: 50,
    maxDurationMs: 24 * 60 * MINUTE_MS,
    maxEvaluatorCalls: 50,
    maxAgentRuntimeMs: 8 * 60 * MINUTE_MS,
};

/** Evaluator transcript excerpt limits. */
export const QAAP_AGENT_GOAL_LOOP_TRANSCRIPT_MESSAGES = 8;
export const QAAP_AGENT_GOAL_LOOP_TRANSCRIPT_MAX_CHARS = 12_000;
/** Log tail included in a `[Goal · verify failed]` prompt. */
export const QAAP_AGENT_GOAL_LOOP_VERIFY_LOG_TAIL_CHARS = 4_000;
const MAX_GOAL_CHARS = 8_000;
const MAX_GAPS = 10;

export function isGoalLoopPhaseTerminal(phase: QaapAgentGoalLoopPhase): boolean {
    return phase === 'completed' || phase === 'blocked' || phase === 'cancelled';
}

export function isGoalLoopStateActive(state: QaapAgentGoalLoopState | undefined): state is QaapAgentGoalLoopState {
    return !!state && !isGoalLoopPhaseTerminal(state.phase);
}

/**
 * Whether the conversation has a running goal loop. Used to give the loop precedence over
 * auto-continue and (phase 2) to suppress the per-turn completion push while a loop runs.
 */
export function isGoalLoopActive(conv: Pick<QaapAgentConversation, 'goalLoop'> | undefined): boolean {
    return isGoalLoopStateActive(conv?.goalLoop);
}

function clampPositiveInteger(value: unknown, fallback: number, ceiling: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
        return fallback;
    }
    return Math.min(Math.floor(value), ceiling);
}

/** Merges a (client-supplied, untrusted) partial budget over the defaults, clamped to ceilings. */
export function mergeGoalLoopBudget(partial?: Partial<QaapAgentGoalLoopBudget>): QaapAgentGoalLoopBudget {
    const defaults = QAAP_AGENT_GOAL_LOOP_DEFAULT_BUDGET;
    const ceiling = QAAP_AGENT_GOAL_LOOP_BUDGET_CEILING;
    const maxIterations = clampPositiveInteger(partial?.maxIterations, defaults.maxIterations, ceiling.maxIterations);
    return {
        maxIterations,
        maxDurationMs: clampPositiveInteger(partial?.maxDurationMs, defaults.maxDurationMs, ceiling.maxDurationMs),
        // Defaults to maxIterations (one verdict per turn), not to the static default.
        maxEvaluatorCalls: clampPositiveInteger(partial?.maxEvaluatorCalls, maxIterations, ceiling.maxEvaluatorCalls),
        maxAgentRuntimeMs: clampPositiveInteger(partial?.maxAgentRuntimeMs, defaults.maxAgentRuntimeMs, ceiling.maxAgentRuntimeMs),
    };
}

/** Trimmed, bounded goal text; `undefined` when empty. */
export function normalizeGoalLoopGoal(goal: unknown): string | undefined {
    if (typeof goal !== 'string') {
        return undefined;
    }
    const trimmed = goal.trim();
    return trimmed ? trimmed.slice(0, MAX_GOAL_CHARS) : undefined;
}

/** Start guard. Returns a user-facing reason when the loop cannot start, else `undefined`. */
export function resolveGoalLoopStartRejection(
    conv: Pick<QaapAgentConversation, 'status' | 'autoApprove' | 'approvalPolicyId' | 'interactionModeId' | 'goalLoop'>,
    goal: string | undefined,
): string | undefined {
    if (!goal) {
        return 'A goal is required to start the loop.';
    }
    if (isGoalLoopActive(conv)) {
        return 'A goal loop is already running in this conversation.';
    }
    if (conv.autoApprove === false || conv.approvalPolicyId === 'request-approval') {
        return 'The goal loop needs auto-approve: it cannot run unattended while tool calls require manual approval.';
    }
    if (conv.interactionModeId === 'plan') {
        return 'The goal loop cannot run in plan mode: switch to agent mode first.';
    }
    if (conv.status === 'streaming') {
        return 'Wait for the current turn to finish (or stop it) before starting the goal loop.';
    }
    return undefined;
}

export function createGoalLoopState(options: {
    readonly goal: string;
    readonly budget: QaapAgentGoalLoopBudget;
    readonly anchorUserMessageId: string;
    readonly now: number;
}): QaapAgentGoalLoopState {
    return {
        phase: 'executing',
        goal: options.goal,
        startedAt: options.now,
        updatedAt: options.now,
        iteration: 1,
        anchorUserMessageId: options.anchorUserMessageId,
        currentTurnUserMessageId: options.anchorUserMessageId,
        budget: options.budget,
        usage: { evaluatorCalls: 0, agentRuntimeMs: 0 },
    };
}

export function finishGoalLoop(
    state: QaapAgentGoalLoopState,
    phase: 'completed' | 'blocked' | 'cancelled',
    stopReason: string | undefined,
    now: number,
): QaapAgentGoalLoopState {
    return {
        ...state,
        phase,
        updatedAt: now,
        finishedAt: now,
        ...(stopReason ? { stopReason } : {}),
    };
}

function formatMinutes(ms: number): string {
    const minutes = Math.round(ms / MINUTE_MS);
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function durationStopReason(state: QaapAgentGoalLoopState, now: number): string | undefined {
    if (now - state.startedAt >= state.budget.maxDurationMs) {
        return `Time budget exhausted: the loop ran for more than ${formatMinutes(state.budget.maxDurationMs)}.`;
    }
    return undefined;
}

/** Budget check before the loop starts another agent turn. */
export function resolveGoalLoopBudgetStopBeforeTurn(state: QaapAgentGoalLoopState, now: number): string | undefined {
    if (state.iteration >= state.budget.maxIterations) {
        return `Iteration budget exhausted: ${state.budget.maxIterations} agent turns ran without reaching the goal.`;
    }
    if (state.usage.agentRuntimeMs >= state.budget.maxAgentRuntimeMs) {
        return `Agent runtime budget exhausted: ${formatMinutes(state.budget.maxAgentRuntimeMs)} of agent time used.`;
    }
    return durationStopReason(state, now);
}

/** Budget check before the loop calls the evaluator. */
export function resolveGoalLoopBudgetStopBeforeEvaluator(state: QaapAgentGoalLoopState, now: number): string | undefined {
    if (state.usage.evaluatorCalls >= state.budget.maxEvaluatorCalls) {
        return `Evaluator budget exhausted: ${state.budget.maxEvaluatorCalls} evaluations ran without confirming the goal.`;
    }
    return durationStopReason(state, now);
}

/** Wall-clock check used by the periodic sweep (a turn may never settle). */
export function resolveGoalLoopDurationStop(state: QaapAgentGoalLoopState, now: number): string | undefined {
    return durationStopReason(state, now);
}

function tail(text: string, maxChars: number): string {
    const trimmed = text.trim();
    return trimmed.length > maxChars ? `…${trimmed.slice(trimmed.length - maxChars)}` : trimmed;
}

function iterationHeader(tag: string, state: QaapAgentGoalLoopState): string {
    return `[Goal · ${tag}] Iteration ${state.iteration + 1}/${state.budget.maxIterations}`;
}

/** Feedback prompt after the loop's turn failed. `state` is the state before the next iteration. */
export function buildGoalLoopTurnFailedPrompt(state: QaapAgentGoalLoopState, reason: string | undefined): string {
    return [
        iterationHeader('turn failed', state),
        '',
        `Goal: ${state.goal}`,
        '',
        'The previous turn ended with an error before the goal was reached:',
        tail(reason?.trim() || 'Unknown error.', 1_500),
        '',
        'Continue working toward the goal. Work around or fix what caused the failure; do not start over.',
    ].join('\n');
}

export function buildGoalLoopVerifyFailedPrompt(state: QaapAgentGoalLoopState, verify: QaapAgentGoalLoopVerifyResult): string {
    return [
        iterationHeader('verify failed', state),
        '',
        `Goal: ${state.goal}`,
        '',
        `The project checks failed after your last turn${verify.command ? ` (\`${verify.command}\`)` : ''}:`,
        '```',
        tail(verify.summary || 'No output captured.', QAAP_AGENT_GOAL_LOOP_VERIFY_LOG_TAIL_CHARS),
        '```',
        '',
        'Fix the failing check, then keep working toward the goal.',
    ].join('\n');
}

export function buildGoalLoopGapsPrompt(state: QaapAgentGoalLoopState, evaluation: QaapAgentGoalLoopEvaluation): string {
    const gaps = evaluation.gaps.length > 0
        ? evaluation.gaps.map(gap => `- ${gap}`)
        : ['- (the reviewer listed no specific gaps)'];
    return [
        iterationHeader('gaps remain', state),
        '',
        `Goal: ${state.goal}`,
        '',
        'An independent review says the goal is not met yet.',
        evaluation.reasoning.trim() ? `Reasoning: ${evaluation.reasoning.trim()}` : '',
        '',
        'Remaining gaps:',
        ...gaps,
        '',
        'Address these gaps.',
    ].filter((line, index, lines) => line !== '' || lines[index - 1] !== '').join('\n');
}

function messageExcerptText(message: QaapAgentMessage): string {
    const content = message.content?.trim() ?? '';
    if (content) {
        return content;
    }
    const text = (message.segments ?? [])
        .filter(segment => segment.type === 'text')
        .map(segment => (segment as { content: string }).content)
        .join('\n')
        .trim();
    return text;
}

/** Last {@link QAAP_AGENT_GOAL_LOOP_TRANSCRIPT_MESSAGES} messages, newest kept when over the char cap. */
export function buildGoalLoopTranscriptExcerpt(
    messages: readonly QaapAgentMessage[],
    maxMessages = QAAP_AGENT_GOAL_LOOP_TRANSCRIPT_MESSAGES,
    maxChars = QAAP_AGENT_GOAL_LOOP_TRANSCRIPT_MAX_CHARS,
): string {
    const recent = messages.slice(-maxMessages);
    const blocks: string[] = [];
    let used = 0;
    for (let index = recent.length - 1; index >= 0; index--) {
        const message = recent[index];
        const label = message.role === 'user' ? 'USER' : 'AGENT';
        const body = messageExcerptText(message) || '(no text)';
        const header = `### ${label}\n`;
        const room = maxChars - used - header.length;
        if (room < 2) {
            break;
        }
        const clipped = body.length > room ? `…${body.slice(body.length - room + 1)}` : body;
        const block = `${header}${clipped}`;
        blocks.unshift(block);
        used += block.length + 2;
    }
    return blocks.join('\n\n');
}

export function buildGoalLoopEvaluatorPrompt(options: {
    readonly goal: string;
    readonly verify: QaapAgentGoalLoopVerifyResult | undefined;
    readonly diffAdded?: number;
    readonly diffRemoved?: number;
    readonly transcriptExcerpt: string;
}): string {
    const verify = options.verify;
    const verifyLine = !verify
        ? 'not run'
        : verify.status === 'skipped'
            ? `skipped${verify.summary ? ` (${verify.summary})` : ''}`
            : `${verify.status}${verify.command ? ` (${verify.command})` : ''}`;
    const diffLine = options.diffAdded === undefined && options.diffRemoved === undefined
        ? 'unknown'
        : `+${options.diffAdded ?? 0} / -${options.diffRemoved ?? 0} lines`;
    return [
        'You are an independent reviewer deciding whether a coding agent has fully achieved a goal.',
        'You may read files in the repository to check, but do not modify anything.',
        '',
        '## Goal',
        options.goal,
        '',
        '## Automated checks',
        verifyLine,
        '',
        '## Working-tree diff',
        diffLine,
        '',
        '## Recent transcript',
        options.transcriptExcerpt || '(empty)',
        '',
        '## Answer',
        'Reply with JSON only, no prose and no code fence, exactly this shape:',
        '{"done": boolean, "confidence": "high" | "medium" | "low", "reasoning": string, "gaps": string[]}',
        '"done" is true only when every part of the goal is implemented and working. When it is false, list',
        'each concrete missing or broken piece in "gaps".',
    ].join('\n');
}

function coerceEvaluatorVerdict(value: unknown): Omit<QaapAgentGoalLoopEvaluation, 'source' | 'evaluatedAt'> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const record = value as Record<string, unknown>;
    if (typeof record.done !== 'boolean') {
        return undefined;
    }
    const confidence = record.confidence === 'high' || record.confidence === 'medium' || record.confidence === 'low'
        ? record.confidence
        : 'low';
    const reasoning = typeof record.reasoning === 'string' ? record.reasoning.trim().slice(0, 2_000) : '';
    const gaps = Array.isArray(record.gaps)
        ? record.gaps
            .filter((gap): gap is string => typeof gap === 'string' && gap.trim().length > 0)
            .map(gap => gap.trim().slice(0, 500))
            .slice(0, MAX_GAPS)
        : [];
    return { done: record.done, confidence, reasoning, gaps };
}

function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/** Balanced `{...}` substrings (string-aware), outermost first, in order of appearance. */
function findJsonObjectCandidates(text: string): string[] {
    const candidates: string[] = [];
    for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let index = start; index < text.length; index++) {
            const char = text[index];
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (char === '\\') {
                    escaped = true;
                } else if (char === '"') {
                    inString = false;
                }
                continue;
            }
            if (char === '"') {
                inString = true;
            } else if (char === '{') {
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0) {
                    candidates.push(text.slice(start, index + 1));
                    break;
                }
            }
        }
    }
    return candidates;
}

/**
 * Parses the evaluator's reply: bare JSON, a fenced ```json block, or a JSON object embedded in
 * prose. The last valid verdict wins (models tend to restate the final answer at the end).
 * Returns `undefined` when no valid verdict is found.
 */
export function parseGoalLoopEvaluatorResponse(
    raw: string | undefined,
    now: number = Date.now(),
): QaapAgentGoalLoopEvaluation | undefined {
    const text = raw?.trim();
    if (!text) {
        return undefined;
    }
    const attempts: string[] = [text];
    const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
    for (let match = fence.exec(text); match; match = fence.exec(text)) {
        attempts.push(match[1].trim());
    }
    attempts.push(...findJsonObjectCandidates(text));
    let verdict: Omit<QaapAgentGoalLoopEvaluation, 'source' | 'evaluatedAt'> | undefined;
    for (const attempt of attempts) {
        const parsed = coerceEvaluatorVerdict(tryParseJson(attempt));
        if (parsed) {
            verdict = parsed;
            if (attempt === text) {
                break;
            }
        }
    }
    return verdict ? { ...verdict, source: 'evaluator', evaluatedAt: now } : undefined;
}

/**
 * Deterministic verdict when the evaluator is unavailable or unparseable: green checks count as
 * done (low confidence); without checks nothing can be confirmed, so the runner stops as blocked.
 */
export function resolveGoalLoopFallbackEvaluation(
    verify: QaapAgentGoalLoopVerifyResult | undefined,
    detail: string | undefined,
    now: number,
): QaapAgentGoalLoopEvaluation {
    const why = detail?.trim() ? ` (${detail.trim().slice(0, 300)})` : '';
    if (verify?.status === 'passed') {
        return {
            done: true,
            confidence: 'low',
            reasoning: `The evaluator gave no usable verdict${why}; the project checks passed, so the goal is treated as done.`,
            gaps: [],
            source: 'fallback',
            evaluatedAt: now,
        };
    }
    return {
        done: false,
        confidence: 'low',
        reasoning: `The evaluator gave no usable verdict${why} and there are no project checks to confirm the goal.`,
        gaps: [],
        source: 'fallback',
        evaluatedAt: now,
    };
}

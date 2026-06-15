// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversation } from './qaap-agent-conversation';

/** Lifecycle of a backend closed loop attached to one conversation. */
export type QaapAgentGoalLoopPhase =
    /** Agent turn in flight (conversation streaming). */
    | 'executing'
    /** Shell verify checks running on the VPS. */
    | 'verifying'
    /** Separate evaluator pass (deterministic in PR1; LLM in PR2). */
    | 'evaluating'
    /** Stop: success. */
    | 'completed'
    /** Stop: budget / approval / missing verify scripts. */
    | 'blocked'
    /** User stopped the loop. */
    | 'cancelled';

export interface QaapAgentGoalLoopBudget {
    /** Max execute→verify cycles (default 8). */
    readonly maxIterations: number;
    /** Max wall-clock ms from {@link QaapAgentGoalLoopState.startedAt}. */
    readonly maxDurationMs: number;
    /** Optional cap on evaluator invocations. */
    readonly maxEvaluatorCalls?: number;
}

export interface QaapAgentGoalLoopVerifyConfig {
    /** When true, run package.json scripts after each successful agent turn. */
    readonly enabled: boolean;
    /** Extra shell commands (run after auto-resolved check). */
    readonly extraCommands?: ReadonlyArray<string>;
}

export interface QaapAgentGoalLoopVerifyCheckResult {
    readonly label: string;
    readonly command: string;
    readonly exitCode: number;
    readonly logTail: string;
    readonly durationMs: number;
}

export interface QaapAgentGoalLoopVerifySnapshot {
    readonly at: number;
    readonly allGreen: boolean;
    readonly results: ReadonlyArray<QaapAgentGoalLoopVerifyCheckResult>;
}

export interface QaapAgentGoalLoopEvaluation {
    readonly at: number;
    readonly done: boolean;
    readonly confidence: 'high' | 'medium' | 'low';
    readonly reasoning: string;
    readonly gaps?: ReadonlyArray<string>;
}

export interface QaapAgentGoalLoopState {
    readonly phase: QaapAgentGoalLoopPhase;
    /** Natural-language done condition (shown to evaluator in PR2). */
    readonly goal: string;
    readonly startedAt: number;
    readonly updatedAt: number;
    /** Completed execute→verify cycles (incremented after verify failure or agent turn failure). */
    readonly iteration: number;
    readonly budget: QaapAgentGoalLoopBudget;
    readonly verify: QaapAgentGoalLoopVerifyConfig;
    /** Id of the user message that started the loop. */
    readonly anchorUserMessageId: string;
    readonly lastVerify?: QaapAgentGoalLoopVerifySnapshot;
    readonly lastEvaluation?: QaapAgentGoalLoopEvaluation;
    readonly stopReason?: string;
    readonly evaluatorCalls?: number;
}

export interface QaapStartAgentGoalLoopRequest {
    readonly goal: string;
    readonly budget?: Partial<QaapAgentGoalLoopBudget>;
    readonly verify?: Partial<QaapAgentGoalLoopVerifyConfig>;
    /** When set, used as the first user message; {@link goal} still drives evaluation. */
    readonly initialPrompt?: string;
}

export interface QaapAgentGoalLoopStatusResponse {
    readonly conversationId: string;
    readonly goalLoop: QaapAgentGoalLoopState | undefined;
}

export interface QaapGoalLoopEvaluatorInput {
    readonly goal: string;
    readonly verify: QaapAgentGoalLoopVerifySnapshot;
    readonly transcriptExcerpt: string;
    readonly gitDiffSummary?: { readonly added: number; readonly removed: number };
}

export const QAAP_GOAL_LOOP_DEFAULT_BUDGET: QaapAgentGoalLoopBudget = {
    maxIterations: 8,
    maxDurationMs: 2 * 60 * 60 * 1000,
    maxEvaluatorCalls: 16,
};

export const QAAP_GOAL_LOOP_DEFAULT_VERIFY: QaapAgentGoalLoopVerifyConfig = {
    enabled: true,
};

/** Prefix on auto-generated user turns that feed verify failures back to the agent. */
export const GOAL_LOOP_VERIFY_PREFIX = '[Goal · verify failed]';

/** Prefix on auto-generated user turns when the evaluator reports remaining gaps (PR2). */
export const GOAL_LOOP_EVAL_PREFIX = '[Goal · gaps remain]';

/** Prefix on system-facing goal loop status lines in the transcript. */
export const GOAL_LOOP_SYSTEM_PREFIX = '[Goal · loop]';

export function mergeGoalLoopBudget(partial?: Partial<QaapAgentGoalLoopBudget>): QaapAgentGoalLoopBudget {
    return {
        maxIterations: partial?.maxIterations ?? QAAP_GOAL_LOOP_DEFAULT_BUDGET.maxIterations,
        maxDurationMs: partial?.maxDurationMs ?? QAAP_GOAL_LOOP_DEFAULT_BUDGET.maxDurationMs,
        maxEvaluatorCalls: partial?.maxEvaluatorCalls ?? QAAP_GOAL_LOOP_DEFAULT_BUDGET.maxEvaluatorCalls,
    };
}

export function mergeGoalLoopVerify(partial?: Partial<QaapAgentGoalLoopVerifyConfig>): QaapAgentGoalLoopVerifyConfig {
    return {
        enabled: partial?.enabled ?? QAAP_GOAL_LOOP_DEFAULT_VERIFY.enabled,
        ...(partial?.extraCommands?.length ? { extraCommands: [...partial.extraCommands] } : {}),
    };
}

export function isGoalLoopActive(state: QaapAgentGoalLoopState | undefined): boolean {
    return !!state
        && state.phase !== 'completed'
        && state.phase !== 'blocked'
        && state.phase !== 'cancelled';
}

export function isGoalLoopBudgetExceeded(state: QaapAgentGoalLoopState, now = Date.now()): boolean {
    if (state.iteration >= state.budget.maxIterations) {
        return true;
    }
    return now - state.startedAt >= state.budget.maxDurationMs;
}

export function assertGoalLoopCanStart(conv: QaapAgentConversation): void {
    if (conv.autoApprove === false) {
        throw new Error('Goal loop requires auto-approve — manual tool approvals would stall unattended runs.');
    }
    if (conv.paused) {
        throw new Error('Conversation is paused.');
    }
    if (conv.interactionModeId === 'plan') {
        throw new Error('Goal loop requires agent mode, not plan-only.');
    }
    if (isGoalLoopActive(conv.goalLoop)) {
        throw new Error('A goal loop is already active for this conversation.');
    }
}

/** PR1: verify-only gate. PR2 replaces this with an LLM evaluator that reads {@link goal}. */
export function evaluateGoalLoopDeterministic(input: QaapGoalLoopEvaluatorInput): QaapAgentGoalLoopEvaluation {
    const failed = input.verify.results.filter(result => result.exitCode !== 0);
    const done = input.verify.allGreen;
    return {
        at: Date.now(),
        done,
        confidence: done ? 'high' : 'low',
        reasoning: done
            ? 'All verify checks passed (deterministic evaluator — PR2 will also judge the natural-language goal).'
            : `Verify failed: ${failed.map(result => result.label).join(', ') || 'unknown'}.`,
        gaps: done ? undefined : failed.map(result => `${result.label} (exit ${result.exitCode})`),
    };
}

export function buildGoalLoopInitialPrompt(goal: string, initialPrompt?: string): string {
    const trimmedGoal = goal.trim();
    if (initialPrompt?.trim()) {
        return initialPrompt.trim();
    }
    return [
        `${GOAL_LOOP_SYSTEM_PREFIX} Run until done.`,
        '',
        `**Goal:** ${trimmedGoal}`,
        '',
        'Work autonomously: implement the change, run relevant verification, and iterate until the goal is met.',
        'Do not stop with planning-only output — make concrete progress each turn.',
    ].join('\n');
}

export function buildGoalLoopVerifyFailurePrompt(
    goal: string,
    snapshot: QaapAgentGoalLoopVerifySnapshot,
): string {
    const failed = snapshot.results.filter(result => result.exitCode !== 0);
    const lines = [
        GOAL_LOOP_VERIFY_PREFIX,
        '',
        `Goal: ${goal.trim()}`,
        '',
        'Verification failed. Fix these checks and continue toward the goal:',
        '',
        ...failed.map(result => [
            `### ${result.label} — \`${result.command}\` (exit ${result.exitCode})`,
            result.logTail || '(no log output)',
        ].join('\n')),
    ];
    return lines.join('\n');
}

export function buildGoalLoopTurnFailurePrompt(goal: string, reason: string): string {
    return [
        `${GOAL_LOOP_SYSTEM_PREFIX} Agent turn failed.`,
        '',
        `Goal: ${goal.trim()}`,
        '',
        `Previous turn error: ${reason.trim()}`,
        '',
        'Retry with a corrected approach. Do not repeat the same failing strategy.',
    ].join('\n');
}

export function buildGoalLoopEvalGapPrompt(goal: string, evaluation: QaapAgentGoalLoopEvaluation): string {
    const gaps = evaluation.gaps?.length
        ? evaluation.gaps.map(gap => `- ${gap}`).join('\n')
        : '- Goal not fully met yet.';
    return [
        GOAL_LOOP_EVAL_PREFIX,
        '',
        `Goal: ${goal.trim()}`,
        '',
        `Evaluator: ${evaluation.reasoning}`,
        '',
        'Address these remaining gaps:',
        gaps,
    ].join('\n');
}

export function buildGoalLoopEvaluatorPrompt(input: QaapGoalLoopEvaluatorInput): string {
    const verifyLines = input.verify.results.length > 0
        ? input.verify.results.map(result => `- ${result.label}: exit ${result.exitCode}`).join('\n')
        : '- (no verify commands ran)';
    const diff = input.gitDiffSummary
        ? `Diff: +${input.gitDiffSummary.added} / -${input.gitDiffSummary.removed} lines.`
        : '';
    return [
        'You are a strict goal-completion evaluator for a coding agent loop.',
        'Read-only — do not suggest running tools or editing files yourself.',
        'Reply with a single JSON object only (no markdown fences):',
        '{"done":boolean,"confidence":"high"|"medium"|"low","reasoning":string,"gaps":string[]}',
        '',
        `GOAL: ${input.goal.trim()}`,
        '',
        `VERIFY_ALL_GREEN: ${input.verify.allGreen}`,
        'VERIFY_RESULTS:',
        verifyLines,
        diff,
        '',
        'TRANSCRIPT_EXCERPT:',
        input.transcriptExcerpt.trim() || '(empty)',
        '',
        'Judge whether the GOAL is fully satisfied given verify results and transcript evidence.',
        'If verify failed, done must be false. If verify passed but the goal mentions scope beyond tests, check the transcript.',
    ].join('\n');
}

export interface ParsedGoalLoopEvaluatorResponse {
    readonly done: boolean;
    readonly confidence: QaapAgentGoalLoopEvaluation['confidence'];
    readonly reasoning: string;
    readonly gaps?: ReadonlyArray<string>;
}

/** Extract evaluator JSON from a one-shot LLM reply. */
export function parseGoalLoopEvaluatorResponse(text: string): ParsedGoalLoopEvaluatorResponse | undefined {
    const trimmed = text.trim();
    if (!trimmed) {
        return undefined;
    }
    const candidates = [trimmed];
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) {
        candidates.unshift(fence[1].trim());
    }
    const brace = trimmed.match(/\{[\s\S]*\}/);
    if (brace?.[0]) {
        candidates.push(brace[0]);
    }
    for (const candidate of candidates) {
        try {
            const parsed = JSON.parse(candidate) as {
                done?: unknown;
                confidence?: unknown;
                reasoning?: unknown;
                gaps?: unknown;
            };
            if (typeof parsed.done !== 'boolean' || typeof parsed.reasoning !== 'string') {
                continue;
            }
            const confidence = parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
                ? parsed.confidence
                : parsed.done ? 'high' : 'medium';
            const gaps = Array.isArray(parsed.gaps)
                ? parsed.gaps.filter((gap): gap is string => typeof gap === 'string' && gap.trim().length > 0)
                : undefined;
            return {
                done: parsed.done,
                confidence,
                reasoning: parsed.reasoning.trim(),
                gaps: gaps?.length ? gaps : undefined,
            };
        } catch {
            /* try next candidate */
        }
    }
    return undefined;
}

export function isGoalLoopPhaseActive(phase: QaapAgentGoalLoopPhase | undefined): boolean {
    return phase === 'executing' || phase === 'verifying' || phase === 'evaluating';
}

export function localizeGoalLoopPhase(phase: QaapAgentGoalLoopPhase | undefined): string | undefined {
    switch (phase) {
        case 'executing':
            return 'Executing';
        case 'verifying':
            return 'Verifying';
        case 'evaluating':
            return 'Evaluating';
        case 'completed':
            return 'Done';
        case 'blocked':
            return 'Blocked';
        case 'cancelled':
            return 'Cancelled';
        default:
            return undefined;
    }
}

export function excerptGoalLoopTranscript(messages: ReadonlyArray<{ readonly role: string; readonly content: string }>, maxChars = 12_000): string {
    const tail = messages.slice(-8);
    const joined = tail.map(message => `[${message.role}] ${message.content}`).join('\n\n');
    if (joined.length <= maxChars) {
        return joined;
    }
    return `…(${joined.length - maxChars} chars truncated)\n${joined.slice(-maxChars)}`;
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { formatTranscriptStreamElapsed } from './qaap-transcript-stream-status';

/**
 * Pure (common) data model for the auto-researcher v1: an agent that proposes an experiment,
 * a runner (node/) that executes it and measures the result, and a ledger that feeds the next
 * round's prompt so the agent never repeats a config it already tried.
 *
 * This file only defines the goal shape and its normalization. See {@link ../qaap-research-ledger}
 * for the experiment record, and {@link ../qaap-research-prompt} for the round prompt builder.
 */

export type MetricDirection = 'max' | 'min';

/**
 * One metric the runner measures after each round. v1 only *enforces* the primary metric
 * (target / termination); the array shape exists so a v2 guard-rail metric (e.g. "don't regress
 * eval latency while chasing accuracy") can be added without a breaking change.
 */
export interface ResearchMetricSpec {
    readonly name: string;
    readonly direction: MetricDirection;
    /** Shell command that prints a number; the RUNNER executes it, never the agent. */
    readonly metricCommand: string;
    readonly target?: number;
    /** v1 only imposes termination/target semantics on the metric marked primary. */
    readonly primary?: boolean;
    /** Optional regex (with a capture group) used to pull the number out of metricCommand's stdout. */
    readonly metricRegex?: string;
    /** Optional JSON path (dot / bracket notation) used when metricCommand's stdout is JSON. */
    readonly metricJsonPath?: string;
    /** Minimum delta (in the metric's own units) required to call a round an improvement. Default 0. */
    readonly minImprovement?: number;
}

/**
 * Why an auto-researcher loop stopped. Kept here (not in the ledger module) because it is a
 * property of the goal itself; {@link ../qaap-research-ledger}'s `resolveTerminationReason`
 * imports it as a type-only dependency to avoid a value-level cycle between the two modules.
 */
export type TerminationReason = 'reached-target' | 'budget-exhausted' | 'stagnated' | 'infra-broken' | 'cancelled';

export type ResearchGoalStatus = 'running' | 'completed' | 'cancelled' | 'failed';

/**
 * Explicit model binding for a goal's propose turns. When set, this WINS over whatever the task
 * runner would otherwise route to from the caller's Settings model aliases (see
 * `resolveEffectiveRequestAgentModel` in `qaap-cloud-workspace`'s `qaap-agent-task-model-routing.ts`)
 * — the exact bypass the auto-researcher needs, since alias routing picks per-task-kind models
 * (e.g. NVIDIA/meta-llama) that a `claude` CLI agent can never spawn with.
 */
export interface ResearchAgentModel {
    readonly provider: string;
    readonly vendor?: string;
    readonly modelId: string;
}

export interface ResearchGoal {
    readonly id: string;
    readonly cwd: string;
    readonly agentId?: string;
    /** The goal in words, shown to the agent verbatim in every round prompt. */
    readonly description: string;
    /** Explicit model for propose turns; see {@link ResearchAgentModel}. Optional — omit to keep
     *  today's Settings-alias routing behaviour. */
    readonly agentModel?: ResearchAgentModel;
    /** The long-running work (can take hours), e.g. a training run. Optional: some goals only measure. */
    readonly runCommand?: string;
    /** Timeout for `runCommand`. Defaults to a generous multi-hour budget. */
    readonly runTimeoutMs: number;
    readonly metrics: readonly ResearchMetricSpec[];
    /** Hard cap on experiment rounds. Always set by {@link normalizeResearchGoal}. */
    readonly maxRounds: number;
    readonly deadlineAt?: number;
    /** Consecutive non-improving rounds (excluding infra failures) before giving up. Default 3. */
    readonly stagnationRounds: number;
    /** Consecutive infra failures (run/measure broke, not a bad hypothesis) before giving up. Default 3. */
    readonly infraFailureLimit: number;
    readonly createdAt: number;
    /** Wall-clock start of the current running session (create or replay). */
    readonly startedAt?: number;
    /** Wall-clock end when the goal leaves `running`. */
    readonly finishedAt?: number;
    readonly status: ResearchGoalStatus;
    readonly terminationReason?: TerminationReason;
}

/** Generous multi-hour default for the long-running `runCommand` (4 hours). */
export const DEFAULT_RESEARCH_RUN_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export const MIN_RESEARCH_RUN_TIMEOUT_MS = 60_000;

export const MAX_RESEARCH_RUN_TIMEOUT_MS = DEFAULT_RESEARCH_RUN_TIMEOUT_MS;

export const DEFAULT_RESEARCH_STAGNATION_ROUNDS = 3;

export const DEFAULT_RESEARCH_INFRA_FAILURE_LIMIT = 3;

export const DEFAULT_RESEARCH_MAX_ROUNDS = 20;

export const MIN_RESEARCH_MAX_ROUNDS = 1;

export const MAX_RESEARCH_MAX_ROUNDS = 50;

export const MIN_RESEARCH_STAGNATION_ROUNDS = 1;

export const MAX_RESEARCH_STAGNATION_ROUNDS = 100;

export const MIN_RESEARCH_INFRA_FAILURE_LIMIT = 1;

export const MAX_RESEARCH_INFRA_FAILURE_LIMIT = 100;

export const MAX_RESEARCH_METRICS = 5;

export const MAX_RESEARCH_COMMAND_CHARS = 16_384;

/** Wall-clock deadline may be at most 7 days ahead of normalize time. */
export const MAX_RESEARCH_DEADLINE_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;

function requireBoundedInteger(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number,
    label: string,
): number {
    const candidate = value === undefined ? fallback : value;
    if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) {
        throw new Error(`${label} must be an integer between ${min} and ${max}.`);
    }
    return candidate;
}

function requireCommand(value: string | undefined, label: string): string {
    const trimmed = value?.trim() ?? '';
    if (!trimmed) {
        throw new Error(`${label} is required.`);
    }
    if (trimmed.length > MAX_RESEARCH_COMMAND_CHARS) {
        throw new Error(`${label} exceeds the maximum length of ${MAX_RESEARCH_COMMAND_CHARS} characters.`);
    }
    return trimmed;
}

/**
 * Fills in defaults and validates a research goal. Exactly one metric ends up `primary: true`:
 * if the caller marked none, the first metric becomes primary; if the caller marked more than
 * one, this throws rather than silently guessing which one the agent's termination logic should
 * follow.
 */
export function researchGoalCwdBasename(cwd: string): string {
    const parts = cwd.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? cwd;
}

export function resolveResearchGoalStartedAt(goal: ResearchGoal): number | undefined {
    if (goal.startedAt !== undefined) {
        return goal.startedAt;
    }
    if (goal.status === 'running') {
        return goal.createdAt;
    }
    return undefined;
}

export function resolveResearchGoalActiveElapsedMs(goal: ResearchGoal, nowMs = Date.now()): number | undefined {
    const startedAt = resolveResearchGoalStartedAt(goal);
    if (startedAt === undefined) {
        return undefined;
    }
    const endMs = goal.status === 'running' ? nowMs : goal.finishedAt;
    if (endMs === undefined) {
        return undefined;
    }
    return Math.max(0, endMs - startedAt);
}

export function formatResearchGoalActiveDuration(goal: ResearchGoal, nowMs = Date.now()): string | undefined {
    const elapsedMs = resolveResearchGoalActiveElapsedMs(goal, nowMs);
    if (elapsedMs === undefined) {
        return undefined;
    }
    return formatTranscriptStreamElapsed(elapsedMs);
}

export function filterResearchGoalsByQuery(goals: readonly ResearchGoal[], query: string): ResearchGoal[] {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return [...goals];
    }
    return goals.filter(goal =>
        goal.description.toLowerCase().includes(normalized)
        || goal.cwd.toLowerCase().includes(normalized)
        || researchGoalCwdBasename(goal.cwd).toLowerCase().includes(normalized),
    );
}

export function normalizeResearchGoal(input: Partial<ResearchGoal>): ResearchGoal {
    if (!input.id) {
        throw new Error('ResearchGoal requires an id.');
    }
    if (!input.cwd) {
        throw new Error('ResearchGoal requires a cwd.');
    }
    if (!input.description) {
        throw new Error('ResearchGoal requires a description.');
    }
    if (!input.metrics || input.metrics.length === 0) {
        throw new Error('ResearchGoal requires at least one metric.');
    }
    if (input.metrics.length > MAX_RESEARCH_METRICS) {
        throw new Error(`ResearchGoal supports at most ${MAX_RESEARCH_METRICS} metrics.`);
    }
    if (input.agentModel && (!input.agentModel.provider?.trim() || !input.agentModel.modelId?.trim())) {
        throw new Error('ResearchGoal.agentModel requires a non-empty provider and modelId.');
    }

    const primaryCount = input.metrics.filter(metric => metric.primary).length;
    if (primaryCount > 1) {
        throw new Error('ResearchGoal must have exactly one primary metric, found more than one.');
    }
    const metrics = input.metrics.map((metric, index) => {
        const name = metric.name?.trim();
        if (!name) {
            throw new Error('ResearchGoal metrics require a non-empty name.');
        }
        if (metric.direction !== 'max' && metric.direction !== 'min') {
            throw new Error(`ResearchGoal metric "${name}" requires direction "max" or "min".`);
        }
        return {
            ...metric,
            name,
            metricCommand: requireCommand(metric.metricCommand, `ResearchGoal metric "${name}" metricCommand`),
            primary: primaryCount === 1 ? !!metric.primary : index === 0,
            minImprovement: metric.minImprovement ?? 0,
        };
    });

    const runCommand = input.runCommand === undefined || input.runCommand === ''
        ? undefined
        : requireCommand(input.runCommand, 'ResearchGoal.runCommand');

    const createdAt = input.createdAt ?? Date.now();
    const status = input.status ?? 'running';
    const startedAt = input.startedAt ?? (status === 'running' ? createdAt : undefined);

    let deadlineAt = input.deadlineAt;
    if (deadlineAt !== undefined) {
        if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= 0) {
            throw new Error('ResearchGoal.deadlineAt must be a positive integer timestamp.');
        }
        if (deadlineAt > Date.now() + MAX_RESEARCH_DEADLINE_AHEAD_MS) {
            throw new Error(`ResearchGoal.deadlineAt cannot be more than ${MAX_RESEARCH_DEADLINE_AHEAD_MS}ms ahead.`);
        }
    }

    return {
        id: input.id,
        cwd: input.cwd,
        agentId: input.agentId,
        description: input.description,
        agentModel: input.agentModel,
        runCommand,
        runTimeoutMs: requireBoundedInteger(
            input.runTimeoutMs,
            DEFAULT_RESEARCH_RUN_TIMEOUT_MS,
            MIN_RESEARCH_RUN_TIMEOUT_MS,
            MAX_RESEARCH_RUN_TIMEOUT_MS,
            'ResearchGoal.runTimeoutMs',
        ),
        metrics,
        maxRounds: requireBoundedInteger(
            input.maxRounds,
            DEFAULT_RESEARCH_MAX_ROUNDS,
            MIN_RESEARCH_MAX_ROUNDS,
            MAX_RESEARCH_MAX_ROUNDS,
            'ResearchGoal.maxRounds',
        ),
        deadlineAt,
        stagnationRounds: requireBoundedInteger(
            input.stagnationRounds,
            DEFAULT_RESEARCH_STAGNATION_ROUNDS,
            MIN_RESEARCH_STAGNATION_ROUNDS,
            MAX_RESEARCH_STAGNATION_ROUNDS,
            'ResearchGoal.stagnationRounds',
        ),
        infraFailureLimit: requireBoundedInteger(
            input.infraFailureLimit,
            DEFAULT_RESEARCH_INFRA_FAILURE_LIMIT,
            MIN_RESEARCH_INFRA_FAILURE_LIMIT,
            MAX_RESEARCH_INFRA_FAILURE_LIMIT,
            'ResearchGoal.infraFailureLimit',
        ),
        createdAt,
        startedAt,
        finishedAt: input.finishedAt,
        status,
        terminationReason: input.terminationReason,
    };
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { MetricDirection, ResearchGoal, ResearchMetricSpec, TerminationReason } from './qaap-research-goal';

export type { TerminationReason } from './qaap-research-goal';

export interface ResearchMetricValue {
    readonly name: string;
    readonly value: number;
    readonly direction: MetricDirection;
}

export type ExperimentPhase = 'propose' | 'run' | 'measure' | 'done';

/**
 * `noop` is distinct from `neutral`: `neutral` means the round ran to completion and measured a
 * result that tied the best-so-far; `noop` means the agent's turn produced nothing to run or
 * measure at all (no repo changes, no parseable proposal — see `finishAsNoop` in
 * `qaap-research-runner.ts`). Both count toward stagnation (see {@link trailingStagnationCount}) —
 * a stalled agent is exactly as much "no progress" as one proposing bad hypotheses — but they are
 * kept as separate verdicts so the ledger UI/prompt can tell an operator which one happened.
 */
export type ExperimentVerdict = 'improved' | 'regressed' | 'neutral' | 'failed' | 'noop';

/**
 * One row of the experiment ledger. `symptom` / `hypothesis` / `lever` / `config` come from the
 * AGENT's proposal (see {@link parseExperimentProposal}); everything else is filled in by the
 * runner as the round progresses through its phases.
 */
export interface ResearchExperimentRecord {
    readonly id: string;
    readonly goalId: string;
    readonly round: number;
    readonly startedAt: number;
    readonly finishedAt?: number;
    readonly symptom?: string;
    readonly hypothesis: string;
    readonly lever?: string;
    readonly config: Record<string, unknown>;
    readonly configFingerprint: string;
    readonly sha?: string;
    readonly baselineSha?: string;
    readonly phase: ExperimentPhase;
    readonly metrics: readonly ResearchMetricValue[];
    readonly verdict?: ExperimentVerdict;
    readonly delta?: number;
    readonly bestSoFar?: number;
    readonly reverted?: boolean;
    readonly notes?: string;
    readonly runAttempts?: number;
}

/**
 * Marker the agent ends its reply with when proposing the next experiment, mirroring the
 * `[QAAP capture]` / `[QAAP record]` directive convention in `qaap-visual-verification.ts`.
 */
export const QAAP_EXPERIMENT_MARKER = '[QAAP experiment]';

const EXPERIMENT_BLOCK_REGEX = /\[qaap\s*experiment\]\s*```json\s*([\s\S]*?)```/i;

/**
 * Parses the agent's `[QAAP experiment]` proposal out of its settled reply. Never throws: an
 * absent or malformed block simply yields `undefined` so the runner can fall back (e.g. re-prompt
 * or reuse the last hypothesis) instead of crashing the loop.
 */
export function parseExperimentProposal(stdout: string):
    { symptom?: string; hypothesis: string; lever?: string; config: Record<string, unknown> } | undefined {
    const match = EXPERIMENT_BLOCK_REGEX.exec(stdout);
    if (!match) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(match[1]);
    } catch {
        return undefined;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return undefined;
    }
    const record = parsed as Record<string, unknown>;
    const hypothesis = record.hypothesis;
    if (typeof hypothesis !== 'string' || hypothesis.trim().length === 0) {
        return undefined;
    }
    const config = record.config;
    const normalizedConfig = (typeof config === 'object' && config !== null && !Array.isArray(config))
        ? config as Record<string, unknown>
        : {};
    const symptom = typeof record.symptom === 'string' ? record.symptom : undefined;
    const lever = typeof record.lever === 'string' ? record.lever : undefined;
    return { symptom, hypothesis, lever, config: normalizedConfig };
}

/** Canonical JSON: object keys sorted recursively so key order never changes the fingerprint. */
function canonicalJson(value: unknown): string {
    if (value === undefined) {
        return 'null';
    }
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
        .sort()
        .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
}

/** Deterministic FNV-1a (32-bit) hash, hex-encoded. Pure JS on purpose: this is common/, no node crypto. */
function fnv1aHex(input: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index++) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Stable fingerprint for a config object: same content, in any key order, hashes identically. */
export function configFingerprint(config: Record<string, unknown>): string {
    return fnv1aHex(canonicalJson(config));
}

/** Compact markdown table for the round prompt: round | hypothesis | lever | metrics | verdict. */
export function renderLedgerForPrompt(records: readonly ResearchExperimentRecord[], opts?: { readonly maxRows?: number }): string {
    if (records.length === 0) {
        return 'No experiments recorded yet.';
    }
    const maxRows = opts?.maxRows;
    const shown = maxRows !== undefined && records.length > maxRows ? records.slice(-maxRows) : records;
    const omitted = records.length - shown.length;
    const header = '| Round | Hypothesis | Lever | Metrics | Verdict |\n| --- | --- | --- | --- | --- |';
    const rows = shown.map(record => {
        const metrics = record.metrics.length > 0
            ? record.metrics.map(metric => `${metric.name}=${metric.value}`).join(', ')
            : '—';
        return `| ${record.round} | ${record.hypothesis} | ${record.lever ?? '—'} | ${metrics} | ${record.verdict ?? 'pending'} |`;
    });
    const truncationNote = omitted > 0 ? `_(${omitted} earlier round${omitted === 1 ? '' : 's'} omitted)_\n\n` : '';
    return `${truncationNote}${header}\n${rows.join('\n')}`;
}

const TRAILING_FLOAT_REGEX = /-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g;

function lastFloatInStdout(stdout: string): number | undefined {
    let lastMatch: string | undefined;
    for (const match of stdout.matchAll(TRAILING_FLOAT_REGEX)) {
        lastMatch = match[0];
    }
    if (lastMatch === undefined) {
        return undefined;
    }
    const value = Number(lastMatch);
    return Number.isFinite(value) ? value : undefined;
}

/** Resolves a (possibly nested) dot/bracket JSON path, e.g. `result.metrics[0].value`. */
function resolveJsonPath(value: unknown, path: string): unknown {
    const tokens = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(token => token.length > 0);
    let current: unknown = value;
    for (const token of tokens) {
        if (current === undefined || current === null || typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[token];
    }
    return current;
}

/**
 * Extracts the metric's numeric value from the runner's metricCommand stdout. Priority:
 * `metricJsonPath` (structured, most specific) → `metricRegex` (capture group) → the LAST float
 * printed (training/eval scripts print progress on every line; the final one is the result).
 * Returns `undefined`, never throws, when the value cannot be parsed.
 */
export function parseMetricFromStdout(stdout: string, spec: ResearchMetricSpec): number | undefined {
    if (spec.metricJsonPath) {
        try {
            const parsed: unknown = JSON.parse(stdout);
            const resolved = resolveJsonPath(parsed, spec.metricJsonPath);
            const value = typeof resolved === 'number' ? resolved : Number(resolved);
            return Number.isFinite(value) ? value : undefined;
        } catch {
            return undefined;
        }
    }
    if (spec.metricRegex) {
        let match: RegExpExecArray | null;
        try {
            match = new RegExp(spec.metricRegex).exec(stdout);
        } catch {
            return undefined;
        }
        if (!match) {
            return undefined;
        }
        const captured = match[1] ?? match[0];
        const value = Number(captured);
        return Number.isFinite(value) ? value : undefined;
    }
    return lastFloatInStdout(stdout);
}

/**
 * Compares a fresh measurement against the running best. `direction` and `minImprovement`
 * (default 0) decide the verdict; the first-ever measurement (no `best` yet) always counts as
 * `improved` since it establishes the baseline.
 */
export function evaluateVerdict(
    value: number,
    best: number | undefined,
    spec: ResearchMetricSpec,
): { verdict: ExperimentVerdict; delta: number } {
    if (best === undefined) {
        return { verdict: 'improved', delta: 0 };
    }
    const minImprovement = spec.minImprovement ?? 0;
    const delta = spec.direction === 'max' ? value - best : best - value;
    if (delta > minImprovement) {
        return { verdict: 'improved', delta };
    }
    if (delta < -minImprovement) {
        return { verdict: 'regressed', delta };
    }
    return { verdict: 'neutral', delta };
}

function countTrailingConsecutive<T>(records: readonly T[], predicate: (record: T) => boolean): number {
    let count = 0;
    for (let index = records.length - 1; index >= 0; index--) {
        if (!predicate(records[index])) {
            break;
        }
        count++;
    }
    return count;
}

/**
 * Consecutive infra failures (run/measure broke: exit code, unparseable metric) counted from
 * the tail. Kept strictly separate from stagnation — see the module-level note on why.
 */
function trailingInfraFailureCount(records: readonly ResearchExperimentRecord[]): number {
    return countTrailingConsecutive(records, record => record.verdict === 'failed');
}

/**
 * Consecutive non-improving rounds counted from the tail, IGNORING infra failures entirely (they
 * neither extend nor break the streak — a CUDA OOM round says nothing about hypothesis quality).
 */
function trailingStagnationCount(records: readonly ResearchExperimentRecord[]): number {
    const withoutInfraFailures = records.filter(record => record.verdict !== undefined && record.verdict !== 'failed');
    return countTrailingConsecutive(withoutInfraFailures, record => record.verdict !== 'improved');
}

function bestPrimaryValue(records: readonly ResearchExperimentRecord[], primary: ResearchMetricSpec): number | undefined {
    const values = records
        .map(record => record.metrics.find(metric => metric.name === primary.name)?.value)
        .filter((value): value is number => value !== undefined);
    if (values.length === 0) {
        return undefined;
    }
    return primary.direction === 'max' ? Math.max(...values) : Math.min(...values);
}

/**
 * Pure termination check, re-evaluated after every round. Returns `undefined` while the loop
 * should keep going. Checked in this order: reached-target, budget-exhausted, infra-broken,
 * stagnated — an explicit cancellation (`goal.status === 'cancelled'`) short-circuits all of it.
 *
 * `failed` (infra broke) and `regressed` (ran fine, measured worse) are NEVER collapsed: they
 * feed separate trailing counters (`infraFailureLimit` vs `stagnationRounds`) so an infra outage
 * cannot be misread as "the agent keeps proposing bad hypotheses" and vice versa.
 */
export function resolveTerminationReason(
    goal: ResearchGoal,
    records: readonly ResearchExperimentRecord[],
    now: number,
): TerminationReason | undefined {
    if (goal.status === 'cancelled') {
        return 'cancelled';
    }

    const primary = goal.metrics.find(metric => metric.primary);
    if (primary?.target !== undefined) {
        const best = bestPrimaryValue(records, primary);
        if (best !== undefined) {
            const reached = primary.direction === 'max' ? best >= primary.target : best <= primary.target;
            if (reached) {
                return 'reached-target';
            }
        }
    }

    if (goal.maxRounds !== undefined && records.length >= goal.maxRounds) {
        return 'budget-exhausted';
    }
    if (goal.deadlineAt !== undefined && now >= goal.deadlineAt) {
        return 'budget-exhausted';
    }

    if (trailingInfraFailureCount(records) >= goal.infraFailureLimit) {
        return 'infra-broken';
    }

    if (trailingStagnationCount(records) >= goal.stagnationRounds) {
        return 'stagnated';
    }

    return undefined;
}

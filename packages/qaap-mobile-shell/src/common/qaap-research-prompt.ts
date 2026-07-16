// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { ResearchGoal, ResearchMetricSpec } from './qaap-research-goal';
import { QAAP_EXPERIMENT_MARKER, renderLedgerForPrompt, type ResearchExperimentRecord } from './qaap-research-ledger';

function findPrimaryMetric(goal: ResearchGoal): ResearchMetricSpec {
    return goal.metrics.find(metric => metric.primary) ?? goal.metrics[0];
}

function bestPrimaryResult(
    records: readonly ResearchExperimentRecord[],
    primary: ResearchMetricSpec,
): { readonly value: number; readonly round: number } | undefined {
    let best: { value: number; round: number } | undefined;
    for (const record of records) {
        const value = record.metrics.find(metric => metric.name === primary.name)?.value;
        if (value === undefined) {
            continue;
        }
        const better = best === undefined || (primary.direction === 'max' ? value > best.value : value < best.value);
        if (better) {
            best = { value, round: record.round };
        }
    }
    return best;
}

function renderGoalSection(goal: ResearchGoal, records: readonly ResearchExperimentRecord[], primary: ResearchMetricSpec): string {
    const best = bestPrimaryResult(records, primary);
    const roundsRemaining = goal.maxRounds !== undefined
        ? `${Math.max(goal.maxRounds - records.length, 0)} of ${goal.maxRounds}`
        : 'unbounded';
    return [
        '## Research goal',
        '',
        goal.description,
        '',
        `- Primary metric: **${primary.name}** (${primary.direction === 'max' ? 'higher is better' : 'lower is better'})`,
        `- Best so far: ${best ? `${best.value} (round ${best.round})` : 'none yet'}`,
        `- Target: ${primary.target ?? 'not set'}`,
        `- Rounds remaining: ${roundsRemaining}`,
    ].join('\n');
}

function renderLedgerSection(records: readonly ResearchExperimentRecord[]): string {
    return ['## Experiment ledger', '', renderLedgerForPrompt(records)].join('\n');
}

function renderTriedConfigsSection(records: readonly ResearchExperimentRecord[]): string {
    if (records.length === 0) {
        return ['## Configs already tried — do not repeat', '', 'None yet.'].join('\n');
    }
    // Regressions first: they are the configs most worth avoiding a repeat of.
    const ordered = [...records].sort((left, right) => {
        const leftRegressed = left.verdict === 'regressed' ? 0 : 1;
        const rightRegressed = right.verdict === 'regressed' ? 0 : 1;
        return leftRegressed - rightRegressed;
    });
    const lines = ordered.map(record =>
        `- [${record.verdict ?? 'pending'}] round ${record.round} — lever: ${record.lever ?? '—'} — `
        + `hypothesis: ${record.hypothesis} — fingerprint \`${record.declaredConfigFingerprint}\``);
    return ['## Configs already tried — do not repeat', '', ...lines].join('\n');
}

const DIAGNOSTIC_FRAMING_SECTION = [
    '## How to reason about the next experiment',
    '',
    'State the SYMPTOM of the last result, the CAUSE you infer from it, and the SINGLE lever you '
    + 'are changing to test that cause. Exactly one lever per round — if you change more than one '
    + 'thing at a time you cannot attribute the result to either of them.',
].join('\n');

function renderConstraintsSection(): string {
    return [
        '## Constraints',
        '',
        '- Do not modify the metric command or the evaluation set — they must stay comparable across rounds.',
        '- Do not edit the experiment ledger file — it is written by the runner, not the agent.',
        '- Do not launch the long-running training/run command yourself. Qaap runs it for you: your shell '
        + 'tools time out after roughly 30 seconds, far too short for the actual work.',
    ].join('\n');
}

function renderOutputFormatSection(): string {
    return [
        '## Output format',
        '',
        `End your reply with the ${QAAP_EXPERIMENT_MARKER} marker followed by a fenced JSON block:`,
        '',
        QAAP_EXPERIMENT_MARKER,
        '```json',
        '{',
        '  "symptom": "what went wrong or was inconclusive last round",',
        '  "hypothesis": "why you think that happened",',
        '  "lever": "the single config knob you are changing",',
        '  "config": { "...": "..." }',
        '}',
        '```',
    ].join('\n');
}

/**
 * Builds the full round prompt for the auto-researcher agent: the goal and best-so-far, the
 * ledger of past experiments, the configs to avoid repeating, the diagnostic framing that keeps
 * the agent from guessing blindly, the runner's constraints, and the expected output format.
 */
export function buildResearchRoundPrompt(goal: ResearchGoal, records: readonly ResearchExperimentRecord[]): string {
    const primary = findPrimaryMetric(goal);
    return [
        renderGoalSection(goal, records, primary),
        renderLedgerSection(records),
        renderTriedConfigsSection(records),
        DIAGNOSTIC_FRAMING_SECTION,
        renderConstraintsSection(),
        renderOutputFormatSection(),
    ].join('\n\n');
}

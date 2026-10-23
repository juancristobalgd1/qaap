// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Deterministic closing report of a finished agent task (senior-engineer contract, phase B).
 *
 * The runner and the conversation store already compute every piece separately — the
 * self-verification result, the independent review verdict, the blocked signal and the turn's
 * diff stats. This module only folds those values into one typed object; it never asks the agent
 * for a report and never re-derives a verdict, so the four closing states keep their meaning.
 */

import type { QaapAgentTaskReview, QaapAgentTaskState, QaapAgentTaskVerification } from './qaap-agent-task';

/** The terminal states a closing report describes; cancelled/interrupted turns get none. */
export type QaapAgentClosingState = Extract<QaapAgentTaskState, 'completed' | 'completed_with_warnings' | 'blocked' | 'failed'>;

export function isQaapAgentClosingState(state: QaapAgentTaskState): state is QaapAgentClosingState {
    return state === 'completed' || state === 'completed_with_warnings' || state === 'blocked' || state === 'failed';
}

/** Lines and files the turn changed, from the conversation store's numstat at settle. */
export interface QaapAgentClosingDiffSummary {
    /** Distinct paths in the numstat output; absent when only line totals were measured. */
    readonly files?: number;
    readonly added: number;
    readonly removed: number;
}

export interface QaapAgentClosingReport {
    readonly state: QaapAgentClosingState;
    readonly exitCode?: number;
    /** Absent: verification did not run (no edits, no scripts, or a failed exit). */
    readonly verification?: QaapAgentTaskVerification;
    /** Absent: no independent review ran (low risk, disabled, external, or verification was red). */
    readonly review?: QaapAgentTaskReview;
    /** What the agent said it needs, when it closed with the blocked signal. */
    readonly blockedNeed?: string;
    /** Absent: the diff was not measured (standalone task or git failure). */
    readonly diff?: QaapAgentClosingDiffSummary;
    /** One-line outcome, derived from the fields above. */
    readonly headline: string;
    /** One line per piece (checks, review, changes), in a fixed order. */
    readonly details: readonly string[];
}

export interface QaapAgentClosingReportInput {
    readonly state: QaapAgentTaskState;
    readonly exitCode?: number;
    readonly verification?: QaapAgentTaskVerification;
    readonly review?: QaapAgentTaskReview;
    readonly blockedNeed?: string;
    readonly diff?: QaapAgentClosingDiffSummary;
}

const SUMMARY_MAX_CHARS = 600;

/** Builds the report, or `undefined` for a state that is not one of the four closing states. */
export function buildAgentClosingReport(input: QaapAgentClosingReportInput): QaapAgentClosingReport | undefined {
    if (!isQaapAgentClosingState(input.state)) {
        return undefined;
    }
    const blockedNeed = input.state === 'blocked' ? input.blockedNeed?.trim() || undefined : undefined;
    const report = {
        state: input.state,
        ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
        ...(input.verification ? { verification: input.verification } : {}),
        ...(input.review ? { review: input.review } : {}),
        ...(blockedNeed ? { blockedNeed } : {}),
        ...(input.diff ? { diff: input.diff } : {}),
    };
    return {
        ...report,
        headline: describeHeadline(report),
        details: [
            describeVerification(input.verification),
            describeReview(input.review),
            describeDiff(input.diff),
        ],
    };
}

/**
 * Whether the transcript should carry the closing trace: every outcome a reader must notice
 * (warnings, blocked, a review that could not double-check the change). A clean `completed`
 * stays quiet, exactly as before the report existed.
 */
export function shouldSurfaceAgentClosingReport(report: QaapAgentClosingReport): boolean {
    return report.state !== 'completed' || report.review?.status === 'inconclusive';
}

/** Plain-text rendering used by the transcript trace: headline, then the detail lines. */
export function formatAgentClosingReport(report: QaapAgentClosingReport): string {
    return [report.headline, ...report.details].join('\n');
}

function describeHeadline(report: Omit<QaapAgentClosingReport, 'headline' | 'details'>): string {
    switch (report.state) {
        case 'blocked':
            return report.blockedNeed ? `Blocked — needs your input: ${report.blockedNeed}` : 'Blocked — needs your input.';
        case 'failed':
            return report.exitCode !== undefined ? `Failed — the agent exited with code ${report.exitCode}.` : 'Failed — the agent did not finish.';
        case 'completed_with_warnings':
            if (report.verification?.status === 'failed') {
                return 'Completed with warnings — verification checks are failing.';
            }
            if (report.review?.status === 'failed') {
                return 'Completed with warnings — the independent review rejected the change.';
            }
            return 'Completed with warnings.';
        case 'completed':
            return report.review?.status === 'inconclusive'
                ? 'Completed — the independent review produced no verdict.'
                : 'Completed.';
    }
}

function describeVerification(verification: QaapAgentTaskVerification | undefined): string {
    if (!verification) {
        return 'Checks: not run.';
    }
    switch (verification.status) {
        case 'skipped':
            return 'Checks: skipped.';
        case 'passed':
            return `Checks: passed (${verification.command})${describeFixTurns(verification.attempts)}.`;
        case 'failed':
            return `Checks: failing (${verification.command})${describeFixTurns(verification.attempts)}.${describeSummary(verification.summary)}`;
        case 'preexisting':
            return `Checks: failing only outside this change (${verification.command}).${describeSummary(verification.summary)}`;
    }
}

function describeFixTurns(attempts: number): string {
    return attempts > 0 ? ` after ${attempts} fix ${attempts === 1 ? 'turn' : 'turns'}` : '';
}

function describeSummary(summary: string): string {
    const trimmed = summary.trim();
    if (!trimmed) {
        return '';
    }
    return ` ${trimmed.length > SUMMARY_MAX_CHARS ? `${trimmed.slice(0, SUMMARY_MAX_CHARS)}…` : trimmed}`;
}

function describeReview(review: QaapAgentTaskReview | undefined): string {
    if (!review) {
        return 'Independent review: not run.';
    }
    const by = review.agentId ? ` by ${review.agentId}` : '';
    const reason = review.reason.trim();
    switch (review.status) {
        case 'passed':
            return endSentence(`Independent review: passed${by}${reason ? ` — ${reason}` : ''}`);
        case 'failed':
            return endSentence(`Independent review: rejected${by} — ${reason || 'no reason given'}`);
        case 'inconclusive':
            return endSentence(`Independent review: no verdict${by}${reason ? ` — ${reason}` : ''}`);
    }
}

function endSentence(text: string): string {
    return /[.!?…]$/.test(text) ? text : `${text}.`;
}

function describeDiff(diff: QaapAgentClosingDiffSummary | undefined): string {
    if (!diff) {
        return 'Changes: not measured.';
    }
    if (diff.added === 0 && diff.removed === 0 && !diff.files) {
        return 'Changes: none.';
    }
    const files = diff.files !== undefined ? `${diff.files} ${diff.files === 1 ? 'file' : 'files'}, ` : '';
    return `Changes: ${files}+${diff.added} −${diff.removed} lines.`;
}

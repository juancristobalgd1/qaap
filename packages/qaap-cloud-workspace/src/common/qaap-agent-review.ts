// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Pure logic for the independent adversarial review pass (senior-engineer contract, phase C):
 * deterministic risk classification of a finished agent task, the reviewer prompt, and the
 * verdict-sentinel parser. The runner wires these into {@code finishSuccessfulTaskAfterVerification}.
 */

import type { QaapAgentTaskVerification } from './qaap-agent-task';

export type QaapAgentReviewMode = 'off' | 'high-risk' | 'all';

/** QAAP_AGENT_REVIEW env values: off/0/false/no disable, 'all' reviews everything, default high-risk. */
export function resolveAgentReviewMode(raw: string | undefined): QaapAgentReviewMode {
    const normalized = raw?.trim().toLowerCase();
    if (normalized === 'off' || normalized === '0' || normalized === 'false' || normalized === 'no') {
        return 'off';
    }
    if (normalized === 'all') {
        return 'all';
    }
    return 'high-risk';
}

export interface QaapReviewChangedFile {
    readonly path: string;
    readonly added: number;
    readonly removed: number;
}

/** Parse `git diff --numstat` output. Binary files report '-' counts, which parse as 0. */
export function parseGitNumstat(output: string | undefined): QaapReviewChangedFile[] {
    if (!output) {
        return [];
    }
    const files: QaapReviewChangedFile[] = [];
    for (const line of output.split('\n')) {
        const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
        if (!match) {
            continue;
        }
        files.push({
            path: match[3].trim(),
            added: match[1] === '-' ? 0 : Number.parseInt(match[1], 10),
            removed: match[2] === '-' ? 0 : Number.parseInt(match[2], 10),
        });
    }
    return files;
}

/**
 * Path patterns that mark a change as high-risk regardless of size. Tuned for arbitrary user
 * repositories (not this monorepo): security-adjacent names, dotenv files, database migrations,
 * and manifests/lockfiles (supply-chain surface).
 */
const SENSITIVE_PATH_SEGMENT_RE = /(auth|login|session|oauth|token|secret|password|credential|permission|payment|billing|middleware|security)/i;
const SENSITIVE_FILE_RE = /(^|\/)\.env(\.|$)|(^|\/)migrations?\/|\.sql$|(^|\/)package\.json$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i;

export function isSensitiveReviewPath(path: string): boolean {
    return SENSITIVE_PATH_SEGMENT_RE.test(path) || SENSITIVE_FILE_RE.test(path);
}

/** Deterministic risk classifier: ≥3 files, ≥40 changed lines, or any sensitive path → 'high'. */
export function resolveTaskReviewRisk(files: readonly QaapReviewChangedFile[]): 'low' | 'high' {
    if (files.length >= 3) {
        return 'high';
    }
    let changedLines = 0;
    for (const file of files) {
        if (isSensitiveReviewPath(file.path)) {
            return 'high';
        }
        changedLines += file.added + file.removed;
    }
    return changedLines >= 40 ? 'high' : 'low';
}

/**
 * Verdict sentinel the reviewer must emit. The parser scans RAW agent output (CLI agents log
 * stream-json, so the sentinel sits inside JSON strings — no line anchors), takes the LAST
 * occurrence, and stops the reason at characters that would leave the enclosing JSON string.
 * The reviewer prompt deliberately never spells the sentinel adjacent to a bare pass/fail word,
 * so a prompt echo cannot satisfy this pattern.
 */
export const QAAP_AGENT_REVIEW_VERDICT_MARKER = '@@QAAP:VERDICT@@';

const VERDICT_RE = /@@QAAP:VERDICT@@\s*(pass|fail)\b[ \t]*([^"\\\r\n]*)/gi;

/**
 * Separator inside the verdict line between the reason and the optional non-blocking notes:
 * `@@QAAP:VERDICT@@ fail server.js:12 — bad guard || notes: rename foo`. One line keeps the
 * sentinel contract (a single parseable line) without a second marker that a prompt echo could hit.
 */
export const QAAP_AGENT_REVIEW_NOTES_SEPARATOR = ' || notes:';

export interface QaapAgentReviewVerdict {
    readonly status: 'passed' | 'failed';
    /** Fail: must open with the defect as `path:line` (see {@link hasConcreteDefectCitation}). */
    readonly reason: string;
    /** Non-blocking observations the reviewer put after the separator. */
    readonly notes?: string;
}

export function parseAgentReviewVerdict(rawOutput: string | undefined): QaapAgentReviewVerdict | undefined {
    if (!rawOutput) {
        return undefined;
    }
    let last: RegExpMatchArray | undefined;
    for (const match of rawOutput.matchAll(VERDICT_RE)) {
        last = match;
    }
    if (!last) {
        return undefined;
    }
    const body = last[2].trim();
    const separatorAt = body.indexOf(QAAP_AGENT_REVIEW_NOTES_SEPARATOR);
    const reason = separatorAt < 0 ? body : body.slice(0, separatorAt).trim();
    const notes = separatorAt < 0 ? '' : body.slice(separatorAt + QAAP_AGENT_REVIEW_NOTES_SEPARATOR.length).trim();
    return {
        status: last[1].toLowerCase() === 'pass' ? 'passed' : 'failed',
        reason,
        ...(notes ? { notes } : {}),
    };
}

/** A reason that opens with a concrete `path/to/file.ext:line` citation. */
const DEFECT_CITATION_RE = /^`?[\w@./-]+\.[A-Za-z0-9]+:\d+\b/;

export function hasConcreteDefectCitation(reason: string): boolean {
    return DEFECT_CITATION_RE.test(reason.trim());
}

function withNotes(reason: string, notes: string | undefined): string {
    if (!notes) {
        return reason;
    }
    return reason ? `${reason} (notes: ${notes})` : `approved with notes: ${notes}`;
}

/**
 * Only a rejection that names a concrete defect blocks. A `fail` without a `path:line` citation is
 * recorded as an approval with notes: style, rewrites and "could be better" are not grounds to
 * close a finished task as warnings. A `fail` with a citation (a real syntax error, a broken
 * requirement) keeps blocking.
 */
export function groundAgentReviewVerdict(verdict: QaapAgentReviewVerdict): { status: 'passed' | 'failed'; reason: string } {
    if (verdict.status === 'passed') {
        return { status: 'passed', reason: withNotes(verdict.reason, verdict.notes) };
    }
    if (hasConcreteDefectCitation(verdict.reason)) {
        return { status: 'failed', reason: withNotes(verdict.reason, verdict.notes) };
    }
    const claim = verdict.reason || 'no reason given';
    const notes = [`rejection named no file:line defect, not blocking: ${claim}`, verdict.notes].filter(Boolean).join('; ');
    return { status: 'passed', reason: withNotes('', notes) };
}

/** promptRef of the adversarial-review judge node (registered in the workflow prompt registry). */
export const QAAP_ADVERSARIAL_REVIEW_PROMPT_REF = 'adversarial-review';

/**
 * The status a sentinel judge node routes on. Only the adversarial-review judge is grounded, the
 * same way the runner grounds its reviewer; the plan, audit and synthesis judges keep the verdict
 * as the reviewer wrote it.
 */
export function resolveJudgedReviewStatus(promptRef: string, verdict: QaapAgentReviewVerdict): 'passed' | 'failed' {
    if (promptRef !== QAAP_ADVERSARIAL_REVIEW_PROMPT_REF) {
        return verdict.status;
    }
    return groundAgentReviewVerdict(verdict).status;
}

/**
 * The one instruction that makes a verdict parseable. Shared by every prompt whose node declares
 * `requireSentinel`, so the contract with {@link parseAgentReviewVerdict} lives in a single place:
 * the marker and the words "pass"/"fail" are spelled apart on purpose (see the parser's note).
 */
export function buildAgentReviewVerdictInstruction(): string {
    return 'End your final message with exactly one line: the marker ' + QAAP_AGENT_REVIEW_VERDICT_MARKER
        + ' followed by a space, then the single word "pass" or "fail", then a short reason.'
        + ' Emit that marker exactly once, only in that final line.';
}

/**
 * Neutralize verdict markers inside text an agent produced, before it is inlined into a prompt
 * whose own output IS parsed for a verdict. Without this, a review lens (or any earlier turn) could
 * write the marker into its findings, the synthesis turn would carry it into its context, and an
 * echo of the prompt would decide the run — a verdict nobody issued.
 */
export function redactAgentReviewVerdictMarkers(text: string): string {
    return text.split(QAAP_AGENT_REVIEW_VERDICT_MARKER).join('@@REDACTED-MARKER@@');
}

/**
 * How much diff the reviewer prompt inlines. Producers of a diff artifact cap at the same number:
 * storing more than the prompt can carry only bloats the run index.
 */
export const DEFAULT_REVIEW_DIFF_CAP_CHARS = 30_000;

/**
 * Adversarial reviewer prompt. The diff is inlined (capped) so the reviewer judges the actual
 * change even if it never runs a git command; it may still inspect the tree read-only. The
 * sentinel instruction spells the verdict words separately from the marker on purpose — see
 * {@link parseAgentReviewVerdict}.
 */
const VERIFICATION_SUMMARY_PROMPT_CAP_CHARS = 1500;

/** The checks Qaap already ran on this turn, so the reviewer does not re-argue what they prove. */
export function describeVerificationEvidence(verification: QaapAgentTaskVerification | undefined): string {
    if (!verification) {
        return 'Qaap checks for this turn: not run.';
    }
    const summary = (verification.status === 'failed' || verification.status === 'preexisting')
        ? verification.summary.trim().slice(0, VERIFICATION_SUMMARY_PROMPT_CAP_CHARS)
        : '';
    switch (verification.status) {
        case 'skipped':
            return 'Qaap checks for this turn: skipped (no check applied to this change).';
        case 'passed':
            return `Qaap checks for this turn: PASSED — \`${verification.command}\` (${verification.attempts} fix turn(s)).`;
        case 'failed':
            return `Qaap checks for this turn: FAILED — \`${verification.command}\` after ${verification.attempts} fix turn(s): ${summary}`;
        case 'preexisting':
            return `Qaap checks for this turn: failing only outside this change — \`${verification.command}\`: ${summary}`;
    }
}

/**
 * Adversarial reviewer prompt. The diff is inlined (capped) so the reviewer judges the actual
 * change even if it never runs a git command; it may still inspect the tree read-only. The
 * sentinel instruction spells the verdict words separately from the marker on purpose — see
 * {@link parseAgentReviewVerdict}. Failing requires a concrete `path:line` defect; everything
 * else is a note (see {@link groundAgentReviewVerdict}).
 */
export function buildAgentReviewPrompt(options: {
    readonly originalCommand: string;
    readonly diff: string;
    readonly diffCapChars?: number;
    /** Qaap's own check result for this turn, passed in as evidence. */
    readonly verification?: QaapAgentTaskVerification;
}): string {
    const cap = options.diffCapChars ?? DEFAULT_REVIEW_DIFF_CAP_CHARS;
    const diff = options.diff.length > cap ? `${options.diff.slice(0, cap)}\n…(diff truncated)` : options.diff;
    return [
        'You are an INDEPENDENT senior code reviewer with a clean context. Another agent just finished a task in this repository and its uncommitted changes are still in the working tree.',
        `The task that produced the changes was started with: ${options.originalCommand}`,
        '',
        describeVerificationEvidence(options.verification),
        '',
        'Judge whether the change does what the task asked and whether it breaks anything.',
        'You may run read-only commands to inspect the repository. Do NOT edit any file, do NOT commit, do NOT fix anything — you only judge.',
        'Do not start an application, dev server, watcher, or any other long-lived process. Use existing Preview evidence and bounded read-only checks instead.',
        '',
        'Grounds for FAIL — only these:',
        '- A concrete bug, broken edge case, or regression, at a file and line.',
        '- A requirement of the task that the change does not meet.',
        '- A concrete security defect at a file and line (injection, leaked secret, missing validation, tenant isolation).',
        'NOT grounds for FAIL: style, naming, rewrites, scope you would have done differently, "could be improved", or leftovers you cannot tie to a broken behaviour. Put those in the notes instead.',
        '',
        'Output format: the last line of your final message is the verdict.',
        `- Optionally, append to the verdict line the separator "${QAAP_AGENT_REVIEW_NOTES_SEPARATOR.trim()}" followed by up to three short non-blocking notes.`,
        '- For "fail", the reason MUST start with the defect as path:line, then one sentence on why it breaks the task or the code.',
        buildAgentReviewVerdictInstruction(),
        '',
        'Unified diff of the uncommitted changes:',
        diff || '(empty diff — inspect the working tree yourself)',
    ].join('\n');
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Pure logic for the independent adversarial review pass (senior-engineer contract, phase C):
 * deterministic risk classification of a finished agent task, the reviewer prompt, and the
 * verdict-sentinel parser. The runner wires these into {@code finishSuccessfulTaskAfterVerification}.
 */

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

export function parseAgentReviewVerdict(rawOutput: string | undefined): { status: 'passed' | 'failed'; reason: string } | undefined {
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
    return {
        status: last[1].toLowerCase() === 'pass' ? 'passed' : 'failed',
        reason: last[2].trim(),
    };
}

/**
 * Adversarial reviewer prompt. The diff is inlined (capped) so the reviewer judges the actual
 * change even if it never runs a git command; it may still inspect the tree read-only. The
 * sentinel instruction spells the verdict words separately from the marker on purpose — see
 * {@link parseAgentReviewVerdict}.
 */
export function buildAgentReviewPrompt(options: {
    readonly originalCommand: string;
    readonly diff: string;
    readonly diffCapChars?: number;
}): string {
    const cap = options.diffCapChars ?? 30_000;
    const diff = options.diff.length > cap ? `${options.diff.slice(0, cap)}\n…(diff truncated)` : options.diff;
    return [
        'You are an INDEPENDENT senior code reviewer with a clean context. Another agent just finished a task in this repository and its uncommitted changes are still in the working tree.',
        `The task that produced the changes was started with: ${options.originalCommand}`,
        '',
        'Adversarially review the change:',
        '- Does it actually do what the task asked, or only part of it?',
        '- Bugs, broken edge cases, or regressions it introduces.',
        '- Scope creep: changes unrelated to the task.',
        '- Leftover debug code, temp files, or hardcoded values.',
        '- Security problems (injection, secrets, missing validation, tenant isolation).',
        'You may run read-only commands to inspect the repository. Do NOT edit any file, do NOT commit, do NOT fix anything — you only judge.',
        'Do not start an application, dev server, watcher, or any other long-lived process. Use existing Preview evidence and bounded read-only checks instead.',
        '',
        'End your final message with exactly one line: the marker ' + QAAP_AGENT_REVIEW_VERDICT_MARKER
        + ' followed by a space, then the single word "pass" or "fail", then a short reason.'
        + ' Emit that marker exactly once, only in that final line.',
        '',
        'Unified diff of the uncommitted changes:',
        diff || '(empty diff — inspect the working tree yourself)',
    ].join('\n');
}

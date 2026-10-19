// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentTaskReview, QaapAgentTaskState, QaapAgentTaskVerification } from './qaap-agent-task';
import { redactQaapSecrets } from './qaap-secret-redaction';

/** Opening marker of the section the backend owns in a task pull request body. */
export const QAAP_TASK_PR_EVIDENCE_START = '<!-- qaap:evidence -->';
/** Closing marker; everything outside the two markers belongs to the humans editing the PR. */
export const QAAP_TASK_PR_EVIDENCE_END = '<!-- /qaap:evidence -->';
/** Label added to a task pull request while it needs attention. */
export const QAAP_TASK_PR_ATTENTION_LABEL = 'qaap: needs attention';
/** Title prefix of a task pull request while it needs attention. */
export const QAAP_TASK_PR_ATTENTION_PREFIX = '[needs attention]';

/** GitHub rejects bodies over 65 536 characters; stay well below with room for human text. */
const BODY_SECTION_LIMIT = 48_000;
const SUMMARY_LIMIT = 6_000;
const CHECK_DETAIL_LIMIT = 3_000;
const DIFFSTAT_LINE_LIMIT = 80;

export interface QaapTaskPullRequestScreenshot {
    readonly url: string;
    readonly label?: string;
}

/** Everything the evidence section is built from; every field is optional. */
export interface QaapTaskPullRequestBodyInput {
    /** The agent's last reply (the task summary). */
    readonly summary?: string;
    /** `git diff --stat` between the base and the pushed head. */
    readonly diffstat?: string;
    readonly verification?: QaapAgentTaskVerification;
    readonly review?: QaapAgentTaskReview;
    /** Final state of the latest turn's task. */
    readonly taskState?: QaapAgentTaskState;
    /** What the agent said it needs from the user when the turn ended blocked. */
    readonly blockedNeed?: string;
    /** Why the latest turn could not be applied onto the branch (merge conflict). */
    readonly conflict?: string;
    readonly screenshots?: readonly QaapTaskPullRequestScreenshot[];
    /** Shown instead of screenshots when they exist but are not published (public repository). */
    readonly screenshotsOmittedReason?: string;
    /** The conversation title: the neutral summary of a public repository's PR. */
    readonly title?: string;
    /**
     * A public repository: the body never carries the agent's own words (reply, check output, review
     * reasoning), only the title, diffstat and the verdicts.
     */
    readonly publicRepository?: boolean;
    /** The branch was rebuilt from its base after a rewind or checkpoint restore. */
    readonly rebuilt?: boolean;
    /** The task moved to a new branch because someone else pushed to the old one; that old PR. */
    readonly supersedes?: number;
    /** We built on a commit someone else pushed to the task branch. */
    readonly builtOnForeignPush?: boolean;
    /** The task came from this issue of the same repository (doc/qaap-external-task-inputs.md): `Closes #N`. */
    readonly closesIssue?: number;
}

/** Red blocks: a red verdict, a blocked turn or a conflict opens the PR as a labelled draft. */
export function isTaskPullRequestRed(input: QaapTaskPullRequestBodyInput): boolean {
    return input.verification?.status === 'failed'
        || input.review?.status === 'failed'
        || input.taskState === 'completed_with_warnings'
        || input.taskState === 'blocked'
        || input.taskState === 'failed'
        || !!input.blockedNeed
        || !!input.conflict;
}

/** The PR title: the task title, prefixed with {@link QAAP_TASK_PR_ATTENTION_PREFIX} while red. */
export function buildTaskPullRequestTitle(title: string, red: boolean): string {
    const clean = stripAttentionPrefix(title.replace(/\s+/g, ' ').trim()) || 'Qaap task';
    const short = clean.length > 200 ? `${clean.slice(0, 199)}…` : clean;
    return red ? `${QAAP_TASK_PR_ATTENTION_PREFIX} ${short}` : short;
}

function stripAttentionPrefix(title: string): string {
    let current = title;
    while (current.toLowerCase().startsWith(QAAP_TASK_PR_ATTENTION_PREFIX)) {
        current = current.slice(QAAP_TASK_PR_ATTENTION_PREFIX.length).trim();
    }
    return current;
}

/** The backend-owned section, markers included. */
export function buildTaskPullRequestEvidenceSection(input: QaapTaskPullRequestBodyInput): string {
    const parts: string[] = [QAAP_TASK_PR_EVIDENCE_START];
    if (isTaskPullRequestRed(input)) {
        parts.push(`> [!WARNING]\n> ${nls.localize('qaap/taskPullRequest/needsAttention',
            'Needs attention: Qaap opened this pull request as a draft because the task is not green yet.')}`);
    }
    if (input.closesIssue && Number.isInteger(input.closesIssue) && input.closesIssue > 0) {
        // GitHub's closing keyword stays English whatever the UI language.
        parts.push(`Closes #${input.closesIssue}`);
    }
    parts.push(`### ${nls.localizeByDefault('Summary')}`);
    parts.push(describeSummary(input));
    const notes = describeBranchNotes(input);
    if (notes) {
        parts.push(notes);
    }
    parts.push(`### ${nls.localize('qaap/taskPullRequest/diffstat', 'Diffstat')}`);
    parts.push(fenced(boundLines(input.diffstat?.trim() ?? '', DIFFSTAT_LINE_LIMIT)
        || nls.localize('qaap/taskPullRequest/noDiff', 'No file changes.')));
    parts.push(`### ${nls.localizeByDefault('Checks')}`);
    parts.push(describeVerification(input.verification, !!input.publicRepository));
    parts.push(`### ${nls.localize('qaap/taskPullRequest/reviewer', 'Reviewer verdict')}`);
    parts.push(describeReview(input.review, !!input.publicRepository));
    if (input.blockedNeed || input.conflict) {
        parts.push(`### ${nls.localize('qaap/taskPullRequest/blockers', 'Blockers')}`);
        if (input.blockedNeed && !input.publicRepository) {
            parts.push(`- ${nls.localize('qaap/taskPullRequest/blocked', 'The agent is waiting for input: {0}', oneLine(input.blockedNeed))}`);
        }
        if (input.conflict) {
            parts.push(`- ${nls.localize('qaap/taskPullRequest/conflict', 'The latest turn conflicts with this branch and was not pushed: {0}', oneLine(input.conflict))}`);
        }
    }
    parts.push(`### ${nls.localize('qaap/taskPullRequest/screenshots', 'Screenshots')}`);
    parts.push(describeScreenshots(input));
    parts.push(`<sub>${nls.localize('qaap/taskPullRequest/footer',
        'Maintained by Qaap: this section is rewritten on every turn; text outside it is kept.')}</sub>`);
    parts.push(QAAP_TASK_PR_EVIDENCE_END);
    const section = parts.join('\n\n');
    if (section.length <= BODY_SECTION_LIMIT) {
        return section;
    }
    return `${section.slice(0, BODY_SECTION_LIMIT - QAAP_TASK_PR_EVIDENCE_END.length - 4)}…\n\n${QAAP_TASK_PR_EVIDENCE_END}`;
}

/**
 * Replaces the evidence section of `existing` with `section`, keeping every human edit outside the
 * markers. Appends the section when `existing` has none (or its markers are broken).
 */
export function mergeTaskPullRequestBody(existing: string | undefined, section: string): string {
    const body = existing ?? '';
    const start = body.indexOf(QAAP_TASK_PR_EVIDENCE_START);
    const end = start >= 0 ? body.indexOf(QAAP_TASK_PR_EVIDENCE_END, start) : -1;
    if (start < 0 || end < 0) {
        const head = body.trimEnd();
        return head ? `${head}\n\n${section}` : section;
    }
    return body.slice(0, start) + section + body.slice(end + QAAP_TASK_PR_EVIDENCE_END.length);
}

function describeSummary(input: QaapTaskPullRequestBodyInput): string {
    if (input.publicRepository) {
        const title = oneLine(input.title?.trim() ?? '');
        return title
            ? nls.localize('qaap/taskPullRequest/publicSummary', 'Qaap task: {0}. See the diffstat and checks below.', title)
            : nls.localize('qaap/taskPullRequest/publicSummaryUntitled', 'Qaap task. See the diffstat and checks below.');
    }
    return bounded(sanitize(input.summary?.trim() ?? ''), SUMMARY_LIMIT)
        || `_${nls.localize('qaap/taskPullRequest/noSummary', 'The agent left no summary.')}_`;
}

function describeBranchNotes(input: QaapTaskPullRequestBodyInput): string | undefined {
    const notes: string[] = [];
    if (input.rebuilt) {
        notes.push(`- ${nls.localize('qaap/taskPullRequest/rebuilt',
            'The branch was rebuilt from its base after a rewind or checkpoint restore in Qaap, and force-pushed.')}`);
    }
    if (input.supersedes) {
        notes.push(`- ${nls.localize('qaap/taskPullRequest/supersedes',
            'Supersedes #{0}: someone else pushed to that branch, so Qaap continued on a new one.', String(input.supersedes))}`);
    }
    if (input.builtOnForeignPush) {
        notes.push(`- ${nls.localize('qaap/taskPullRequest/builtOnForeign',
            'Someone else pushed to this branch; Qaap added its new commits on top of theirs.')}`);
    }
    return notes.length ? notes.join('\n') : undefined;
}

function describeVerification(verification: QaapAgentTaskVerification | undefined, publicRepository: boolean): string {
    if (!verification || verification.status === 'skipped') {
        return `- ⚪ ${nls.localize('qaap/taskPullRequest/checksSkipped', 'Not run: the turn made no verifiable change or the repository has no checks.')}`;
    }
    const command = `\`${oneLine(verification.command).replace(/`/g, '\'')}\``;
    const attempts = verification.attempts;
    if (verification.status === 'passed') {
        return `- ✅ ${nls.localize('qaap/taskPullRequest/checksPassed', 'Passed: {0} (fix attempts: {1})', command, String(attempts))}`;
    }
    const detail = publicRepository ? '' : bounded(verification.summary.trim(), CHECK_DETAIL_LIMIT);
    const headline = verification.status === 'failed'
        ? `- ❌ ${nls.localize('qaap/taskPullRequest/checksFailed', 'Failing: {0} (fix attempts: {1})', command, String(attempts))}`
        : `- 🟡 ${nls.localize('qaap/taskPullRequest/checksPreexisting', 'Already failing before this task, in files it did not touch: {0}', command)}`;
    return detail ? `${headline}\n\n${fenced(detail)}` : headline;
}

function describeReview(review: QaapAgentTaskReview | undefined, publicRepository: boolean): string {
    if (!review) {
        return `- ⚪ ${nls.localize('qaap/taskPullRequest/reviewSkipped', 'No independent review ran for this turn.')}`;
    }
    const by = review.agentId ? ` (${oneLine(review.agentId)})` : '';
    const reason = review.reason?.trim() && !publicRepository ? `: ${oneLine(bounded(review.reason.trim(), CHECK_DETAIL_LIMIT))}` : '';
    switch (review.status) {
        case 'passed':
            return `- ✅ ${nls.localize('qaap/taskPullRequest/reviewPassed', 'Approved{0}', by)}${reason}`;
        case 'failed':
            return `- ❌ ${nls.localize('qaap/taskPullRequest/reviewFailed', 'Rejected{0}', by)}${reason}`;
        default:
            return `- 🟡 ${nls.localize('qaap/taskPullRequest/reviewInconclusive', 'Inconclusive{0}: the change was not double-checked', by)}${reason}`;
    }
}

function describeScreenshots(input: QaapTaskPullRequestBodyInput): string {
    const screenshots = (input.screenshots ?? []).filter(shot => /^https:\/\/\S+$/.test(shot.url));
    if (screenshots.length > 0) {
        return screenshots.map((shot, index) => {
            const label = oneLine(shot.label?.trim() || nls.localize('qaap/taskPullRequest/screenshotLabel', 'Preview {0}', String(index + 1)))
                .replace(/[[\]]/g, '');
            return `![${label}](${shot.url})`;
        }).join('\n\n');
    }
    if (input.screenshotsOmittedReason) {
        return `_${oneLine(input.screenshotsOmittedReason)}_`;
    }
    return `_${nls.localize('qaap/taskPullRequest/noScreenshots', 'No preview screenshots for this task.')}_`;
}

/** Agent text must not be able to close or reopen the backend-owned section, nor leak an obvious secret. */
function sanitize(text: string): string {
    return redactQaapSecrets(text.split(QAAP_TASK_PR_EVIDENCE_START).join('').split(QAAP_TASK_PR_EVIDENCE_END).join(''));
}

/**
 * Message of a task commit. Never the prompt: the subject is the conversation title when the user set
 * one (`title`; pass `undefined` for a title derived from the first prompt), else the files the turn
 * changed. The body carries the task id.
 */
export function buildTaskPullRequestCommitMessage(conversationId: string, changedPaths: readonly string[], title?: string): string {
    const clean = oneLine(stripAttentionPrefix(title?.trim() ?? ''));
    const names = changedPaths.map(file => oneLine(file)).filter(Boolean);
    const files = names.length === 0 ? '' : names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
    const subject = clean ? `Qaap task: ${clean}` : files ? `Qaap task: update ${files}` : 'Qaap task update';
    return `${subject.length > 72 ? `${subject.slice(0, 71)}…` : subject}\n\nQaap task ${conversationId}`;
}

function oneLine(text: string): string {
    return sanitize(text).replace(/\s+/g, ' ').trim();
}

function bounded(text: string, limit: number): string {
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function boundLines(text: string, maxLines: number): string {
    const lines = text.split('\n');
    if (lines.length <= maxLines) {
        return text;
    }
    // Keep the head and the `N files changed` totals line.
    return [...lines.slice(0, maxLines - 2), '…', lines[lines.length - 1]].join('\n');
}

/** A code fence longer than any backtick run inside `text`. */
function fenced(text: string): string {
    const longest = Math.max(2, ...(sanitize(text).match(/`+/g) ?? []).map(run => run.length));
    const fence = '`'.repeat(longest + 1);
    return `${fence}\n${sanitize(text)}\n${fence}`;
}

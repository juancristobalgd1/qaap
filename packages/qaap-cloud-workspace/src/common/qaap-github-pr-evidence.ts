// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** GitHub issue/PR thread where Qaap should post completion evidence. */
export interface QaapGithubEvidenceAnchor {
    readonly owner: string;
    readonly repo: string;
    readonly issueNumber: number;
    readonly triggerCommentId?: number;
    /** Agent task ids that already received a completion comment. */
    readonly postedTaskIds?: ReadonlyArray<string>;
    /** Set after a goal-loop terminal evidence comment is posted. */
    readonly goalLoopPosted?: boolean;
}

export interface QaapGithubEvidenceTarget {
    readonly owner: string;
    readonly repo: string;
    readonly issueNumber: number;
}

export function resolveGithubEvidenceTarget(input: {
    readonly githubEvidence?: QaapGithubEvidenceAnchor;
    readonly linkedPullRequest?: { readonly owner: string; readonly repo: string; readonly number?: number };
}): QaapGithubEvidenceTarget | undefined {
    if (input.githubEvidence) {
        return {
            owner: input.githubEvidence.owner,
            repo: input.githubEvidence.repo,
            issueNumber: input.githubEvidence.issueNumber,
        };
    }
    const pr = input.linkedPullRequest;
    if (pr?.number) {
        return { owner: pr.owner, repo: pr.repo, issueNumber: pr.number };
    }
    return undefined;
}

export function wasGithubEvidencePostedForTask(
    githubEvidence: QaapGithubEvidenceAnchor | undefined,
    postedTaskIds: ReadonlyArray<string> | undefined,
    taskId: string,
): boolean {
    if (githubEvidence?.postedTaskIds?.includes(taskId)) {
        return true;
    }
    return (postedTaskIds ?? []).includes(taskId);
}

export function buildGithubTaskEvidenceComment(input: {
    readonly ok: boolean;
    readonly title: string;
    readonly summary?: string;
    readonly linesAdded?: number;
    readonly linesRemoved?: number;
    readonly workHubUrl?: string;
    readonly logTail?: string;
    readonly goalLoopStopReason?: string;
}): string {
    const status = input.ok ? '✅ completed' : '⚠️ stopped';
    const lines: string[] = [
        `**Qaap** ${status}: ${input.title.trim() || 'Agent task'}`,
    ];
    if (input.goalLoopStopReason) {
        lines.push('', `_${input.goalLoopStopReason}_`);
    }
    const summary = input.summary?.trim();
    if (summary) {
        lines.push('', '**Summary**', '', summary.slice(0, 1200));
    }
    const added = input.linesAdded ?? 0;
    const removed = input.linesRemoved ?? 0;
    if (added > 0 || removed > 0) {
        lines.push('', `**Changes:** +${added} −${removed} lines`);
    }
    if (input.workHubUrl) {
        lines.push('', `[Open in Qaap](${input.workHubUrl})`);
    }
    const tail = input.logTail?.trim();
    if (!input.ok && tail) {
        lines.push('', '<details><summary>Log tail</summary>', '', '```', tail.slice(-1800), '```', '</details>');
    }
    return lines.join('\n');
}

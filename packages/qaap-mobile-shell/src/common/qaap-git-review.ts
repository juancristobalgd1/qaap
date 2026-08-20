// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** HTTP base path for the git review endpoints. */
export const QAAP_GIT_REVIEW_API_PATH = '/qaap/api/git-review';

/** A single file with working-tree changes. */
export interface QaapGitChangedFile {
    /** Repository-relative POSIX path. */
    path: string;
    /** Previous repository-relative path for a rename/copy. */
    oldPath?: string;
    /** Single-letter git status (M, A, D, R, U/?). */
    status: string;
    /** Added lines across the diff. */
    adds: number;
    /** Removed lines across the diff. */
    dels: number;
    /** True when the file's changes are fully staged. */
    staged: boolean;
}

/** Whether the current branch has committed work worth opening a pull request for. */
export interface QaapGitPrReadiness {
    /** True when on a non-default branch that is ahead of the default branch by ≥1 commit. */
    canCreatePr: boolean;
    /** Commits on HEAD not reachable from the default branch. */
    aheadCount: number;
    /** Resolved default branch (e.g. `main`), when known. */
    defaultBranch?: string;
}

/**
 * Extract a single hunk from a one-file `git diff` into a standalone, appliable patch (the file
 * header + only the selected `@@` hunk). Returns undefined when the diff has no such hunk. Built from
 * authoritative `git diff` output — never from a reconstructed structure — so the result always
 * round-trips through `git apply`. `git apply --recount` absorbs any line-count drift.
 */
export function buildSingleHunkPatch(diffText: string, hunkIndex: number): string | undefined {
    if (hunkIndex < 0) {
        return undefined;
    }
    const lines = diffText.split('\n');
    const firstHunk = lines.findIndex(line => line.startsWith('@@'));
    if (firstHunk < 0) {
        return undefined;
    }
    const header = lines.slice(0, firstHunk);
    const hunks: string[][] = [];
    let current: string[] | undefined;
    for (const line of lines.slice(firstHunk)) {
        if (line.startsWith('@@')) {
            current = [line];
            hunks.push(current);
        } else if (current) {
            current.push(line);
        }
    }
    const hunk = hunks[hunkIndex];
    if (!hunk) {
        return undefined;
    }
    // Drop trailing empty lines the split may have introduced, then end with a single newline.
    const body = [...header, ...hunk];
    while (body.length > 0 && body[body.length - 1] === '') {
        body.pop();
    }
    return `${body.join('\n')}\n`;
}

/** Decide whether the Changes view should surface a "Create PR" action, from resolved git state. */
export function computePrReadiness(
    currentBranch: string | undefined,
    defaultBranch: string | undefined,
    aheadCount: number,
): QaapGitPrReadiness {
    const onDefaultBranch = !!currentBranch && !!defaultBranch && currentBranch === defaultBranch;
    const canCreatePr = !!currentBranch && !!defaultBranch && !onDefaultBranch && aheadCount > 0;
    return { canCreatePr, aheadCount, defaultBranch };
}

export interface QaapGitChangesResponse {
    /** Absolute fs path of the repository root that was inspected. */
    root: string;
    /** Current branch name (`git rev-parse --abbrev-ref HEAD`), when available. */
    branch?: string;
    files: QaapGitChangedFile[];
    /** Present when git state could be read: whether a PR can be opened for the current branch. */
    prReadiness?: QaapGitPrReadiness;
}

export interface QaapGitHistoryCommit {
    hash: string;
    shortHash: string;
    subject: string;
    authorName: string;
    authorEmail?: string;
    authoredAt: string;
    refs: string[];
}

export interface QaapGitHistoryResponse {
    root: string;
    branch?: string;
    commits: QaapGitHistoryCommit[];
}

export interface QaapGitBranchesResponse {
    root: string;
    current?: string;
    branches: string[];
}

export interface QaapGitCheckoutRequest {
    /** Absolute filesystem path of the repository root. */
    root: string;
    branch: string;
}

export interface QaapGitDeleteBranchRequest {
    /** Absolute filesystem path of the repository root. */
    root: string;
    branch: string;
}

export type QaapGitHunkLineType = 'ctx' | 'add' | 'del';

export interface QaapGitHunkLine {
    type: QaapGitHunkLineType;
    /** Line number in the original file (undefined for added lines). */
    oldNumber?: number;
    /** Line number in the new file (undefined for removed lines). */
    newNumber?: number;
    text: string;
}

export interface QaapGitHunk {
    /** The raw `@@ ... @@` header. */
    header: string;
    lines: QaapGitHunkLine[];
}

export interface QaapGitFileDiffResponse {
    path: string;
    binary: boolean;
    /** Distinguishes genuine metadata-only changes from missing/failed patch data. */
    kind: 'text' | 'binary' | 'metadata';
    hunks: QaapGitHunk[];
}

/** Detect Git's binary patch markers without mistaking matching source-code text for metadata. */
export function isBinaryGitPatch(patch: string): boolean {
    return /^Binary files .+ differ$/m.test(patch) || /^GIT binary patch$/m.test(patch);
}

export interface QaapGitFileActionRequest {
    /** Absolute filesystem path of the repository root. */
    root: string;
    /** Repository-relative POSIX path. */
    file: string;
}

/** Context for AI commit-message generation: changed files plus a truncated combined diff. */
export interface QaapGitCommitContextResponse {
    root: string;
    branch?: string;
    files: QaapGitChangedFile[];
    /** Combined unified diff (staged + unstaged), truncated server-side to fit an LLM prompt. */
    diff: string;
    truncated: boolean;
}

export type QaapGitCommitWorkflowAction =
    | 'create-branch-commit'
    | 'create-branch-commit-push'
    | 'commit-push'
    | 'commit'
    | 'commit-create-pr';

export interface QaapGitCommitWorkflowRequest {
    /** Absolute filesystem path of the repository root. */
    root: string;
    action: QaapGitCommitWorkflowAction;
    /** Required for create-branch-* actions. */
    branchName?: string;
    /** Commit message (required for commit actions). */
    message: string;
}

/** Parse the body of a `git diff` unified patch into structured hunks. */
export function parseUnifiedDiff(patch: string): QaapGitHunk[] {
    const hunks: QaapGitHunk[] = [];
    let current: QaapGitHunk | undefined;
    let oldNumber = 0;
    let newNumber = 0;
    for (const line of patch.split('\n')) {
        if (line.startsWith('@@')) {
            const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
            oldNumber = match ? Number(match[1]) : 0;
            newNumber = match ? Number(match[2]) : 0;
            current = { header: line, lines: [] };
            hunks.push(current);
            continue;
        }
        if (!current) {
            continue;
        }
        if (line.startsWith('+')) {
            current.lines.push({ type: 'add', newNumber: newNumber++, text: line.slice(1) });
        } else if (line.startsWith('-')) {
            current.lines.push({ type: 'del', oldNumber: oldNumber++, text: line.slice(1) });
        } else if (line.startsWith('\\')) {
            // "\ No newline at end of file" — skip.
        } else {
            current.lines.push({ type: 'ctx', oldNumber: oldNumber++, newNumber: newNumber++, text: line.slice(1) });
        }
    }
    return hunks;
}

/** Exact message from {@link resolveRepositoryRoot} when `root` is missing/invalid. */
export const QAAP_GIT_REVIEW_MISSING_ROOT_ERROR = 'Missing or invalid "root" query parameter.';

/** Exact message when `root` exists but is not a git work tree. */
export const QAAP_GIT_REVIEW_NOT_REPO_ERROR = 'The given root is not a git repository.';

/**
 * Pull `{ error }` out of a git-review HTTP body, or return trimmed plain text.
 * Used so UI sheets never dump raw JSON into the composer.
 */
export function readQaapGitReviewErrorBody(text: string): string | undefined {
    const trimmed = text.trim();
    if (!trimmed) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(trimmed) as { error?: unknown };
        if (typeof parsed?.error === 'string' && parsed.error.trim()) {
            return parsed.error.trim();
        }
    } catch {
        /* plain text */
    }
    return trimmed;
}

/** True when the backend rejected the repository root path. */
export function isQaapGitReviewMissingRootError(message: string | undefined): boolean {
    return !!message && message.includes('Missing or invalid') && message.includes('root');
}

/** True when the path exists but is not a git work tree. */
export function isQaapGitReviewNotRepoError(message: string | undefined): boolean {
    return !!message && message.includes('not a git repository');
}

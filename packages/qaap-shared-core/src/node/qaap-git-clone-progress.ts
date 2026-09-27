// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapGithubWorkspaceJobPhase } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';

/** One progress step reported while a repository workspace is prepared. */
export interface QaapWorkspaceProgressUpdate {
    readonly phase: QaapGithubWorkspaceJobPhase;
    /** Overall 0-100 progress; absent keeps the previous value (or indeterminate). */
    readonly percent?: number;
    readonly detail?: string;
}

export type QaapWorkspaceProgressReporter = (update: QaapWorkspaceProgressUpdate) => void;

/** `Receiving objects:  45% (450/1000), 1.20 MiB | 2.00 MiB/s` → stage + percent. */
const GIT_PROGRESS_LINE = /^(?:remote:\s*)?([A-Za-z][A-Za-z ]*?):\s+(\d{1,3})%/;

/** Overall percent window per git stage, for `git clone` and `git fetch`. */
const CLONE_STAGE_WINDOWS: Record<string, readonly [number, number]> = {
    'enumerating objects': [5, 6],
    'counting objects': [6, 8],
    'compressing objects': [8, 10],
    'receiving objects': [10, 75],
    'resolving deltas': [75, 88],
    'updating files': [88, 95],
    'checking out files': [88, 95],
};
const FETCH_STAGE_WINDOWS: Record<string, readonly [number, number]> = {
    'enumerating objects': [5, 6],
    'counting objects': [6, 8],
    'compressing objects': [8, 10],
    'receiving objects': [10, 80],
    'resolving deltas': [80, 95],
};

/**
 * Incremental parser for `git clone --progress` / `git fetch --progress` stderr. Git redraws its
 * progress with `\r`, so chunks are split on both `\r` and `\n`; a trailing partial line is kept
 * until the next chunk completes it.
 */
export class QaapGitProgressParser {

    protected pending = '';
    protected lastPercent = -1;

    constructor(
        protected readonly mode: 'clone' | 'fetch',
        protected readonly report: QaapWorkspaceProgressReporter,
    ) { }

    push(chunk: string): void {
        const text = this.pending + chunk;
        const parts = text.split(/[\r\n]/);
        this.pending = parts.pop() ?? '';
        for (const line of parts) {
            this.parseLine(line);
        }
        // Git flushes a progress line before its `\r`; parsing the partial tail keeps the bar live.
        if (this.pending) {
            this.parseLine(this.pending);
        }
    }

    protected parseLine(raw: string): void {
        const line = raw.trim();
        if (!line) {
            return;
        }
        const match = GIT_PROGRESS_LINE.exec(line);
        if (!match) {
            return;
        }
        const stage = match[1].trim().toLowerCase();
        const windows = this.mode === 'clone' ? CLONE_STAGE_WINDOWS : FETCH_STAGE_WINDOWS;
        const window = windows[stage];
        if (!window) {
            return;
        }
        const stagePercent = Math.max(0, Math.min(100, Number(match[2])));
        const overall = Math.round(window[0] + (window[1] - window[0]) * stagePercent / 100);
        // Stages only move forward; never let a late `remote:` line pull the bar back.
        const percent = Math.max(overall, this.lastPercent);
        this.lastPercent = percent;
        const phase: QaapGithubWorkspaceJobPhase = this.mode === 'fetch'
            ? 'fetching'
            : stage === 'updating files' || stage === 'checking out files' ? 'checking-out' : 'cloning';
        this.report({ phase, percent, detail: redactGitCredentials(line.replace(/^remote:\s*/, '').replace(/,\s*done\.?$/, '')) });
    }
}

/** Remove anything that could carry a credential from git output before it leaves the server. */
export function redactGitCredentials(text: string): string {
    return text
        .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1***@')
        .replace(/(authorization:\s*(?:basic|bearer|token)\s+)\S+/gi, '$1***')
        .replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '***');
}

const GIT_NOISE_LINE = /^(?:remote:\s*)?(?:[A-Za-z][A-Za-z ]*:\s+\d{1,3}%|Enumerating objects|Counting objects|Compressing objects|Total \d+|Cloning into|Fetching )/;

/**
 * A readable failure from git's stderr: progress lines are dropped (a failed clone would otherwise
 * report hundreds of `Receiving objects` redraws), `fatal:`/`error:` lines are preferred and
 * credentials are redacted.
 */
export function summarizeGitFailure(stderr: string, exitCode: number | null | undefined): string {
    const lines = stderr
        .split(/[\r\n]/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !GIT_NOISE_LINE.test(line));
    const important = lines.filter(line => /^(?:fatal|error):/i.test(line));
    const chosen = (important.length > 0 ? important : lines).slice(-3);
    const message = redactGitCredentials(chosen.join(' ')).slice(0, 600);
    return message || `git exited with status ${exitCode ?? 'unknown'}`;
}

/**
 * Map a low-level failure (git stderr, GitHub API status, fs error) to a message a user can act
 * on. Unknown failures keep their (already redacted) text.
 */
export function describeRepositoryImportFailure(message: string): string {
    const text = redactGitCredentials(message);
    if (/cancelled/i.test(text)) {
        return 'Import cancelled.';
    }
    if (/repository not found|GitHub repository API failed \(404\)|could not read Username|Authentication failed|terminal prompts disabled/i.test(text)) {
        return 'GitHub repository not found, or you do not have access to it. Check the URL, '
            + 'or sign in with GitHub to import private repositories.';
    }
    if (/GitHub repository API failed \((?:401|403)\)|rate limit/i.test(text)) {
        return 'GitHub refused the request (permissions or rate limit). Sign in again with GitHub or try later.';
    }
    if (/Could not resolve host|Failed to connect|Connection (?:timed out|reset|refused)|unable to access|early EOF|RPC failed|GitHub repository request timed out/i.test(text)) {
        return 'Could not download the repository from GitHub. Check that GitHub is reachable and try again.';
    }
    if (/No space left on device|Disk quota exceeded|ENOSPC/i.test(text)) {
        return 'The workspace is out of disk space. Remove projects you no longer need and try again.';
    }
    if (/Permission denied|EACCES|EPERM/i.test(text)) {
        return 'The workspace folder is not writable for your account. Try again, and contact support if it persists.';
    }
    if (/timed out/i.test(text)) {
        return 'The import took too long and was stopped. Large repositories can take a few minutes; try again.';
    }
    if (/already exists and is not a Git repository/i.test(text)) {
        return 'A folder with this repository name already exists in your workspace but is not a Git repository. '
            + 'Remove or rename it, then try again.';
    }
    return text || 'The repository could not be imported.';
}

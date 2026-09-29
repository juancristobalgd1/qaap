// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Git utility helpers extracted from QaapAgentConversationStore.
// Pure functions that operate only on their parameters.

import { execFile, spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { parseGitNumstat } from './qaap-agent-conversation-store-constants';

const SAFE_GIT_CONFIG = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false'] as const;

/** Synchronous read-only Git seam; hosted callers provide the tenant-worker implementation. */
export type QaapGitReadSync = (cwd: string, args: readonly string[]) => SpawnSyncReturns<string>;

const localGitReadSync: QaapGitReadSync = (cwd, args) => spawnSync(
    'git',
    [...SAFE_GIT_CONFIG, ...args],
    { cwd, encoding: 'utf8', timeout: 4000 },
);

/** Outcome of an async git child process; never rejects (spawn error, timeout or buffer overflow yield `status: null`). */
export interface QaapGitRunResult {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly timedOut?: boolean;
}

/** Async read-only Git seam (turn settle path); hosted callers provide the tenant-worker implementation. */
export type QaapGitRead = (cwd: string, args: readonly string[]) => Promise<QaapGitRunResult>;

export interface QaapRunGitAsyncOptions {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs: number;
    readonly maxBuffer?: number;
}

/** Default timeout for the turn-settle / checkpoint git commands. */
export const QAAP_GIT_DEFAULT_TIMEOUT_MS = 15_000;
/** `git add -A` hashes the whole worktree; large repos legitimately need longer. */
export const QAAP_GIT_ADD_ALL_TIMEOUT_MS = 60_000;

/**
 * Run a git (or tenant-wrapped git) process without blocking the event loop. Mirrors the
 * `spawnSync` result shape callers relied on: non-zero exit sets `status`; spawn failure,
 * timeout or buffer overflow yield `status: null`. Never rejects.
 */
export function runGitAsync(file: string, args: readonly string[], options: QaapRunGitAsyncOptions): Promise<QaapGitRunResult> {
    return new Promise<QaapGitRunResult>(resolve => {
        try {
            execFile(file, [...args], {
                cwd: options.cwd,
                env: options.env,
                encoding: 'utf8',
                timeout: options.timeoutMs,
                killSignal: 'SIGKILL',
                maxBuffer: options.maxBuffer ?? 64 * 1024 * 1024,
                windowsHide: true,
            }, (error, stdout, stderr) => {
                const out = typeof stdout === 'string' ? stdout : '';
                const err = typeof stderr === 'string' ? stderr : '';
                if (!error) {
                    resolve({ status: 0, stdout: out, stderr: err });
                    return;
                }
                const failure = error as Error & { code?: number | string; killed?: boolean; signal?: NodeJS.Signals | null };
                const timedOut = failure.killed === true && failure.signal === 'SIGKILL';
                const status = typeof failure.code === 'number' && !timedOut ? failure.code : null;
                resolve({ status, stdout: out, stderr: err || failure.message, timedOut: timedOut || undefined });
            });
        } catch (error) {
            resolve({ status: null, stdout: '', stderr: error instanceof Error ? error.message : String(error) });
        }
    });
}

const localGitRead: QaapGitRead = (cwd, args) => runGitAsync('git', [...SAFE_GIT_CONFIG, ...args], { cwd, timeoutMs: 4000 });

/** True only when `cwd` itself is a git root/worktree — never walk to a parent repository. */
export function cwdIsGitRepository(cwd: string): boolean {
    try {
        return fs.existsSync(path.join(cwd, '.git'));
    } catch {
        return false;
    }
}

/**
 * Parse `owner/repo` from a GitHub remote URL. Uses `URL` for https remotes so a path like
 * `/juancristobalgd1/qaap.git` cannot match as owner=`juancristobalgd1`, name=`q` (the previous
 * unanchored `(.+?)(?:\.git)?` regex stopped at the first "git" substring).
 */
export function parseGithubRepoFromRemoteUrl(url: string): { owner: string; name: string } | undefined {
    const trimmed = url.trim();
    if (!trimmed) {
        return undefined;
    }
    const ssh = /^git@github\.com:([^/]+)\/([^/]+)$/i.exec(trimmed);
    if (ssh) {
        return { owner: ssh[1], name: ssh[2].replace(/\.git$/i, '') };
    }
    try {
        const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
            ? trimmed
            : `https://${trimmed}`;
        const parsed = new URL(withProtocol);
        if (!/(^|\.)github\.com$/i.test(parsed.hostname)) {
            return undefined;
        }
        const parts = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '').split('/');
        if (parts.length >= 2 && parts[0] && parts[1]) {
            return { owner: parts[0], name: parts[1] };
        }
    } catch {
        return undefined;
    }
    return undefined;
}

export function parseGithubRepoFromCwd(cwd: string, gitRead: QaapGitReadSync = localGitReadSync): { owner: string; name: string } | undefined {
    if (!cwdIsGitRepository(cwd)) {
        return undefined;
    }
    try {
        const result = gitRead(cwd, ['remote', 'get-url', 'origin']);
        if (result.status !== 0) {
            return undefined;
        }
        return parseGithubRepoFromRemoteUrl(result.stdout);
    } catch { /* not a git repo */ }
    return undefined;
}

export function readGitBranch(cwd: string, gitRead: QaapGitReadSync = localGitReadSync): string | undefined {
    try {
        const result = gitRead(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
        if (result.status === 0) {
            const branch = result.stdout.trim();
            return branch && branch !== 'HEAD' ? branch : undefined;
        }
    } catch { /* not a git repo */ }
    return undefined;
}

export function captureGitSha(cwd: string, gitRead: QaapGitReadSync = localGitReadSync): string | undefined {
    try {
        const result = gitRead(cwd, ['rev-parse', 'HEAD']);
        if (result.status === 0) {
            return result.stdout.trim();
        }
    } catch { /* not a git repo */ }
    return undefined;
}

/**
 * Serializes async git jobs per repository (normalized cwd). Two turns settling on the same
 * checkout (peer runs, rewind during settle) must not interleave their `read-tree`/`add -A`/
 * `update-ref` sequences or race on `.git/index.lock`. Jobs on different repositories run in
 * parallel. A job failure never poisons the chain for later jobs.
 */
export class QaapGitCwdSerializer {
    protected readonly tails = new Map<string, Promise<unknown>>();

    run<T>(cwd: string, job: () => Promise<T>): Promise<T> {
        const key = this.keyFor(cwd);
        const previous = this.tails.get(key) ?? Promise.resolve();
        const result = previous.then(job, job);
        const tail = result.then(() => undefined, () => undefined);
        this.tails.set(key, tail);
        void tail.then(() => {
            if (this.tails.get(key) === tail) {
                this.tails.delete(key);
            }
        });
        return result;
    }

    /** Number of repositories with queued/running jobs (test/diagnostic seam). */
    get pendingKeys(): number {
        return this.tails.size;
    }

    protected keyFor(cwd: string): string {
        const resolved = path.resolve(cwd);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }
}

/** Line counts changed since `startSha` (committed) plus the uncommitted worktree; async so settling never blocks the backend. */
export async function computeGitDiffStats(cwd: string, startSha?: string, gitRead: QaapGitRead = localGitRead): Promise<{ added: number; removed: number } | undefined> {
    try {
        let added = 0;
        let removed = 0;
        if (startSha) {
            const committed = await gitRead(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', `${startSha}..HEAD`]);
            if (committed.status === 0 && committed.stdout) {
                const stats = parseGitNumstat(committed.stdout);
                added += stats.added;
                removed += stats.removed;
            }
        }
        const uncommitted = await gitRead(cwd, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', 'HEAD']);
        if (uncommitted.status === 0 && uncommitted.stdout) {
            const stats = parseGitNumstat(uncommitted.stdout);
            added += stats.added;
            removed += stats.removed;
        }
        if (added === 0 && removed === 0) {
            return undefined;
        }
        return { added, removed };
    } catch {
        return undefined;
    }
}

export function checkpointLabel(content: string): string {
    const clean = content.replace(/\s+/g, ' ').trim();
    return clean.length > 60 ? `${clean.slice(0, 57)}…` : (clean || 'Turn');
}

export function isDirectory(target: string): boolean {
    try {
        return fs.statSync(target).isDirectory();
    } catch {
        return false;
    }
}

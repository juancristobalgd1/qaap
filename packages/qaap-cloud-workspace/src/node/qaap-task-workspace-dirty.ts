// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { cwdIsGitRepository, type QaapGitRead } from './qaap-agent-conversation-store-git';

/** Paths listed in a `dirty_workspace` 409 response; the total is always reported in full. */
export const QAAP_DIRTY_WORKSPACE_LISTED_FILES = 20;

/** How a new task picks its working tree when the shared copy is dirty (`QAAP_TASK_ISOLATION`). */
export type QaapTaskIsolationMode = 'auto' | 'dirty' | 'worktree';

/** Uncommitted paths in a shared working tree; `total` counts every path, `files` keeps the first few. */
export interface QaapDirtyWorkspace {
    readonly files: readonly string[];
    readonly total: number;
}

/**
 * Outcome of the dirty check. `unknown` means git could not answer (timeout, error); callers must not
 * treat it as dirty or clean without saying so.
 */
export type QaapDirtyWorkspaceCheck =
    | { readonly kind: 'clean' }
    | { readonly kind: 'dirty'; readonly files: readonly string[]; readonly total: number }
    | { readonly kind: 'unknown'; readonly reason: string };

/** Git flags for a read-only status that never takes optional locks, runs fsmonitor or hooks. */
const DIRTY_CHECK_GIT_ARGS: readonly string[] = [
    '-c', 'core.fsmonitor=false',
    '-c', 'core.hooksPath=/dev/null',
    '--no-optional-locks',
    'status', '--porcelain=v1', '-z', '--untracked-files=all',
];

/**
 * Reads `QAAP_TASK_ISOLATION`. Unset or unknown values mean `auto`: the default that warns and asks
 * before a task shares a dirty tree.
 */
export function resolveTaskIsolationMode(env: NodeJS.ProcessEnv = process.env): QaapTaskIsolationMode {
    const value = (env.QAAP_TASK_ISOLATION ?? '').trim().toLowerCase();
    return value === 'dirty' || value === 'worktree' ? value : 'auto';
}

/**
 * Uncommitted changes (tracked and untracked) in `cwd` through the tenant-aware git seam. A directory
 * that is not a git repository is `clean` (nothing to protect); a git failure or timeout is `unknown`.
 * Never throws.
 */
export async function readDirtyWorkspace(cwd: string, gitRead: QaapGitRead): Promise<QaapDirtyWorkspaceCheck> {
    if (!cwdIsGitRepository(cwd)) {
        return { kind: 'clean' };
    }
    let result;
    try {
        result = await gitRead(cwd, DIRTY_CHECK_GIT_ARGS);
    } catch (error) {
        return { kind: 'unknown', reason: error instanceof Error ? error.message : String(error) };
    }
    if (result.timedOut) {
        return { kind: 'unknown', reason: 'git status timed out' };
    }
    if (result.status !== 0) {
        return { kind: 'unknown', reason: result.stderr.trim() || `git status exited with ${String(result.status)}` };
    }
    const entries = result.stdout.split('\0');
    const files: string[] = [];
    let total = 0;
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (entry.length < 4) {
            continue;
        }
        total++;
        if (files.length < QAAP_DIRTY_WORKSPACE_LISTED_FILES) {
            files.push(entry.slice(3));
        }
        // A rename or copy is followed by its original path as a separate NUL-terminated entry.
        if (entry[0] === 'R' || entry[0] === 'C' || entry[1] === 'R' || entry[1] === 'C') {
            index++;
        }
    }
    return total > 0 ? { kind: 'dirty', files, total } : { kind: 'clean' };
}

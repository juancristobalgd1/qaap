// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { cwdIsGitRepository, runGitAsync } from './qaap-agent-conversation-store-git';

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
 * Reads `QAAP_TASK_ISOLATION`. Unset or unknown values mean `auto`: the default that warns and asks
 * before a task shares a dirty tree.
 */
export function resolveTaskIsolationMode(env: NodeJS.ProcessEnv = process.env): QaapTaskIsolationMode {
    const value = (env.QAAP_TASK_ISOLATION ?? '').trim().toLowerCase();
    return value === 'dirty' || value === 'worktree' ? value : 'auto';
}

/**
 * Uncommitted changes (tracked and untracked) in `cwd`, or `undefined` when the tree is clean, is not
 * a git repository, or git cannot be read. Never throws.
 */
export async function readDirtyWorkspace(cwd: string): Promise<QaapDirtyWorkspace | undefined> {
    if (!cwdIsGitRepository(cwd)) {
        return undefined;
    }
    const result = await runGitAsync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd, timeoutMs: 4000 });
    if (result.status !== 0) {
        return undefined;
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
    return total > 0 ? { files, total } : undefined;
}

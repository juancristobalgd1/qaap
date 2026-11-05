// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Read-only git seam for {@link resolveTemporaryIndexDir}; hosted callers route it through the tenant worker. */
export type QaapTreeGitLookup = (cwd: string, args: readonly string[]) => Promise<QaapTreeGitResult>;

/** Timeout for `git add -A` over a whole worktree; large repositories legitimately need longer. */
export const QAAP_GIT_TREE_ADD_ALL_TIMEOUT_MS = 60_000;

/** Minimal result shape of a git invocation; never rejects (spawn failure yields `status: null`). */
export interface QaapTreeGitResult {
    readonly status: number | null;
    readonly stdout: string;
}

/** Read-only git seam used by {@link computeTreeDiff}. */
export type QaapTreeGitRead = (cwd: string, args: readonly string[]) => Promise<QaapTreeGitResult>;

/** Git seam used by {@link snapshotWorktreeTree}; `env` carries the throwaway `GIT_INDEX_FILE`. */
export type QaapTreeGitWrite = (cwd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs?: number) => Promise<QaapTreeGitResult>;

/** One path changed between two trees. `status` is the git status letter (`A`, `M`, `D`, `R`, `C`, `T`). */
export interface QaapTreeDiffFile {
    readonly path: string;
    /** Previous path for renames and copies. */
    readonly oldPath?: string;
    readonly status: string;
    /** Added lines; binary files count as 0. */
    readonly added: number;
    /** Removed lines; binary files count as 0. */
    readonly removed: number;
}

/** Line and file totals between two trees. An empty `files` list means no change. */
export interface QaapTreeDiff {
    readonly added: number;
    readonly removed: number;
    readonly files: readonly QaapTreeDiffFile[];
}

/**
 * Refuses an index file that is not a throwaway one: unset, or the repository's real index
 * (`.git/index`, or any file named `index`). Throws before any git command runs.
 */
export function assertTemporaryIndexFile(indexFile: string | undefined, cwd: string): string {
    if (!indexFile) {
        throw new Error('Refusing to run a worktree snapshot without a temporary GIT_INDEX_FILE.');
    }
    const resolved = path.resolve(indexFile);
    if (path.basename(resolved) === 'index' || resolved === path.resolve(cwd, '.git', 'index')) {
        throw new Error('Refusing to run a worktree snapshot against the repository index.');
    }
    return resolved;
}

/**
 * Absolute git directory of `cwd`, where throwaway snapshot indexes are kept. The `.git` directory is
 * used directly when present (the common case); worktrees resolve through `git rev-parse`. `undefined`
 * when `cwd` is not a repository.
 */
export async function resolveTemporaryIndexDir(cwd: string, gitRead: QaapTreeGitLookup): Promise<string | undefined> {
    try {
        if (fs.statSync(path.join(cwd, '.git')).isDirectory()) {
            return path.join(cwd, '.git');
        }
    } catch {
        // Not a plain repository directory; ask git below.
    }
    const result = await gitRead(cwd, ['rev-parse', '--absolute-git-dir']);
    const dir = result.status === 0 ? result.stdout.trim() : '';
    return dir || undefined;
}

/**
 * Write the current worktree (tracked and untracked, honouring ignore rules) into a git tree object
 * through a throwaway index, so the real `.git/index` is never touched. Returns the tree id, or
 * `undefined` when git fails. The throwaway index lives under `indexDir` (the repository's git
 * directory, see {@link resolveTemporaryIndexDir}) so the same environment that runs git can remove it.
 * `seedIndexFile` (the real `index` of that git directory) is only read, copied, never written.
 * The temporary index and its lock are always removed, after git has exited.
 */
export async function snapshotWorktreeTree(cwd: string, git: QaapTreeGitWrite, indexDir: string, seedIndexFile?: string): Promise<string | undefined> {
    const tmpIndex = path.join(indexDir, `qaap-ckpt-${randomUUID()}.index`);
    const env = { ...process.env, GIT_INDEX_FILE: assertTemporaryIndexFile(tmpIndex, cwd) };
    try {
        // Seed from a copy of the real index when given: its stat cache lets `add -A` hash only what changed.
        // Otherwise (or when the copy fails) seed from HEAD when a commit exists; an empty repo is fine.
        const seeded = seedIndexFile !== undefined && await fs.promises.copyFile(seedIndexFile, tmpIndex).then(() => true, () => false);
        if (!seeded) {
            await git(cwd, ['read-tree', 'HEAD'], env);
        }
        if ((await git(cwd, ['add', '-A'], env, QAAP_GIT_TREE_ADD_ALL_TIMEOUT_MS)).status !== 0) {
            return undefined;
        }
        const tree = await git(cwd, ['write-tree'], env);
        const treeId = tree.status === 0 ? tree.stdout.trim() : '';
        return treeId || undefined;
    } catch {
        return undefined;
    } finally {
        // A timed-out (SIGKILLed) git can leave the throwaway index lock behind; drop both.
        await Promise.all([tmpIndex, `${tmpIndex}.lock`].map(file => fs.promises.rm(file, { force: true }).catch(() => undefined)));
    }
}

/**
 * Line and file changes from `baseCommit` (or any tree-ish) to `currentTree`, using NUL-terminated
 * git output so paths with spaces, tabs or newlines parse safely. Returns `undefined` when git
 * fails; an unchanged pair yields an empty `files` list.
 */
export async function computeTreeDiff(cwd: string, baseCommit: string, currentTree: string, gitRead: QaapTreeGitRead): Promise<QaapTreeDiff | undefined> {
    const flags = ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-z'];
    const [numstat, nameStatus] = await Promise.all([
        gitRead(cwd, [...flags, '--numstat', baseCommit, currentTree]),
        gitRead(cwd, [...flags, '--name-status', baseCommit, currentTree]),
    ]);
    if (numstat.status !== 0 || nameStatus.status !== 0) {
        return undefined;
    }
    const counts = parseNumstatZ(numstat.stdout);
    const files: QaapTreeDiffFile[] = parseNameStatusZ(nameStatus.stdout).map(entry => {
        const stats = counts.get(entry.path);
        return {
            path: entry.path,
            ...(entry.oldPath !== undefined ? { oldPath: entry.oldPath } : {}),
            status: entry.status,
            added: stats?.added ?? 0,
            removed: stats?.removed ?? 0,
        };
    });
    return {
        added: files.reduce((sum, file) => sum + file.added, 0),
        removed: files.reduce((sum, file) => sum + file.removed, 0),
        files,
    };
}

/**
 * Parse `git diff --numstat -z`: `added\tremoved\tpath\0`, or for renames `added\tremoved\t\0old\0new\0`.
 * Returns counts keyed by the new path.
 */
export function parseNumstatZ(output: string): Map<string, { added: number; removed: number }> {
    const tokens = output.split('\0');
    const counts = new Map<string, { added: number; removed: number }>();
    for (let index = 0; index < tokens.length; index++) {
        const token = tokens[index];
        const first = token.indexOf('\t');
        const second = first < 0 ? -1 : token.indexOf('\t', first + 1);
        if (second < 0) {
            continue;
        }
        const added = parseInt(token.slice(0, first), 10);
        const removed = parseInt(token.slice(first + 1, second), 10);
        let filePath = token.slice(second + 1);
        if (filePath === '') {
            // Rename: the old and new paths follow as separate NUL-terminated tokens.
            filePath = tokens[index + 2] ?? '';
            index += 2;
        }
        if (filePath) {
            counts.set(filePath, { added: isNaN(added) ? 0 : added, removed: isNaN(removed) ? 0 : removed });
        }
    }
    return counts;
}

/**
 * Parse `git diff --name-status -z`: `M\0path\0`, or for renames and copies `R100\0old\0new\0`.
 */
export function parseNameStatusZ(output: string): Array<{ path: string; oldPath?: string; status: string }> {
    const tokens = output.split('\0');
    const entries: Array<{ path: string; oldPath?: string; status: string }> = [];
    for (let index = 0; index < tokens.length; index++) {
        const code = tokens[index];
        if (!code) {
            continue;
        }
        const letter = code.charAt(0);
        if (letter === 'R' || letter === 'C') {
            const oldPath = tokens[index + 1] ?? '';
            const newPath = tokens[index + 2] ?? '';
            index += 2;
            if (newPath) {
                entries.push({ path: newPath, oldPath, status: letter });
            }
        } else {
            const filePath = tokens[index + 1] ?? '';
            index += 1;
            if (filePath) {
                entries.push({ path: filePath, status: letter });
            }
        }
    }
    return entries;
}

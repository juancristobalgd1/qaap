// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
    buildRewindPreviewDTO,
    classifyRewindFiles,
    resolveRewindBaselineCommit,
    rewindRestoreConfirmationError,
    selectRewindFiles,
    type QaapRewindFileState,
    type QaapRewindPreviewDTO,
    type QaapRewindPreviewFileDTO,
    type QaapRewindRestoreOptions,
} from '@theia/qaap-shared-core/lib/common/qaap-conversation-rewind-preview';
import type { QaapAgentConversation, QaapConversationCheckpoint } from '../common/qaap-agent-conversation';
import { QAAP_GIT_ADD_ALL_TIMEOUT_MS, type QaapGitRunResult } from './qaap-agent-conversation-store-git';

/**
 * Runs `git <args>` in the conversation workspace without blocking the event loop (the store
 * passes its tenant-wrapped `mutatingGit`). Never rejects; failures surface as a non-zero status.
 */
export type QaapRewindGitRunner = (args: string[], env?: NodeJS.ProcessEnv, timeoutMs?: number) => Promise<QaapGitRunResult>;

const NULL_BLOB = /^0+$/;
const PATHSPEC_CHUNK = 200;

function literal(filePath: string): string {
    return `:(literal)${filePath}`;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        out.push(items.slice(i, i + size));
    }
    return out;
}

async function runOrThrow(git: QaapRewindGitRunner, args: string[], what: string, env?: NodeJS.ProcessEnv, timeoutMs?: number): Promise<string> {
    const result = await git(args, env, timeoutMs);
    if (result.status !== 0) {
        const detail = (result.stderr || '').trim() || (result.timedOut ? 'timed out' : 'git error');
        throw new Error(`${what} failed: ${detail}`);
    }
    return result.stdout ?? '';
}

/**
 * Tree id of the current working tree (tracked + untracked, excluding ignored files), written
 * through a throwaway index so the user's real index is never touched. Mirrors checkpoint capture.
 */
export async function snapshotRewindWorkingTree(git: QaapRewindGitRunner): Promise<string> {
    const tmpIndex = path.join(os.tmpdir(), `qaap-rewind-preview-${randomUUID()}.index`);
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    try {
        await git(['read-tree', 'HEAD'], env);
        // `add -A` hashes the whole worktree: same budget as checkpoint capture.
        await runOrThrow(git, ['add', '-A'], 'Working tree snapshot', env, QAAP_GIT_ADD_ALL_TIMEOUT_MS);
        const tree = (await runOrThrow(git, ['write-tree'], 'Working tree snapshot', env)).trim();
        if (!tree) {
            throw new Error('Working tree snapshot failed: empty tree id');
        }
        return tree;
    } finally {
        try {
            await fs.promises.rm(tmpIndex, { force: true });
        } catch { /* ignore */ }
    }
}

interface RawDiffEntry {
    readonly path: string;
    /** Blob on the left side, `undefined` when absent. */
    readonly from?: string;
    /** Blob on the right side, `undefined` when absent. */
    readonly to?: string;
}

/** Parse `git diff-tree -r -z --raw --no-renames A B`. */
export function parseRewindRawDiff(stdout: string): RawDiffEntry[] {
    const parts = stdout.split('\0');
    const entries: RawDiffEntry[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
        const header = parts[i].replace(/^\n/, '');
        const filePath = parts[i + 1];
        if (!header.startsWith(':') || !filePath) {
            continue;
        }
        const [, , fromSha, toSha] = header.slice(1).split(' ');
        entries.push({
            path: filePath,
            from: fromSha && !NULL_BLOB.test(fromSha) ? fromSha : undefined,
            to: toSha && !NULL_BLOB.test(toSha) ? toSha : undefined,
        });
    }
    return entries;
}

/** Parse `git diff-tree -r -z --numstat --no-renames A B` (binary files report `-`). */
export function parseRewindNumstat(stdout: string): Map<string, { added?: number; removed?: number; binary: boolean }> {
    const stats = new Map<string, { added?: number; removed?: number; binary: boolean }>();
    for (const record of stdout.split('\0')) {
        const match = /^\n?(-|\d+)\t(-|\d+)\t(.+)$/s.exec(record);
        if (!match) {
            continue;
        }
        const binary = match[1] === '-' || match[2] === '-';
        stats.set(match[3], {
            binary,
            added: binary ? undefined : Number(match[1]),
            removed: binary ? undefined : Number(match[2]),
        });
    }
    return stats;
}

async function diffTrees(git: QaapRewindGitRunner, from: string, to: string): Promise<RawDiffEntry[]> {
    return parseRewindRawDiff(await runOrThrow(git, ['diff-tree', '-r', '-z', '--raw', '--no-renames', from, to], 'Rewind preview diff'));
}

async function trackedPaths(git: QaapRewindGitRunner, paths: readonly string[]): Promise<Set<string>> {
    const tracked = new Set<string>();
    for (const chunk of chunks(paths, PATHSPEC_CHUNK)) {
        const out = await runOrThrow(git, ['ls-files', '-z', '--', ...chunk.map(literal)], 'Rewind preview ls-files');
        out.split('\0').filter(Boolean).forEach(p => tracked.add(p));
    }
    return tracked;
}

async function conflictedPaths(git: QaapRewindGitRunner): Promise<Set<string>> {
    const result = await git(['ls-files', '-u', '-z']);
    const conflicted = new Set<string>();
    if (result.status !== 0) {
        return conflicted;
    }
    for (const record of (result.stdout ?? '').split('\0')) {
        const tab = record.indexOf('\t');
        if (tab > 0) {
            conflicted.add(record.slice(tab + 1));
        }
    }
    return conflicted;
}

async function diskInfo(cwd: string, filePath: string): Promise<{ exists: boolean; size?: number }> {
    try {
        const stat = await fs.promises.lstat(path.join(cwd, filePath));
        return { exists: true, size: stat.isFile() ? stat.size : undefined };
    } catch {
        return { exists: false };
    }
}

/** Gather per-path facts (target vs current vs baseline) for {@link classifyRewindFiles}. */
export async function collectRewindFileStates(
    git: QaapRewindGitRunner,
    cwd: string,
    targetCommit: string,
    baselineCommit: string | undefined,
): Promise<QaapRewindFileState[]> {
    const currentTree = await snapshotRewindWorkingTree(git);
    const changes = await diffTrees(git, targetCommit, currentTree);
    if (!changes.length) {
        return [];
    }
    const numstat = parseRewindNumstat(await runOrThrow(
        git, ['diff-tree', '-r', '-z', '--numstat', '--no-renames', currentTree, targetCommit], 'Rewind preview numstat'));
    // current → baseline: only paths listed here differ from what Qaap last left on disk.
    let baselineDiff: Map<string, string | undefined> | undefined;
    if (baselineCommit) {
        const verify = await git(['cat-file', '-e', `${baselineCommit}^{commit}`]);
        if (verify.status === 0) {
            baselineDiff = new Map((await diffTrees(git, currentTree, baselineCommit)).map(entry => [entry.path, entry.to]));
        }
    }
    const deleteCandidates = changes.filter(change => change.from === undefined).map(change => change.path);
    const tracked = deleteCandidates.length ? await trackedPaths(git, deleteCandidates) : new Set<string>();
    const conflicted = await conflictedPaths(git);
    return Promise.all(changes.map(async change => {
        const disk = await diskInfo(cwd, change.path);
        const stats = numstat.get(change.path);
        const baseline = baselineDiff
            ? (baselineDiff.has(change.path) ? baselineDiff.get(change.path) : change.to)
            : undefined;
        return {
            path: change.path,
            target: change.from,
            current: change.to,
            baseline,
            // Only delete candidates need the index lookup; restore targets exist in the checkpoint.
            tracked: change.from === undefined ? tracked.has(change.path) : true,
            presentOnDisk: change.to === undefined ? disk.exists : undefined,
            conflicted: conflicted.has(change.path),
            binary: stats?.binary,
            sizeBytes: change.to !== undefined ? disk.size : undefined,
            added: stats?.added,
            removed: stats?.removed,
        };
    }));
}

/** Everything needed to preview or apply a restore of one checkpoint. */
export interface QaapRewindComputation {
    readonly preview: QaapRewindPreviewDTO;
    /** Full, uncapped classification (the DTO list may be truncated). */
    readonly files: QaapRewindPreviewFileDTO[];
    /** Paths from {@link files} that git does not track (deleted with `git clean`). */
    readonly untracked: ReadonlySet<string>;
}

export async function computeRewindPreview(
    git: QaapRewindGitRunner,
    conv: Pick<QaapAgentConversation, 'id' | 'cwd' | 'checkpoints'>,
    checkpoint: QaapConversationCheckpoint | undefined,
): Promise<QaapRewindComputation> {
    if (!checkpoint) {
        return {
            preview: buildRewindPreviewDTO({ conversationId: conv.id, hasRestore: false }, []),
            files: [],
            untracked: new Set(),
        };
    }
    if ((await git(['rev-parse', '--is-inside-work-tree'])).status !== 0) {
        throw new Error('The conversation workspace is not a git repository.');
    }
    const baselineCommit = resolveRewindBaselineCommit(conv.checkpoints);
    const states = await collectRewindFileStates(git, conv.cwd, checkpoint.commit, baselineCommit);
    const baselineKnown = !!baselineCommit && (await git(['cat-file', '-e', `${baselineCommit}^{commit}`])).status === 0;
    const files = classifyRewindFiles(states, { baselineKnown });
    const untracked = new Set(states.filter(state => !state.tracked).map(state => state.path));
    return {
        preview: buildRewindPreviewDTO({
            conversationId: conv.id,
            hasRestore: true,
            checkpointId: checkpoint.id,
            checkpointLabel: checkpoint.label,
            targetCommit: checkpoint.commit,
            baselineCommit: baselineKnown ? baselineCommit : undefined,
        }, files),
        files,
        untracked,
    };
}

/**
 * Apply a restore limited to `files`: tracked/target paths go through `git restore --source`
 * (which also removes tracked paths absent from the checkpoint); agent-created untracked files
 * are removed with `git clean` so the workspace really matches the checkpoint.
 */
export async function applyRewindRestore(
    git: QaapRewindGitRunner,
    targetCommit: string,
    files: readonly QaapRewindPreviewFileDTO[],
    untracked: ReadonlySet<string>,
): Promise<void> {
    const viaRestore = files.filter(file => !(file.action === 'delete' && untracked.has(file.path))).map(file => file.path);
    const viaClean = files.filter(file => file.action === 'delete' && untracked.has(file.path)).map(file => file.path);
    for (const chunk of chunks(viaRestore, PATHSPEC_CHUNK)) {
        await runOrThrow(git, ['restore', '--source', targetCommit, '--worktree', '--', ...chunk.map(literal)], 'Restore', undefined, QAAP_GIT_ADD_ALL_TIMEOUT_MS);
    }
    for (const chunk of chunks(viaClean, PATHSPEC_CHUNK)) {
        await runOrThrow(git, ['clean', '-f', '-q', '--', ...chunk.map(literal)], 'Restore');
    }
}

/** Thrown when an `all` restore includes unsafe files without `confirmUnsafe` (HTTP 409). */
export class QaapRewindConfirmationRequiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'QaapRewindConfirmationRequiredError';
    }
}

/**
 * Validate `options` against a fresh classification and return the work to apply. Computed at
 * restore time (not reused from the preview) so files changed after the preview are re-checked.
 */
export async function planRewindRestore(
    git: QaapRewindGitRunner,
    conv: Pick<QaapAgentConversation, 'id' | 'cwd' | 'checkpoints'>,
    checkpoint: QaapConversationCheckpoint,
    options: QaapRewindRestoreOptions,
): Promise<() => Promise<void>> {
    const computation = await computeRewindPreview(git, conv, checkpoint);
    const error = rewindRestoreConfirmationError(computation.files, options);
    if (error) {
        throw new QaapRewindConfirmationRequiredError(error);
    }
    const selected = selectRewindFiles(computation.files, options.mode);
    return () => applyRewindRestore(git, checkpoint.commit, selected, computation.untracked);
}

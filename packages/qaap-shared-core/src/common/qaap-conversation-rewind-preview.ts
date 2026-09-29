// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Rewind / checkpoint-restore dry run ("which files would this restore touch, and is it safe?").
 *
 * The backend collects a {@link QaapRewindFileState} per path from three git trees:
 *
 * - **target**: the checkpoint commit the user wants to go back to;
 * - **current**: a throwaway snapshot of the working tree right now (tracked + untracked, not ignored);
 * - **baseline**: the last working-tree state Qaap itself produced — the checkpoint captured at the
 *   end of the newest agent turn, or, when the newest checkpoint is the undo snapshot of an earlier
 *   restore/rewind, the commit that restore wrote back ({@link QaapRewindCheckpointLike.restoredFrom}).
 *
 * Heuristic: every change between *target* and *baseline* was made during agent turns (or by a
 * previous Qaap restore), so reverting it is **safe** as long as the file still matches *baseline*.
 * If *current* differs from *baseline*, something other than the agent (the user, an editor, a
 * formatter, another tool) touched the file after the agent's last turn — reverting would silently
 * drop that work, so the file is **unsafe**. Binary, large, conflicted and ignored-but-present
 * content is also unsafe because the user cannot review it in the preview.
 *
 * Known limitation: edits the user made *while* an agent turn was running are captured in that
 * turn's checkpoint and therefore look agent-made.
 */

export type QaapRewindFileAction = 'restore' | 'delete' | 'recreate';
export type QaapRewindFileSafety = 'safe' | 'unsafe';
export type QaapRewindUnsafeReason =
    /** Content differs from what the agent left (edited by the user or another tool). */
    | 'modified-externally'
    /** File did not exist when the agent finished; someone else created it. */
    | 'created-externally'
    /** The agent left this file but it has since been deleted by someone else. */
    | 'deleted-externally'
    /** Gitignored content on disk that would be overwritten. */
    | 'ignored-content'
    | 'binary'
    | 'large'
    /** Unmerged path in the git index. */
    | 'conflict'
    /** No agent-turn snapshot to compare against, so external edits cannot be ruled out. */
    | 'unknown-baseline';

export interface QaapRewindPreviewFileDTO {
    readonly path: string;
    readonly action: QaapRewindFileAction;
    readonly safety: QaapRewindFileSafety;
    readonly reasons: QaapRewindUnsafeReason[];
    /** Lines added/removed by the restore (target vs current); absent for binary files. */
    readonly added?: number;
    readonly removed?: number;
}

export interface QaapRewindPreviewDTO {
    readonly conversationId: string;
    /** `false` when the rewind would not touch files at all (e.g. rewinding the first message). */
    readonly hasRestore: boolean;
    readonly checkpointId?: string;
    readonly checkpointLabel?: string;
    readonly targetCommit?: string;
    readonly baselineCommit?: string;
    readonly files: QaapRewindPreviewFileDTO[];
    readonly safeCount: number;
    readonly unsafeCount: number;
    /** `true` when {@link files} was capped; counts still cover every file. */
    readonly truncated?: boolean;
    /**
     * Fingerprint of the unsafe files (path, current content, action) this preview showed. An `all`
     * restore must echo it, so files that became unsafe (or changed again) after the review are never
     * overwritten under a stale confirmation. Absent when nothing is unsafe.
     */
    readonly unsafeToken?: string;
}

export type QaapRewindRestoreMode = 'all' | 'safe';

/** Body of the restore / rewind POST requests. Omit to keep the legacy whole-tree restore. */
export interface QaapRewindRestoreOptions {
    readonly mode: QaapRewindRestoreMode;
    /** Required (`true`) when `mode === 'all'` and the restore includes unsafe files. */
    readonly confirmUnsafe?: boolean;
    /** {@link QaapRewindPreviewDTO.unsafeToken} of the preview the user confirmed (required with `confirmUnsafe`). */
    readonly unsafeToken?: string;
}

/** Per-path facts gathered from git; blob ids are `undefined` when the path is absent. */
export interface QaapRewindFileState {
    readonly path: string;
    readonly target?: string;
    readonly current?: string;
    readonly baseline?: string;
    /** Path is in the git index (tracked). */
    readonly tracked: boolean;
    /** `current` is absent from the snapshot but something exists on disk (gitignored content). */
    readonly presentOnDisk?: boolean;
    readonly conflicted?: boolean;
    readonly binary?: boolean;
    readonly sizeBytes?: number;
    readonly added?: number;
    readonly removed?: number;
}

export interface QaapRewindClassifyOptions {
    /** `false` when no baseline snapshot exists: every touched file is flagged `unknown-baseline`. */
    readonly baselineKnown: boolean;
    readonly largeFileBytes?: number;
}

export const QAAP_REWIND_LARGE_FILE_BYTES = 1024 * 1024;
export const QAAP_REWIND_PREVIEW_MAX_FILES = 1000;

/** Minimal checkpoint shape used to resolve the baseline (backend model and DTO both fit). */
export interface QaapRewindCheckpointLike {
    readonly commit: string;
    readonly label: string;
    /** Set on the undo snapshot of a restore/rewind: the commit the restore wrote back. */
    readonly restoredFrom?: string;
}

/** Labels of the undo snapshots created before a restore (see the store's diff module). */
export const QAAP_REWIND_UNDO_CHECKPOINT_LABELS: readonly string[] = ['Before restore', 'Before rewind'];

/**
 * Commit representing the last working-tree state Qaap produced, or `undefined` when unknown
 * (no checkpoints, or a legacy undo snapshot that did not record what it restored).
 */
export function resolveRewindBaselineCommit(checkpoints: readonly QaapRewindCheckpointLike[] | undefined): string | undefined {
    const newest = checkpoints?.length ? checkpoints[checkpoints.length - 1] : undefined;
    if (!newest) {
        return undefined;
    }
    if (newest.restoredFrom?.trim()) {
        return newest.restoredFrom.trim();
    }
    if (QAAP_REWIND_UNDO_CHECKPOINT_LABELS.includes(newest.label)) {
        return undefined;
    }
    return newest.commit?.trim() || undefined;
}

/**
 * Classify one path. Returns `undefined` when the restore would not touch it: content already
 * equals the target, or it is an untracked file the agent never saw (git restore leaves those).
 */
export function classifyRewindFile(
    state: QaapRewindFileState,
    options: QaapRewindClassifyOptions,
): QaapRewindPreviewFileDTO | undefined {
    const { target, current, baseline } = state;
    if (target === current) {
        return undefined;
    }
    if (target === undefined) {
        const knownToAgent = options.baselineKnown && baseline !== undefined;
        if (!state.tracked && !knownToAgent) {
            return undefined;
        }
    }
    const missing = current === undefined && !state.presentOnDisk;
    const action: QaapRewindFileAction = target === undefined ? 'delete' : missing ? 'recreate' : 'restore';
    const reasons: QaapRewindUnsafeReason[] = [];
    if (!options.baselineKnown) {
        reasons.push('unknown-baseline');
    } else if (current !== baseline) {
        if (current === undefined) {
            reasons.push(state.presentOnDisk ? 'ignored-content' : 'deleted-externally');
        } else if (baseline === undefined) {
            reasons.push('created-externally');
        } else {
            reasons.push('modified-externally');
        }
    } else if (current === undefined && state.presentOnDisk) {
        reasons.push('ignored-content');
    }
    if (state.conflicted) {
        reasons.push('conflict');
    }
    if (state.binary) {
        reasons.push('binary');
    }
    if ((state.sizeBytes ?? 0) > (options.largeFileBytes ?? QAAP_REWIND_LARGE_FILE_BYTES)) {
        reasons.push('large');
    }
    return {
        path: state.path,
        action,
        safety: reasons.length ? 'unsafe' : 'safe',
        reasons,
        added: state.binary ? undefined : state.added,
        removed: state.binary ? undefined : state.removed,
    };
}

/** Classify every state, sorted by path; files the restore would not touch are dropped. */
export function classifyRewindFiles(
    states: readonly QaapRewindFileState[],
    options: QaapRewindClassifyOptions,
): QaapRewindPreviewFileDTO[] {
    const files: QaapRewindPreviewFileDTO[] = [];
    for (const state of states) {
        const file = classifyRewindFile(state, options);
        if (file) {
            files.push(file);
        }
    }
    return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

/** Files a restore in `mode` applies. */
export function selectRewindFiles(
    files: readonly QaapRewindPreviewFileDTO[],
    mode: QaapRewindRestoreMode,
): QaapRewindPreviewFileDTO[] {
    return mode === 'safe' ? files.filter(file => file.safety === 'safe') : [...files];
}

/**
 * Error message when an `all` restore would drop unsafe changes without an explicit confirmation of
 * exactly these files: `currentUnsafeToken` is the fingerprint recomputed at restore time.
 */
export function rewindRestoreConfirmationError(
    files: readonly QaapRewindPreviewFileDTO[],
    options: QaapRewindRestoreOptions,
    currentUnsafeToken?: string,
): string | undefined {
    if (options.mode !== 'all') {
        return undefined;
    }
    const unsafe = files.filter(file => file.safety === 'unsafe').length;
    if (!unsafe) {
        return undefined;
    }
    if (!options.confirmUnsafe) {
        return `Restore would overwrite ${unsafe} file(s) with changes not made by the agent; confirmation required.`;
    }
    if (!options.unsafeToken || options.unsafeToken !== currentUnsafeToken) {
        return 'Files changed since the preview; review the restore again.';
    }
    return undefined;
}

/** Normalize an untrusted request body into restore options (`undefined` = legacy restore). */
export function parseRewindRestoreOptions(body: unknown): QaapRewindRestoreOptions | undefined {
    if (!body || typeof body !== 'object') {
        return undefined;
    }
    const value = body as { mode?: unknown; confirmUnsafe?: unknown; unsafeToken?: unknown };
    if (value.mode !== 'all' && value.mode !== 'safe') {
        return undefined;
    }
    return {
        mode: value.mode,
        confirmUnsafe: value.confirmUnsafe === true,
        ...(typeof value.unsafeToken === 'string' && /^[a-f0-9]{64}$/.test(value.unsafeToken) ? { unsafeToken: value.unsafeToken } : {}),
    };
}

export function buildRewindPreviewDTO(
    base: Omit<QaapRewindPreviewDTO, 'files' | 'safeCount' | 'unsafeCount' | 'truncated' | 'unsafeToken'> & { readonly unsafeToken?: string },
    files: readonly QaapRewindPreviewFileDTO[],
    maxFiles: number = QAAP_REWIND_PREVIEW_MAX_FILES,
): QaapRewindPreviewDTO {
    const unsafeCount = files.filter(file => file.safety === 'unsafe').length;
    // Keep every unsafe file visible when capping: those are the ones the user must review.
    const ordered = files.length > maxFiles
        ? [...files.filter(file => file.safety === 'unsafe'), ...files.filter(file => file.safety === 'safe')].slice(0, maxFiles)
        : [...files];
    return {
        ...base,
        files: ordered,
        safeCount: files.length - unsafeCount,
        unsafeCount,
        truncated: files.length > maxFiles ? true : undefined,
    };
}

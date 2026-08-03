// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only With Classpath-exception-2.0
// *****************************************************************************

// Pure helpers extracted from MobileProjectsTranscriptStickyComposerUi.
// These functions operate only on their parameters and do not access instance state.

import { nls } from '@theia/core/lib/common/nls';
import type { QaapGitChangedFile, QaapGitCommitWorkflowAction } from '../common/qaap-git-review';
import type { StickyComposerChangedFileView } from './qaap-sticky-composer-activity-stack';

// ─── Draft merge ─────────────────────────────────────────────────────────────

export function mergeFailedComposerDraft(failedDraft: string, currentDraft: string): string {
    const failed = failedDraft.trim();
    const current = currentDraft.trim();
    if (!failed) {
        return currentDraft;
    }
    if (!current || current === failed) {
        return failedDraft;
    }
    return `${failedDraft}\n\n${currentDraft}`;
}

// ─── Focus steal check ───────────────────────────────────────────────────────

/**
 * True when `active` is a focus holder the idle composer may take focus from:
 * nothing/body, the composer textarea itself, the composer loading
 * placeholder, or xterm's hidden helper textarea (which grabs focus during
 * terminal boot but is never a user-facing input).
 */
export function isIdleComposerFocusStealable(active: Element | null, textarea: HTMLTextAreaElement | undefined): boolean {
    if (!active || active === document.body || (textarea !== undefined && active === textarea)) {
        return true;
    }
    return active instanceof HTMLElement
        && (active.classList.contains('theia-mod-loading') || active.classList.contains('xterm-helper-textarea'));
}

// ─── Agent activity check ────────────────────────────────────────────────────

export function hasComposerAgentActivity(activityFiles: {
    readonly files: readonly StickyComposerChangedFileView[];
    readonly stats?: { readonly added: number; readonly removed: number };
}): boolean {
    return activityFiles.files.length > 0
        || (activityFiles.stats?.added ?? 0) > 0
        || (activityFiles.stats?.removed ?? 0) > 0;
}

// ─── Changed files stats ─────────────────────────────────────────────────────

export function resolveChangedFilesStats(
    files: readonly StickyComposerChangedFileView[],
    fallback?: { readonly added: number; readonly removed: number },
): { readonly added: number; readonly removed: number } | undefined {
    if (files.length === 0) {
        return fallback;
    }
    let added = 0;
    let removed = 0;
    for (const file of files) {
        added += file.added ?? 0;
        removed += file.removed ?? 0;
    }
    if (added > 0 || removed > 0) {
        return { added, removed };
    }
    return fallback;
}

// ─── Git changed file mapping ────────────────────────────────────────────────

export function mapGitChangedFileToComposerView(file: QaapGitChangedFile): StickyComposerChangedFileView {
    const untracked = file.status === 'U' || file.status === '?';
    const created = untracked || file.status === 'A';
    return {
        path: file.path,
        kind: created ? 'created' : 'edited',
        added: file.adds > 0 ? file.adds : undefined,
        removed: file.dels > 0 ? file.dels : undefined,
        staged: file.staged,
    };
}

// ─── Git commit workflow label ───────────────────────────────────────────────

export function resolveGitCommitWorkflowLabel(action: QaapGitCommitWorkflowAction): string {
    switch (action) {
        case 'create-branch-commit':
            return nls.localize('qaap/mobileProjects/createBranchAndCommit', 'Create Branch & Commit');
        case 'create-branch-commit-push':
            return nls.localize('qaap/mobileProjects/createBranchCommitPush', 'Create Branch, Commit & Push');
        case 'commit':
            return nls.localize('qaap/mobileProjects/commit', 'Commit');
        case 'commit-create-pr':
            return nls.localize('qaap/mobileProjects/commitCreatePr', 'Commit & Create PR');
        case 'commit-push':
        default:
            return nls.localize('qaap/mobileProjects/commitPush', 'Commit & Push');
    }
}

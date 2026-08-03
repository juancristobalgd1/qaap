// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Diff Summary Renderer (mobile) ──────────────────────────────────────────
//
// Renders the closing "files changed" / "line diff" summary card that caps
// the execution event timeline. Extracted from qaap-execution-event-timeline.ts.

import { nls } from '@theia/core/lib/common/nls';
import { getFileIconClass } from '../common/qaap-file-icon-utils';

export interface MobileDiffFileEntry {
    name: string;
    type?: string;
    /** Lines added in this file, when known. */
    added?: number;
    /** Lines removed in this file, when known. */
    removed?: number;
}

/** Short language/type badge shown beside filenames in the files-changed card. */
export function resolveMobileDiffFileLanguageBadge(fileName: string): string | undefined {
    const base = fileName.includes('/') ? fileName.slice(fileName.lastIndexOf('/') + 1) : fileName;
    const dot = base.lastIndexOf('.');
    if (dot <= 0) {
        return undefined;
    }
    switch (base.slice(dot + 1).toLowerCase()) {
        case 'ts':
        case 'tsx':
            return 'TS';
        case 'js':
        case 'jsx':
        case 'mjs':
        case 'cjs':
            return 'JS';
        case 'css':
        case 'scss':
        case 'sass':
        case 'less':
            return '#';
        case 'json':
        case 'jsonc':
            return '{}';
        case 'md':
        case 'mdx':
            return 'MD';
        case 'html':
        case 'htm':
            return '<>';
        case 'py':
            return 'PY';
        case 'go':
            return 'GO';
        case 'rs':
            return 'RS';
        default:
            return undefined;
    }
}

export function createMobileDiffSummaryElement(
    fileCount: number,
    _added: number,
    _modified: number,
    _deleted: number,
    files?: MobileDiffFileEntry[],
    onReview?: () => void,
): HTMLElement {
    const summary = document.createElement('div');
    summary.className = 'theia-mobile-diff-summary theia-mod-files';

    const header = document.createElement('div');
    header.className = 'theia-mobile-diff-summary-header';

    const title = document.createElement('span');
    title.className = 'theia-mobile-diff-summary-title';
    title.textContent = fileCount === 1
        ? nls.localize('qaap/mobileProjects/transcriptDiffSummaryOneFile', '1 File Changed')
        : nls.localize('qaap/mobileProjects/transcriptDiffSummaryFiles', '{0} Files Changed', String(fileCount));
    header.append(title);

    if (onReview) {
        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'theia-mobile-diff-summary-review';
        review.textContent = nls.localize('qaap/mobileProjects/transcriptChangedFilesReview', 'Review');
        review.addEventListener('click', onReview);
        header.append(review);
    }

    summary.append(header);

    if (files && files.length > 0) {
        const fileList = document.createElement('div');
        fileList.className = 'theia-mobile-diff-summary-files';
        for (const file of files.slice(0, 6)) {
            const row = document.createElement('div');
            row.className = 'theia-mobile-diff-summary-file';
            const main = document.createElement('span');
            main.className = 'theia-mobile-diff-summary-file-main';
            const badgeLabel = resolveMobileDiffFileLanguageBadge(file.name);
            const fileIcon = document.createElement('span');
            if (badgeLabel) {
                fileIcon.className = 'theia-mobile-diff-summary-file-badge';
                fileIcon.textContent = badgeLabel;
            } else {
                fileIcon.className = `codicon ${getFileIconClass(file.name)} theia-mobile-diff-summary-file-icon`;
            }
            fileIcon.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span');
            name.className = 'theia-mobile-diff-summary-file-name';
            name.textContent = file.name;
            name.title = file.name;
            main.append(fileIcon, name);
            row.append(main);

            const tail = document.createElement('span');
            tail.className = 'theia-mobile-diff-summary-file-tail';
            let hasStats = false;
            if (typeof file.added === 'number' && file.added > 0) {
                const addedStat = document.createElement('span');
                addedStat.className = 'theia-mobile-diff-summary-file-stat theia-mod-added';
                addedStat.textContent = `+${file.added}`;
                tail.append(addedStat);
                hasStats = true;
            }
            if (typeof file.removed === 'number' && file.removed > 0) {
                const removedStat = document.createElement('span');
                removedStat.className = 'theia-mobile-diff-summary-file-stat theia-mod-deleted';
                // Unicode minus matches composer / changed-files rows (+12 −3).
                removedStat.textContent = `−${file.removed}`;
                tail.append(removedStat);
                hasStats = true;
            }
            if (!hasStats && file.type) {
                const type = document.createElement('span');
                type.className = `theia-mobile-diff-summary-file-type theia-mod-${file.type}`;
                type.textContent = file.type === 'add'
                    ? nls.localize('qaap/mobileProjects/transcriptDiffFileAdded', 'added')
                    : file.type === 'delete'
                        ? nls.localize('qaap/mobileProjects/transcriptDiffFileDeleted', 'deleted')
                        : nls.localize('qaap/mobileProjects/transcriptDiffFileModified', 'modified');
                tail.append(type);
            }
            if (tail.childElementCount > 0) {
                row.append(tail);
            }
            fileList.append(row);
        }
        if (files.length > 6) {
            const more = document.createElement('div');
            more.className = 'theia-mobile-diff-summary-more';
            more.textContent = `+${files.length - 6} more`;
            fileList.append(more);
        }
        summary.append(fileList);
    }

    return summary;
}

/**
 * Creates a line-level diff summary for the case where we have aggregate
 * added/removed line counts but no per-file change set (e.g. when the change
 * set is inferred from diff stats embedded in tool output rather than from
 * Write/Edit tool invocations).
 *
 * Unlike {@link createMobileDiffSummaryElement}, this does NOT claim a file
 * count — it renders only the "+N / -N" line stats with a generic "Changes"
 * title, avoiding the misleading "1 file changed" label that would otherwise
 * result from passing line counts into the file-count API.
 */
export function createMobileLineDiffSummaryElement(
    linesAdded: number,
    linesRemoved: number,
): HTMLElement {
    const summary = document.createElement('div');
    summary.className = 'theia-mobile-diff-summary';

    const header = document.createElement('div');
    header.className = 'theia-mobile-diff-summary-header';

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-diff theia-mobile-diff-summary-icon';
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'theia-mobile-diff-summary-title';
    title.textContent = nls.localize('qaap/mobileProjects/transcriptDiffSummary', 'Change summary');

    header.append(icon, title);

    if (linesAdded > 0) {
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-diff-summary-stat theia-mod-added';
        stat.textContent = `+${linesAdded}`;
        header.append(stat);
    }
    if (linesRemoved > 0) {
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-diff-summary-stat theia-mod-deleted';
        stat.textContent = `−${linesRemoved}`;
        header.append(stat);
    }

    summary.append(header);
    return summary;
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { ComposerGitActionDisplayMetadata } from '../common/qaap-composer-git-action-display';

export function createTranscriptGitActionCard(metadata: ComposerGitActionDisplayMetadata): HTMLElement {
    const card = document.createElement('div');
    card.className = 'theia-mobile-agent-transcript-git-action-card';

    const statsRow = buildTranscriptGitActionStats(metadata);
    if (statsRow) {
        card.append(statsRow);
    }

    card.append(createTranscriptGitActionPill(metadata));
    return card;
}

function buildTranscriptGitActionStats(metadata: ComposerGitActionDisplayMetadata): HTMLElement | undefined {
    if (metadata.status === 'running' || metadata.status === 'failed') {
        return undefined;
    }

    const branch = metadata.branch?.trim();
    const fileCount = metadata.files;
    const insertions = metadata.insertions ?? 0;
    const deletions = metadata.deletions ?? 0;
    const hasDiffStats = insertions > 0 || deletions > 0;
    const hasFileCount = typeof fileCount === 'number' && fileCount > 0;

    if (!branch && !hasFileCount && !hasDiffStats) {
        return undefined;
    }

    const statsRow = document.createElement('div');
    statsRow.className = 'theia-mobile-agent-transcript-git-action-stats';

    if (branch) {
        const branchEl = document.createElement('span');
        branchEl.className = 'theia-mobile-agent-transcript-git-action-branch';
        branchEl.textContent = branch;
        branchEl.title = branch;
        statsRow.append(branchEl);
    }

    const metrics = document.createElement('span');
    metrics.className = 'theia-mobile-agent-transcript-git-action-metrics';

    if (hasFileCount) {
        const filesEl = document.createElement('span');
        filesEl.className = 'theia-mobile-agent-transcript-git-action-files';
        filesEl.textContent = fileCount === 1
            ? nls.localize('qaap/mobileProjects/transcriptGitActionOneFile', '1 file')
            : nls.localize('qaap/mobileProjects/transcriptGitActionManyFiles', '{0} files', String(fileCount));
        metrics.append(filesEl);
    }

    if (hasDiffStats) {
        const diffStats = document.createElement('span');
        diffStats.className = 'theia-mobile-agent-transcript-git-action-diff-stats';
        if (insertions > 0) {
            const added = document.createElement('span');
            added.className = 'theia-mobile-agent-diff-stat theia-mod-added';
            added.textContent = `+${insertions}`;
            diffStats.append(added);
        }
        if (deletions > 0 || insertions > 0) {
            const removed = document.createElement('span');
            removed.className = 'theia-mobile-agent-diff-stat theia-mod-removed';
            removed.textContent = `-${deletions}`;
            diffStats.append(removed);
        }
        metrics.append(diffStats);
    }

    if (metrics.childElementCount > 0) {
        statsRow.append(metrics);
    }

    return statsRow.childElementCount > 0 ? statsRow : undefined;
}

export function createTranscriptGitActionPill(metadata: ComposerGitActionDisplayMetadata): HTMLElement {
    const pill = document.createElement('div');
    pill.className = 'theia-mobile-agent-transcript-git-action-pill';
    pill.classList.toggle('theia-mod-failed', metadata.status === 'failed');
    pill.classList.toggle('theia-mod-running', metadata.status === 'running');
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-label', buildTranscriptGitActionAriaLabel(metadata));

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-repo-push theia-mobile-agent-transcript-git-action-icon';
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'theia-mobile-agent-transcript-git-action-label';
    label.textContent = metadata.label;

    pill.append(icon, label);
    return pill;
}

function buildTranscriptGitActionAriaLabel(metadata: ComposerGitActionDisplayMetadata): string {
    const parts = [metadata.label];
    const branch = metadata.branch?.trim();
    if (branch) {
        parts.push(branch);
    }
    if (typeof metadata.files === 'number' && metadata.files > 0) {
        parts.push(metadata.files === 1 ? '1 file' : `${metadata.files} files`);
    }
    const insertions = metadata.insertions ?? 0;
    const deletions = metadata.deletions ?? 0;
    if (insertions > 0 || deletions > 0) {
        parts.push(`+${insertions} −${deletions}`);
    }
    return parts.join(', ');
}

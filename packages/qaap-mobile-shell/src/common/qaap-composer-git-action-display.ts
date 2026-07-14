// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapGitCommitWorkflowAction } from './qaap-git-review';

const COMPOSER_GIT_ACTION_DISPLAY_MARKER_PREFIX = '<!-- qaap-composer-git-action ';
const COMPOSER_GIT_ACTION_DISPLAY_MARKER_SUFFIX = ' -->';

export interface ComposerGitActionDisplayMetadata {
    readonly action: QaapGitCommitWorkflowAction;
    readonly label: string;
    readonly branch?: string;
    readonly status: 'running' | 'completed' | 'failed';
    readonly files?: number;
    readonly insertions?: number;
    readonly deletions?: number;
}

export function createComposerGitActionDisplayMarker(metadata: ComposerGitActionDisplayMetadata): string {
    const encoded = encodeURIComponent(JSON.stringify(metadata)).replace(/-/g, '%2D');
    return `${COMPOSER_GIT_ACTION_DISPLAY_MARKER_PREFIX}${encoded}${COMPOSER_GIT_ACTION_DISPLAY_MARKER_SUFFIX}`;
}

export function parseComposerGitActionDisplayMarker(text: string): ComposerGitActionDisplayMetadata | undefined {
    const trimmedStart = text.trimStart();
    if (!trimmedStart.startsWith(COMPOSER_GIT_ACTION_DISPLAY_MARKER_PREFIX)) {
        return undefined;
    }
    const end = trimmedStart.indexOf(COMPOSER_GIT_ACTION_DISPLAY_MARKER_SUFFIX);
    if (end < 0) {
        return undefined;
    }
    const encoded = trimmedStart.slice(COMPOSER_GIT_ACTION_DISPLAY_MARKER_PREFIX.length, end);
    try {
        const parsed = JSON.parse(decodeURIComponent(encoded)) as Partial<ComposerGitActionDisplayMetadata>;
        if (typeof parsed.action !== 'string' || !parsed.action.trim()) {
            return undefined;
        }
        if (typeof parsed.label !== 'string' || !parsed.label.trim()) {
            return undefined;
        }
        const status = parsed.status === 'failed'
            ? 'failed'
            : parsed.status === 'running'
                ? 'running'
                : 'completed';
        return {
            action: parsed.action.trim() as QaapGitCommitWorkflowAction,
            label: parsed.label.trim(),
            branch: typeof parsed.branch === 'string' && parsed.branch.trim() ? parsed.branch.trim() : undefined,
            status,
            ...(typeof parsed.files === 'number' && parsed.files >= 0 ? { files: parsed.files } : {}),
            ...(typeof parsed.insertions === 'number' && parsed.insertions >= 0 ? { insertions: parsed.insertions } : {}),
            ...(typeof parsed.deletions === 'number' && parsed.deletions >= 0 ? { deletions: parsed.deletions } : {}),
        };
    } catch {
        return undefined;
    }
}

export function isComposerGitActionOnlyMessage(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) {
        return false;
    }
    const marker = parseComposerGitActionDisplayMarker(trimmed);
    return !!marker && trimmed === createComposerGitActionDisplayMarker(marker);
}

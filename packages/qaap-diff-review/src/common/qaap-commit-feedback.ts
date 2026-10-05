// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapGitPushDestination } from '@theia/qaap-shared-core/lib/common/qaap-git-review';

export interface QaapCommitFeedbackStat {
    readonly files: number;
    readonly insertions: number;
    readonly deletions: number;
}

/**
 * Build the commit-success confirmation shown in the snackbar. Surfaces the target branch and the
 * insertion/deletion counts when the backend reported them, so the user sees exactly what landed
 * (e.g. `Committed to main (+42 −18)`) instead of a bare "Changes committed". Falls back gracefully
 * when the branch or stat is unavailable. A hosted push names the GitHub repository and branch it
 * went to (`… · pushed to acme/widget:main`), so the user sees the destination of their token.
 */
export function formatCommitFeedback(
    fallback: string,
    branch?: string,
    stat?: QaapCommitFeedbackStat,
    pushedTo?: QaapGitPushDestination,
): string {
    const trimmedBranch = branch?.trim();
    if (!trimmedBranch) {
        return fallback;
    }
    let message = `Committed to ${trimmedBranch}`;
    if (stat && (stat.insertions > 0 || stat.deletions > 0)) {
        // Unicode minus (−) reads cleaner than a hyphen next to the plus.
        message += ` (+${stat.insertions} −${stat.deletions})`;
    }
    if (pushedTo) {
        message += ` · pushed to ${pushedTo.repository}:${pushedTo.branch}`;
    }
    return message;
}

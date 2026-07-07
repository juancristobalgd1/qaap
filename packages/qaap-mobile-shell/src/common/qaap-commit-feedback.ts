// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface QaapCommitFeedbackStat {
    readonly files: number;
    readonly insertions: number;
    readonly deletions: number;
}

/**
 * Build the commit-success confirmation shown in the snackbar. Surfaces the target branch and the
 * insertion/deletion counts when the backend reported them, so the user sees exactly what landed
 * (e.g. `Committed to main (+42 −18)`) instead of a bare "Changes committed". Falls back gracefully
 * when the branch or stat is unavailable.
 */
export function formatCommitFeedback(
    fallback: string,
    branch?: string,
    stat?: QaapCommitFeedbackStat,
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
    return message;
}

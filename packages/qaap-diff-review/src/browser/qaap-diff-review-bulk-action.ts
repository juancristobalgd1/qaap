// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Bulk review actions: accept (stage) or discard every changed file. */
export type QaapBulkReviewAction = 'stage' | 'discard';

/** The git extension commands behind the bulk review actions on a page that runs plugins. */
export const QAAP_BULK_REVIEW_GIT_COMMANDS: Readonly<Record<QaapBulkReviewAction, string>> = {
    stage: 'git.stageAll',
    discard: 'git.cleanAll',
};

export interface QaapBulkReviewActionHost {
    /** `true` when the command is registered (the git plugin runs on this page). */
    hasCommand(commandId: string): boolean;
    executeCommand(commandId: string): Promise<unknown>;
    /** One file through the qaap git review endpoint (`/stage` or `/discard`). */
    runFileAction(action: QaapBulkReviewAction, file: string): Promise<void>;
    /** Asked before discarding every file without the git plugin (which asks on its own). */
    confirmDiscardAll(fileCount: number): Promise<boolean>;
}

/**
 * Runs a bulk review action through the git extension when this page runs plugins, otherwise file
 * by file through the qaap git review endpoints: phones and Work Hub pages never load the git
 * extension, and the review must not need it. Resolves `false` when nothing ran.
 */
export async function runQaapBulkReviewAction(
    action: QaapBulkReviewAction,
    files: readonly string[],
    host: QaapBulkReviewActionHost,
): Promise<boolean> {
    const commandId = QAAP_BULK_REVIEW_GIT_COMMANDS[action];
    if (host.hasCommand(commandId)) {
        await host.executeCommand(commandId);
        return true;
    }
    if (files.length === 0) {
        return false;
    }
    if (action === 'discard' && !await host.confirmDiscardAll(files.length)) {
        return false;
    }
    // One at a time: concurrent git commands would race for the index lock.
    for (const file of files) {
        await host.runFileAction(action, file);
    }
    return true;
}

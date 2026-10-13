// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from './qaap-agent-conversation-client';
import { isQaapWorktreeConversation } from './qaap-worktree-label';

/** Conversation fields that decide which working tree a thread's Preview runs from. */
export type QaapThreadPreviewRootFields = Pick<QaapAgentConversationSummaryDTO,
    'cwd' | 'parallelBaseCwd' | 'worktreeBranch' | 'parallelRunId'>;

/**
 * The git worktree a thread previews from, or `undefined` when it previews the project's own tree.
 *
 * Auto-isolated threads and isolated forks edit their own worktree, so their Preview must serve
 * that code, not the main tree a sibling thread is changing. Run variants keep previewing the base
 * workspace: they are compared and one is applied back, and N variants must not each install and
 * boot a dev server.
 */
export function resolveThreadPreviewWorktree(summary: QaapThreadPreviewRootFields | undefined): string | undefined {
    return summary?.worktreeBranch && !summary.parallelRunId && isQaapWorktreeConversation(summary)
        ? summary.cwd
        : undefined;
}

/**
 * Root a thread's Preview runs from: its own worktree when it has one, else `projectRoot`, else
 * the conversation's base workspace.
 */
export function resolveThreadPreviewRoot(
    summary: QaapThreadPreviewRootFields | undefined,
    projectRoot?: string,
): string | undefined {
    return resolveThreadPreviewWorktree(summary)
        ?? projectRoot
        ?? summary?.parallelBaseCwd
        ?? summary?.cwd;
}

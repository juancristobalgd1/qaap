// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Resolves the conversation a composer Stop cancels. The Stop handler's closure can keep the summary
 * captured at mount time, so the Stop must go to the conversation the transcript shows now. When the
 * open conversation differs and its summary cannot be resolved, there is no safe target: `undefined`
 * (the Stop does nothing) rather than cancelling the older conversation.
 */
export function resolveComposerStopTarget<T extends { readonly id: string }>(
    closureSummary: T,
    openConversationId: string | undefined,
    openSummary: T | undefined,
    closureIsPlaceholder = false,
): T | undefined {
    if (closureIsPlaceholder && openConversationId !== undefined && openConversationId !== closureSummary.id) {
        // A placeholder closure means the task is still being created: the open transcript is the
        // conversation shown before it, and a Stop must never cancel that older run.
        return undefined;
    }
    if (openConversationId === undefined || openConversationId === closureSummary.id) {
        return closureSummary;
    }
    return openSummary?.id === openConversationId ? openSummary : undefined;
}

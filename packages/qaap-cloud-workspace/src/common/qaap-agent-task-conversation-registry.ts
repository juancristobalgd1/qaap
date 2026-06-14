// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Conversation turn task ids whose Web Push is handled on turn settle (not task runner). */
const conversationTasksWithRichPush = new Set<string>();

export function markConversationTaskForRichPush(taskId: string): void {
    conversationTasksWithRichPush.add(taskId);
}

export function consumeConversationTaskForRichPush(taskId: string): boolean {
    if (!conversationTasksWithRichPush.has(taskId)) {
        return false;
    }
    conversationTasksWithRichPush.delete(taskId);
    return true;
}

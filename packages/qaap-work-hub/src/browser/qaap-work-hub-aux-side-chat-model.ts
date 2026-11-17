// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// DOM-free helpers of the side chat view in the desktop Work Hub right panel: the tab title and the tool count
// of a turn. The preamble helpers live in `@theia/qaap-shared-core` (`qaap-agent-conversation-side-chat.ts`).
// The DOM lives in `qaap-work-hub-aux-side-chat-view.ts`.

/** Longest tab title, in characters, before it is cut with an ellipsis. */
export const QAAP_WORK_HUB_SIDE_CHAT_TITLE_LIMIT = 48;

/**
 * The tab and header title of a side chat: the first user message on one line, cut to
 * {@link QAAP_WORK_HUB_SIDE_CHAT_TITLE_LIMIT}. `undefined` for an empty message.
 */
export function sideChatTitleFromMessage(text: string): string | undefined {
    const line = text.replace(/\s+/g, ' ').trim();
    if (!line) {
        return undefined;
    }
    return line.length > QAAP_WORK_HUB_SIDE_CHAT_TITLE_LIMIT
        ? `${line.slice(0, QAAP_WORK_HUB_SIDE_CHAT_TITLE_LIMIT - 1).trimEnd()}…`
        : line;
}

/** How many tool calls an agent turn made, for the "Used N tools" line. */
export function sideChatToolCallCount(traceEvents: readonly { readonly type: string }[] | undefined): number {
    return (traceEvents ?? []).filter(event => event.type === 'tool_call').length;
}

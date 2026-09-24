// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export const QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT = 5;
export const QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_PAGE_SIZE = 15;

/** Approximate compact sidebar row height (title + meta subline). */
const QAAP_SESSIONS_SIDEBAR_COMPACT_ROW_PX = 44;

/** Chrome above the conversation list when a single project fills the sidebar. */
const QAAP_SESSIONS_SIDEBAR_SINGLE_PROJECT_CHROME_PX = 370;

/** Hard cap so very tall viewports still paginate instead of rendering hundreds of rows. */
const QAAP_SESSIONS_SIDEBAR_SINGLE_PROJECT_MAX_INITIAL_LIMIT = 48;

export function resolveSessionsSidebarInitialConversationLimit(options: {
    readonly projectCount: number;
    readonly totalConversations: number;
    readonly viewportHeight?: number;
}): number {
    const collapsed = QAAP_SESSIONS_SIDEBAR_CONVERSATIONS_COLLAPSED_LIMIT;
    if (options.projectCount !== 1 || options.totalConversations <= collapsed) {
        return collapsed;
    }
    const viewport = options.viewportHeight ?? 800;
    const showMoreReservePx = options.totalConversations > collapsed ? 28 : 0;
    const available = Math.max(0, viewport - QAAP_SESSIONS_SIDEBAR_SINGLE_PROJECT_CHROME_PX - showMoreReservePx);
    const fitCount = Math.floor(available / QAAP_SESSIONS_SIDEBAR_COMPACT_ROW_PX);
    const boosted = Math.max(collapsed + 1, fitCount);
    return Math.min(
        options.totalConversations,
        Math.min(boosted, QAAP_SESSIONS_SIDEBAR_SINGLE_PROJECT_MAX_INITIAL_LIMIT),
    );
}

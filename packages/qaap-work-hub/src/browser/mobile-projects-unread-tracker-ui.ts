// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectsConversationFlags } from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversation-flags';
import { QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID } from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';

/** Panel state the unread tracker reads; every field is owned by the Work Hub panel. */
export interface MobileProjectsUnreadTrackerHost {
    readonly conversationFlags: MobileProjectsConversationFlags | undefined;
    readonly conversations?: { findSummaryById(id: string): QaapAgentConversationSummaryDTO | undefined };
    readonly transcriptOpenSummaryId: string | undefined;
    readonly transcriptOpenSummary: QaapAgentConversationSummaryDTO | undefined;
    readonly visible: boolean;
}

/**
 * Single owner of the "unread reply" high-water mark. The transcript (sheet or Agents Hub inline)
 * is the only place a user reads a conversation, so every entry point that opens it, every summary
 * tick while it stays open, and its close all funnel through here — no row or hub needs to call
 * `markRead` itself.
 */
export class MobileProjectsUnreadTrackerUi {
    constructor(protected readonly host: MobileProjectsUnreadTrackerHost) { }

    /** Opening a conversation acknowledges everything the agent wrote so far. */
    markConversationOpened(summary: QaapAgentConversationSummaryDTO): void {
        this.markRead(summary.id, summary.updatedAt);
    }

    /**
     * A summary tick for the open conversation is being read live: advance the mark so the
     * row never lights up while the user is looking at it. Ticks for other conversations and
     * ticks while the Work Hub is hidden are ignored.
     */
    syncOpenConversationRead(conversationId?: string): void {
        const openId = this.host.transcriptOpenSummaryId;
        if (!openId || !this.host.visible || (conversationId !== undefined && conversationId !== openId)) {
            return;
        }
        this.markRead(openId, 0);
    }

    /** Closing (or replacing) the transcript records the last `updatedAt` the user had on screen. */
    markOpenConversationClosed(): void {
        const openId = this.host.transcriptOpenSummaryId;
        if (openId) {
            this.markRead(openId, 0);
        }
    }

    protected markRead(conversationId: string, updatedAt: number): void {
        if (!this.host.conversationFlags || conversationId === QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID) {
            return;
        }
        const latest = this.latestUpdatedAt(conversationId, updatedAt);
        if (latest > 0) {
            this.host.conversationFlags.markRead(conversationId, latest);
        }
    }

    /** Store summary wins over the caller's copy, which may be a stale list snapshot. */
    protected latestUpdatedAt(conversationId: string, fallback: number): number {
        const stored = this.host.conversations?.findSummaryById(conversationId)?.updatedAt ?? 0;
        const open = this.host.transcriptOpenSummary?.id === conversationId ? this.host.transcriptOpenSummary.updatedAt : 0;
        return Math.max(fallback, stored, open);
    }
}

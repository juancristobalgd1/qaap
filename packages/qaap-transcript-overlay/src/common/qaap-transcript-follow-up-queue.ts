// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { AIVariableResolutionRequest } from '@theia/ai-core';

export interface TranscriptFollowUpImagePreview {
    readonly src: string;
    readonly fileName: string;
    readonly wsRelativePath?: string;
}

export interface TranscriptFollowUpEntry {
    readonly draft: string;
    readonly selectedAgentId?: string;
    readonly modeId?: string;
    readonly autoApprove?: boolean;
    readonly approvalPolicyId?: string;
    /** Resolved composer attachments must survive overflow into the follow-up queue. */
    readonly variables?: readonly AIVariableResolutionRequest[];
    /** Optimistic transcript previews paired with {@link variables}. */
    readonly imagePreviews?: readonly TranscriptFollowUpImagePreview[];
    /** Delivery mode for this entry — set when posting parallel/interrupt (or queue) to the server. */
    readonly deliveryMode?: 'queue' | 'parallel' | 'interrupt';
    /**
     * When the follow-up was also mirrored to durable `pendingUserMessages`, the server id.
     * Lets Edit / Cancel / Send now drive the backend queue instead of double-posting on flush.
     */
    readonly serverPendingId?: string;
    /** True once {@link serverPendingId} is confirmed — settle flush must not POST again. */
    readonly serverSynced?: boolean;
}

export const MAX_TRANSCRIPT_FOLLOW_UP_QUEUE = 5;

export class TranscriptFollowUpQueue {
    protected readonly byConversation = new Map<string, TranscriptFollowUpEntry[]>();

    enqueue(conversationId: string, entry: TranscriptFollowUpEntry): boolean {
        const queue = this.byConversation.get(conversationId) ?? [];
        if (queue.length >= MAX_TRANSCRIPT_FOLLOW_UP_QUEUE) {
            return false;
        }
        queue.push(entry);
        this.byConversation.set(conversationId, queue);
        return true;
    }

    peek(conversationId: string): readonly TranscriptFollowUpEntry[] {
        return this.byConversation.get(conversationId) ?? [];
    }

    unshift(conversationId: string, entry: TranscriptFollowUpEntry): void {
        const queue = this.byConversation.get(conversationId) ?? [];
        queue.unshift(entry);
        this.byConversation.set(conversationId, queue);
    }

    shift(conversationId: string): TranscriptFollowUpEntry | undefined {
        const queue = this.byConversation.get(conversationId);
        if (!queue?.length) {
            return undefined;
        }
        const next = queue.shift();
        if (!queue.length) {
            this.byConversation.delete(conversationId);
        }
        return next;
    }

    clear(conversationId: string): void {
        this.byConversation.delete(conversationId);
    }

    size(conversationId: string): number {
        return this.byConversation.get(conversationId)?.length ?? 0;
    }

    removeAt(conversationId: string, index: number): void {
        const queue = this.byConversation.get(conversationId);
        if (!queue || index < 0 || index >= queue.length) {
            return;
        }
        queue.splice(index, 1);
        if (!queue.length) {
            this.byConversation.delete(conversationId);
        }
    }

    /** Removes and returns the entry at {@link index}, or `undefined` if out of range. */
    takeAt(conversationId: string, index: number): TranscriptFollowUpEntry | undefined {
        const queue = this.byConversation.get(conversationId);
        if (!queue || index < 0 || index >= queue.length) {
            return undefined;
        }
        const [entry] = queue.splice(index, 1);
        if (!queue.length) {
            this.byConversation.delete(conversationId);
        }
        return entry;
    }

    moveUp(conversationId: string, index: number): boolean {
        if (index <= 0) {
            return false;
        }
        const queue = this.byConversation.get(conversationId);
        if (!queue || index >= queue.length) {
            return false;
        }
        const entry = queue[index];
        queue.splice(index, 1);
        queue.splice(index - 1, 0, entry);
        return true;
    }

    replaceAt(conversationId: string, index: number, entry: TranscriptFollowUpEntry): boolean {
        const queue = this.byConversation.get(conversationId);
        if (!queue || index < 0 || index >= queue.length) {
            return false;
        }
        queue[index] = entry;
        return true;
    }

    /** Move an entry from one position to another (drag-to-reorder). */
    moveTo(conversationId: string, fromIndex: number, toIndex: number): boolean {
        const queue = this.byConversation.get(conversationId);
        if (!queue || fromIndex < 0 || fromIndex >= queue.length
            || toIndex < 0 || toIndex >= queue.length || fromIndex === toIndex) {
            return false;
        }
        const [entry] = queue.splice(fromIndex, 1);
        queue.splice(toIndex, 0, entry);
        return true;
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import type { QaapAgentConversationDTO, QaapAgentConversationSummaryDTO, QaapAgentMessageDTO } from './qaap-agent-conversation-client';
import { applyAgentMessageWireDelta } from './qaap-agent-message-wire-delta';
import type { QaapAgentMessageWireDelta } from './qaap-agent-message-wire-delta';
import {
    computeSummaryChangedFields,
    streamingSortOrderMayChange,
    type QaapConversationSummaryField,
} from './qaap-conversation-change';
import type { QaapAgUiTraceReducerState } from './qaap-ag-ui-transcript-adapter';

function normalizeCwd(cwd: string): string {
    let normalized = cwd.replace(/\\/g, '/');
    while (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

export interface QaapThreadStoreUpsertResult {
    readonly previous: QaapAgentConversationSummaryDTO | undefined;
    readonly next: QaapAgentConversationSummaryDTO;
    readonly changedFields: readonly QaapConversationSummaryField[];
    readonly listOrderChanged: boolean;
}

export interface QaapThreadStoreSnapshot {
    readonly summariesById: ReadonlyMap<string, QaapAgentConversationSummaryDTO>;
    readonly document: QaapAgentConversationDTO | undefined;
}

type QaapThreadSelector<T> = (snapshot: QaapThreadStoreSnapshot) => T;

interface QaapThreadSubscriber<T> {
    readonly selector: QaapThreadSelector<T>;
    readonly listener: (value: T, previous: T) => void;
    lastValue: T | undefined;
    initialized: boolean;
}

/**
 * Per-thread state for Work Hub and transcript surfaces.
 * Summaries are always resident; full documents and live reducers are lazy/ephemeral.
 */
export class QaapThreadStore {

    protected readonly summariesById = new Map<string, QaapAgentConversationSummaryDTO>();
    protected readonly idsByCwd = new Map<string, string[]>();
    protected readonly documents = new Map<string, QaapAgentConversationDTO>();
    protected readonly liveReducers = new Map<string, QaapAgUiTraceReducerState>();
    protected readonly globalSubscribers = new Set<QaapThreadSubscriber<unknown>>();
    protected readonly threadSubscribers = new Map<string, Set<QaapThreadSubscriber<unknown>>>();

    /** Replace all VPS summaries (HTTP/WS snapshot). */
    applySummarySnapshot(
        groups: ReadonlyArray<{ readonly cwd: string; readonly conversations: ReadonlyArray<QaapAgentConversationSummaryDTO> }>,
    ): void {
        this.summariesById.clear();
        this.idsByCwd.clear();
        for (const group of groups) {
            const cwd = normalizeCwd(group.cwd);
            const sorted = sortConversationSummaries([...group.conversations]);
            this.idsByCwd.set(cwd, sorted.map(summary => summary.id));
            for (const summary of sorted) {
                this.summariesById.set(summary.id, summary);
            }
        }
    }

    upsertSummary(summary: QaapAgentConversationSummaryDTO): QaapThreadStoreUpsertResult {
        const previous = this.summariesById.get(summary.id);
        const cwd = normalizeCwd(summary.cwd);
        const listOrderChanged = streamingSortOrderMayChange(previous, summary);
        const ids = [...(this.idsByCwd.get(cwd) ?? [])];
        const index = ids.indexOf(summary.id);
        if (index >= 0) {
            ids.splice(index, 1);
        }
        ids.unshift(summary.id);
        const sorted = sortConversationSummaries(ids.map(id => {
            if (id === summary.id) {
                return summary;
            }
            return this.summariesById.get(id)!;
        }).filter((entry): entry is QaapAgentConversationSummaryDTO => !!entry));
        this.idsByCwd.set(cwd, sorted.map(entry => entry.id));
        for (const entry of sorted) {
            this.summariesById.set(entry.id, entry);
        }
        // Sync status/updatedAt to cached document so non-active conversations
        // don't show stale streaming/idle state when the user returns.
        this.syncDocumentStatusFromSummary(summary.id, summary);
        this.notifyThread(summary.id);
        return {
            previous,
            next: summary,
            changedFields: computeSummaryChangedFields(previous, summary),
            listOrderChanged,
        };
    }

    /**
     * Patch a cached document's status/updatedAt from a fresh summary.
     * Keeps non-active conversation documents from going stale while the user
     * is viewing another conversation (e.g. streaming → idle transition).
     */
    syncDocumentStatusFromSummary(
        conversationId: string,
        summary: QaapAgentConversationSummaryDTO,
    ): void {
        const document = this.documents.get(conversationId);
        if (!document) {
            return;
        }
        if (document.status === summary.status
            && document.updatedAt >= summary.updatedAt) {
            return;
        }
        this.documents.set(conversationId, {
            ...document,
            status: summary.status,
            updatedAt: Math.max(document.updatedAt, summary.updatedAt),
        });
    }

    /**
     * Append a live `message` event to a cached document if it exists.
     * Keeps non-active conversation documents fresh with new messages so the
     * transcript hydrates instantly when the user switches back — no flicker,
     * no empty screen, no stale data while the backend refetch completes.
     */
    appendLiveMessage(
        conversationId: string,
        message: QaapAgentMessageDTO,
    ): void {
        const document = this.documents.get(conversationId);
        if (!document) {
            return;
        }
        if (document.messages.some(existing => existing.id === message.id)) {
            return;
        }
        this.documents.set(conversationId, {
            ...document,
            messages: [...document.messages, message],
            updatedAt: Math.max(document.updatedAt, message.createdAt ?? Date.now()),
        });
        this.notifyThread(conversationId);
    }

    removeSummary(conversationId: string, cwd: string): QaapAgentConversationSummaryDTO | undefined {
        const normalized = normalizeCwd(cwd);
        const removed = this.summariesById.get(conversationId);
        if (!removed) {
            return undefined;
        }
        this.summariesById.delete(conversationId);
        const ids = (this.idsByCwd.get(normalized) ?? []).filter(id => id !== conversationId);
        if (ids.length === 0) {
            this.idsByCwd.delete(normalized);
        } else {
            this.idsByCwd.set(normalized, ids);
        }
        this.documents.delete(conversationId);
        this.liveReducers.delete(conversationId);
        this.threadSubscribers.delete(conversationId);
        return removed;
    }

    getSummary(id: string): QaapAgentConversationSummaryDTO | undefined {
        return this.summariesById.get(id);
    }

    findSummaryById(id: string): QaapAgentConversationSummaryDTO | undefined {
        return this.summariesById.get(id);
    }

    getSummariesForCwd(cwd: string): QaapAgentConversationSummaryDTO[] {
        const ids = this.idsByCwd.get(normalizeCwd(cwd)) ?? [];
        return ids
            .map(id => this.summariesById.get(id))
            .filter((summary): summary is QaapAgentConversationSummaryDTO => !!summary);
    }

    /**
     * Parallel-run variants live in a tmpdir worktree but carry {@link parallelBaseCwd}
     * pointing at the originating repo.
     */
    getVariantsForBaseCwd(baseCwd: string): QaapAgentConversationSummaryDTO[] {
        const normalized = normalizeCwd(baseCwd);
        const variants: QaapAgentConversationSummaryDTO[] = [];
        for (const summary of this.summariesById.values()) {
            if (summary.parallelBaseCwd && normalizeCwd(summary.parallelBaseCwd) === normalized) {
                variants.push(summary);
            }
        }
        return sortConversationSummaries(variants);
    }

    listAllSummaries(): QaapAgentConversationSummaryDTO[] {
        return sortConversationSummaries([...this.summariesById.values()]);
    }

    listStreamingSummaries(): QaapAgentConversationSummaryDTO[] {
        return this.listAllSummaries().filter(summary => summary.status === 'streaming');
    }

    setDocument(document: QaapAgentConversationDTO): void {
        this.documents.set(document.id, document);
        this.notifyThread(document.id);
    }

    getDocument(id: string): QaapAgentConversationDTO | undefined {
        return this.documents.get(id);
    }

    deleteDocument(id: string): void {
        this.documents.delete(id);
    }

    /**
     * AG-UI MessagesSnapshot-style catch-up: apply wire deltas onto a cached document
     * without an HTTP round-trip after transport reconnect.
     */
    applyWireDelta(
        conversationId: string,
        _messageId: string,
        delta: QaapAgentMessageWireDelta,
    ): QaapAgentConversationDTO | undefined {
        const document = this.documents.get(conversationId);
        if (!document) {
            return undefined;
        }
        if (delta.kind === 'message_start') {
            const next: QaapAgentConversationDTO = {
                ...document,
                messages: [...document.messages, delta.message],
                updatedAt: Date.now(),
            };
            this.documents.set(conversationId, next);
            this.notifyThread(conversationId);
            return next;
        }
        const patchedMessage = applyAgentMessageWireDelta(document, delta);
        if (!patchedMessage) {
            return undefined;
        }
        const hasMessage = document.messages.some(message => message.id === patchedMessage.id);
        const messages = hasMessage
            ? document.messages.map(message => message.id === patchedMessage.id ? patchedMessage : message)
            : [...document.messages, patchedMessage];
        const next: QaapAgentConversationDTO = {
            ...document,
            messages,
            updatedAt: Date.now(),
        };
        this.documents.set(conversationId, next);
        this.notifyThread(conversationId);
        return next;
    }

    setLiveReducer(conversationId: string, reducer: QaapAgUiTraceReducerState | undefined): void {
        if (!reducer) {
            this.liveReducers.delete(conversationId);
            return;
        }
        this.liveReducers.set(conversationId, reducer);
    }

    getLiveReducer(conversationId: string): QaapAgUiTraceReducerState | undefined {
        return this.liveReducers.get(conversationId);
    }

    clearThread(conversationId: string): void {
        this.documents.delete(conversationId);
        this.liveReducers.delete(conversationId);
        this.threadSubscribers.delete(conversationId);
    }

    subscribe<T>(
        listener: (value: T, previous: T) => void,
        selector: QaapThreadSelector<T>,
        conversationId?: string,
    ): Disposable {
        const subscriber: QaapThreadSubscriber<T> = {
            selector,
            listener,
            lastValue: undefined,
            initialized: false,
        };
        const bucket = conversationId
            ? this.threadSubscribers.get(conversationId) ?? new Set<QaapThreadSubscriber<unknown>>()
            : this.globalSubscribers;
        if (conversationId && !this.threadSubscribers.has(conversationId)) {
            this.threadSubscribers.set(conversationId, bucket);
        }
        bucket.add(subscriber as QaapThreadSubscriber<unknown>);
        this.dispatchSubscriber(subscriber, conversationId);
        return Disposable.create(() => {
            bucket.delete(subscriber as QaapThreadSubscriber<unknown>);
        });
    }

    protected dispatchSubscriber<T>(subscriber: QaapThreadSubscriber<T>, conversationId?: string): void {
        const snapshot = this.buildSnapshot(conversationId);
        const nextValue = subscriber.selector(snapshot);
        if (subscriber.initialized && Object.is(subscriber.lastValue, nextValue)) {
            return;
        }
        const previous = subscriber.lastValue as T;
        subscriber.lastValue = nextValue;
        subscriber.initialized = true;
        if (subscriber.initialized && previous !== undefined || subscriber.initialized) {
            subscriber.listener(nextValue, previous as T);
        }
    }

    protected notifyThread(conversationId: string): void {
        for (const subscriber of this.globalSubscribers) {
            this.dispatchSubscriber(subscriber, conversationId);
        }
        const threadBucket = this.threadSubscribers.get(conversationId);
        if (threadBucket) {
            for (const subscriber of threadBucket) {
                this.dispatchSubscriber(subscriber, conversationId);
            }
        }
    }

    protected buildSnapshot(conversationId?: string): QaapThreadStoreSnapshot {
        return {
            summariesById: this.summariesById,
            document: conversationId ? this.documents.get(conversationId) : undefined,
        };
    }
}

export function sortConversationSummaries(
    list: readonly QaapAgentConversationSummaryDTO[],
): QaapAgentConversationSummaryDTO[] {
    return [...list].sort((a, b) => {
        const aStreaming = a.status === 'streaming' ? 1 : 0;
        const bStreaming = b.status === 'streaming' ? 1 : 0;
        if (aStreaming !== bStreaming) {
            return bStreaming - aStreaming;
        }
        return b.updatedAt - a.updatedAt;
    });
}

/** Batch dispose helper for thread-scoped subscriptions. */
export function bindQaapThreadStoreSubscriptions(
    ...disposables: Disposable[]
): Disposable {
    return new DisposableCollection(...disposables);
}

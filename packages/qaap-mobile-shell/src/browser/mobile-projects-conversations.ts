// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import URI from '@theia/core/lib/common/uri';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    QAAP_AGENT_CONVERSATION_API_PATH,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
} from '../common/qaap-agent-conversation-client';
import {
    QaapConversationStreamMetricsCollector,
    type QaapTurnLatencyMark,
} from '../common/qaap-agent-stream-metrics';
import type { QaapAgentMessageWireDelta } from '../common/qaap-agent-message-wire-delta';
import {
    type QaapConversationChangeEvent,
} from '../common/qaap-conversation-change';
import { QaapThreadStore } from '../common/qaap-thread-store';
import type { QaapThreadStoreUpsertResult } from '../common/qaap-thread-store';
import { applyConversationGroupsExtracted, cacheDocumentExtracted, cancelConversationLiveExtracted, dispatchSseEventExtracted, emitConversationChangeExtracted, findConversationsForProjectExtracted, findSummaryByIdExtracted, findTheiaSerializedConversationBySessionIdExtracted, getConversationsForCwdExtracted, getSubmitLatencyMarksExtracted, getTheiaConversationExtracted, installVisibilityReconnectExtracted, mergeCwdConversationListsExtracted, openSseStreamExtracted, openWebSocketExtracted, perfProbeSeedSummariesExtracted, perfProbeTickStreamingSummariesExtracted, prefetchDocumentExtracted, prefetchDocumentsExtracted, primeFromAllExtracted, recordSnapshotExtracted, recordSubmitLatencyMarkExtracted, refreshTheiaChatSessionsForProjectsExtracted, removeSnapshotExtracted, resolveWorkspaceMetadataCwdExtracted, schedulePrimeFromAllExtracted, startExtracted } from './mobile-projects-conversations-render';
import { clearReconnectTimersExtracted, closeSseExtracted, closeWebSocketExtracted, dispatchLiveMessageDeltaExtracted, dispatchLiveMessageExtracted, dispatchServerPayloadExtracted, findTheiaSummaryExtracted, getAllConversationBucketsExtracted, markStreamingTransportsExtracted, readJsonExtracted, recordClientStreamMetricsExtracted, refreshSummaryFromLiveDeltaExtracted, refreshSummaryFromLiveMessageExtracted, resolvePreviewDeltaExtracted, scheduleSseReconnectExtracted, scheduleWebSocketReconnectExtracted } from './mobile-projects-conversations-streaming';

export const STREAM_URL = `${QAAP_AGENT_CONVERSATION_API_PATH}/stream`;
/** Minimum gap between full `/all` primes; live WS/SSE events reconcile state in between. */
export const PRIME_FROM_ALL_TTL_MS = 20_000;
export const SSE_RECONNECT_DELAY_MS = 5_000;
/** Exponential backoff cap for WebSocket reconnects. */
export const WS_RECONNECT_MAX_MS = 30_000;

interface ConversationCreatedEvent {
    readonly type: 'created' | 'updated';
    readonly conversation: QaapAgentConversationSummaryDTO;
}
export interface ConversationMessageEvent {
    readonly type: 'message';
    readonly conversationId: string;
    readonly cwd: string;
    readonly message: QaapAgentMessageDTO;
}
export interface ConversationMessageDeltaEvent {
    readonly type: 'message_delta';
    readonly conversationId: string;
    readonly cwd: string;
    readonly messageId: string;
    readonly delta: QaapAgentMessageWireDelta;
}
export type ConversationLiveMessageEvent = ConversationMessageEvent | ConversationMessageDeltaEvent;
interface ConversationDeletedEvent {
    readonly type: 'deleted';
    readonly conversationId: string;
    readonly cwd: string;
}
interface ConversationParallelRunEvent {
    readonly type: 'parallel-run';
    readonly runId: string;
    readonly variants: import('../common/qaap-parallel-run-client').QaapParallelRunVariantStatsDTO[];
}
interface ConversationPendingQueuedEvent {
    readonly type: 'pending-queued';
    readonly conversationId: string;
    readonly cwd: string;
    readonly message: import('../common/qaap-agent-conversation-client').QaapPendingUserMessageDTO;
}
interface ConversationPendingDrainedEvent {
    readonly type: 'pending-drained';
    readonly conversationId: string;
    readonly cwd: string;
    readonly drainedCount: number;
}
interface ConversationSnapshotEvent {
    readonly type: 'snapshot';
    readonly groups: ReadonlyArray<{
        readonly cwd: string;
        readonly conversations: ReadonlyArray<QaapAgentConversationSummaryDTO>;
    }>;
}
export type ConversationServerEvent =
    | ConversationSnapshotEvent
    | ConversationCreatedEvent
    | ConversationMessageEvent
    | ConversationMessageDeltaEvent
    | ConversationDeletedEvent
    | ConversationParallelRunEvent
    | ConversationPendingQueuedEvent
    | ConversationPendingDrainedEvent
    | { readonly type: 'pong' }
    | { readonly type: 'heartbeat' };

/**
 * Cross-project live view of agent conversations on the VPS. The Projects panel subscribes to
 * {@link onDidChange} to refresh card listings and streaming dots as turns start and complete on
 * any project, without polling.
 */
@injectable()
export class MobileProjectsConversations {

    snapshotState: 'loading' | 'ready' | 'error' = 'loading';

    /** Canonical per-thread summaries + lazy documents (AG-UI MessagesSnapshot path). */
    readonly threadStore = new QaapThreadStore();
    /**
     * Keeps stale HTTP/WS snapshots from resurrecting rows deleted optimistically.
     * @internal Used by the extracted mobile-projects-conversations-* modules.
     */
    public readonly deletedConversationIds = new Set<string>();
    /**
     * E2E perf probe: survives server snapshot clears in {@link applyConversationGroups}.
     * @internal Used by the extracted mobile-projects-conversations-* modules.
     */
    public readonly perfProbeByCwd = new Map<string, QaapAgentConversationSummaryDTO[]>();
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly theiaByCwd = new Map<string, QaapAgentConversationSummaryDTO[]>();
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly theiaSessionFiles = new Map<string, URI>();
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public source: EventSource | undefined;
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public socket: WebSocket | undefined;
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public transport: 'ws' | 'sse' | 'none' = 'none';
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public sseReconnectHandle: number | undefined;
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public wsReconnectHandle: number | undefined;
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public wsReconnectAttempt = 0;
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public liveCancelDispose: Disposable = Disposable.NULL;
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly streamMetrics = new QaapConversationStreamMetricsCollector('client');
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly submitLatencyMarks = new Map<string, Partial<Record<QaapTurnLatencyMark, number>>>();
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public started = false;
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public visibilityListenerInstalled = false;
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public transportWasDisconnected = false;
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly documentPrefetchInFlight = new Set<string>();

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly onDidChangeEmitter = new Emitter<void>();
    /** Fires whenever conversation state on the server changes (any project). */
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    recordSubmitLatencyMark(conversationId: string | undefined, mark: QaapTurnLatencyMark, at?: number): void {
        recordSubmitLatencyMarkExtracted(this, conversationId, mark, at);
    }

    getSubmitLatencyMarks(conversationId: string | undefined): Partial<Record<QaapTurnLatencyMark, number>> | undefined {
        return getSubmitLatencyMarksExtracted(this, conversationId);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly onDidChangeDetailEmitter = new Emitter<QaapConversationChangeEvent>();
    /** Fine-grained change metadata for selective hub / sidebar refresh. */
    readonly onDidChangeDetail: Event<QaapConversationChangeEvent> = this.onDidChangeDetailEmitter.event;

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly onDidReceiveMessageEmitter = new Emitter<ConversationLiveMessageEvent>();
    /** Fires on each live SSE message chunk — includes structured segments for QAIQ/OpenCode. */
    readonly onDidReceiveMessage: Event<ConversationLiveMessageEvent> = this.onDidReceiveMessageEmitter.event;

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly onDidReceiveParallelRunEmitter = new Emitter<ConversationParallelRunEvent>();
    /** Fires when parallel-run variant diff stats change on the VPS. */
    readonly onDidReceiveParallelRun: Event<ConversationParallelRunEvent> = this.onDidReceiveParallelRunEmitter.event;

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly onDidReceivePendingQueueEmitter = new Emitter<ConversationPendingQueuedEvent | ConversationPendingDrainedEvent>();
    /** Fires when same-session follow-ups are queued or drained (Cursor-style pending list). */
    readonly onDidReceivePendingQueue: Event<ConversationPendingQueuedEvent | ConversationPendingDrainedEvent> =
        this.onDidReceivePendingQueueEmitter.event;

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly onDidReconnectTransportEmitter = new Emitter<void>();
    /** Fires after WS/SSE reconnect — open transcript should refetch (MessagesSnapshot-style). */
    readonly onDidReconnectTransport: Event<void> = this.onDidReconnectTransportEmitter.event;

    /** Fires on any transport-liveness frame (heartbeat / pong) so the transcript can keep its
     *  stream-health clock fresh while the connection is alive but no message has arrived yet. */
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly onDidReceiveTransportActivityEmitter = new Emitter<void>();
    readonly onDidReceiveTransportActivity: Event<void> = this.onDidReceiveTransportActivityEmitter.event;

    @inject(FileService)
    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public readonly fileService: FileService;

    @inject(EnvVariablesServer)
    protected readonly envServer: EnvVariablesServer;

    start(): void {
        startExtracted(this);
    }

    /**
     * Pre-connect WS/SSE and prime conversation snapshots before the user sends a turn.
     * Safe to call from composer mount, transcript watch, or hub navigation.
     */
    warmLiveTransport(): void {
        this.start();
        this.schedulePrimeFromAll();
    }

    /** E2E perf probe: simulate one live conversation tick without network I/O. */
    perfProbeFireDidChange(): void {
        this.emitConversationChange({ kind: 'updated' });
    }

    perfProbeSeedSummaries(cwd: string, summaries: readonly QaapAgentConversationSummaryDTO[]): void {
        perfProbeSeedSummariesExtracted(this, cwd, summaries);
    }

    perfProbeTickStreamingSummaries(cwd: string): void {
        perfProbeTickStreamingSummariesExtracted(this, cwd);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public primeFromAllInFlight: Promise<void> | undefined;

    /**
     * Fallback prime timer armed on WS open; cancelled once the server snapshot arrives.
     * @internal Used by the extracted mobile-projects-conversations-* modules.
     */
    public wsSnapshotFallbackHandle: number | undefined;

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public schedulePrimeFromAll(): void {
        schedulePrimeFromAllExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public lastPrimeFromAllAt = 0;

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public installVisibilityReconnect(): void {
        installVisibilityReconnectExtracted(this);
    }

    getConversationsForCwd(cwd: string): QaapAgentConversationSummaryDTO[] {
        return getConversationsForCwdExtracted(this, cwd);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public mergeCwdConversationLists(...lists: ReadonlyArray<readonly QaapAgentConversationSummaryDTO[]>): QaapAgentConversationSummaryDTO[] {
        return mergeCwdConversationListsExtracted(this, ...lists);
    }

    /** True when any conversation in any project is currently streaming a turn. */
    getStreamingCountForCwd(cwd: string): number {
        return this.threadStore.getSummariesForCwd(cwd).reduce((n, c) => n + (c.status === 'streaming' ? 1 : 0), 0);
    }

    /**
     * Parallel-run variant conversations live in a tmpdir worktree (so their own cwd won't match
     * the repo), but carry `parallelBaseCwd` pointing at the originating repo. This returns the
     * variants whose base equals {@link baseCwd} so they can be grouped under that repo in Chats.
     */
    getVariantsForBaseCwd(baseCwd: string): QaapAgentConversationSummaryDTO[] {
        return this.threadStore.getVariantsForBaseCwd(baseCwd);
    }

    findConversationsForProject(project: { readonly name: string; readonly github?: { readonly owner: string; readonly name: string }; }): QaapAgentConversationSummaryDTO[] {
        return findConversationsForProjectExtracted(this, project);
    }

    async refreshTheiaChatSessionsForProjects(_projects: ReadonlyArray<{ readonly name: string; readonly uri?: URI; readonly github?: { readonly owner: string; readonly name: string }; readonly isCurrent?: boolean; }>): Promise<void> {
        return refreshTheiaChatSessionsForProjectsExtracted(this, _projects);
    }

    protected resolveWorkspaceMetadataCwd(project: { readonly name: string; readonly uri?: URI; readonly github?: { readonly owner: string; readonly name: string } }, workspaceIndex: Record<string, string>,): string | undefined {
        return resolveWorkspaceMetadataCwdExtracted(this, project, workspaceIndex);
    }

    async getTheiaConversation(id: string): Promise<QaapAgentConversationDTO | undefined> {
        return getTheiaConversationExtracted(this, id);
    }

    async getTheiaSerializedConversation(id: string): Promise<unknown | undefined> {
        const file = this.theiaSessionFiles.get(id);
        return file ? this.readJson<unknown>(file) : undefined;
    }

    async findTheiaSerializedConversationBySessionId(sessionId: string, cwd?: string): Promise<unknown | undefined> {
        return findTheiaSerializedConversationBySessionIdExtracted(this, sessionId, cwd);
    }

    recordSnapshot(conv: QaapAgentConversationSummaryDTO): void {
        recordSnapshotExtracted(this, conv);
    }

    /** Roll back a failed optimistic deletion and allow server updates for the row again. */
    restoreSnapshot(conv: QaapAgentConversationSummaryDTO): void {
        this.deletedConversationIds.delete(conv.id);
        this.recordSnapshot(conv);
    }

    cacheDocument(document: QaapAgentConversationDTO): boolean {
        return cacheDocumentExtracted(this, document);
    }

    prefetchDocument(conversationId: string): void {
        prefetchDocumentExtracted(this, conversationId);
    }

    prefetchDocuments(conversationIds: readonly string[]): void {
        prefetchDocumentsExtracted(this, conversationIds);
    }

    findSummaryById(id: string): QaapAgentConversationSummaryDTO | undefined {
        return findSummaryByIdExtracted(this, id);
    }

    /** All VPS conversation summaries (newest first per cwd bucket). */
    listAllSummaries(): QaapAgentConversationSummaryDTO[] {
        return this.threadStore.listAllSummaries();
    }

    removeSnapshot(conversationId: string, cwd: string, source?: QaapAgentConversationSummaryDTO['source']): void {
        removeSnapshotExtracted(this, conversationId, cwd, source);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public async primeFromAll(): Promise<void> {
        return primeFromAllExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public applyConversationGroups(groups: ReadonlyArray<{ readonly cwd: string; readonly conversations: ReadonlyArray<QaapAgentConversationSummaryDTO> }>,): void {
        applyConversationGroupsExtracted(this, groups);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public emitConversationChange(event: QaapConversationChangeEvent): void {
        emitConversationChangeExtracted(this, event);
    }

    /** Latest typed change paired with the preceding `onDidChange` tick. */
    peekLastConversationChange(): QaapConversationChangeEvent | undefined {
        return this.lastConversationChange;
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public lastConversationChange: QaapConversationChangeEvent | undefined;

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public async cancelConversationLive(id: string): Promise<void> {
        return cancelConversationLiveExtracted(this, id);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public openWebSocket(): void {
        openWebSocketExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public openSseStream(): void {
        openSseStreamExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public dispatchSseEvent(ev: MessageEvent): void {
        dispatchSseEventExtracted(this, ev);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public dispatchServerPayload(payload: ConversationServerEvent): void {
        dispatchServerPayloadExtracted(this, payload);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public scheduleWebSocketReconnect(): void {
        scheduleWebSocketReconnectExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public scheduleSseReconnect(): void {
        scheduleSseReconnectExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public closeWebSocket(): void {
        closeWebSocketExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public closeSse(): void {
        closeSseExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public clearReconnectTimers(): void {
        clearReconnectTimersExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public async dispatchLiveMessage(payload: ConversationMessageEvent): Promise<void> {
        return dispatchLiveMessageExtracted(this, payload);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public async dispatchLiveMessageDelta(payload: ConversationMessageDeltaEvent): Promise<void> {
        return dispatchLiveMessageDeltaExtracted(this, payload);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public recordClientStreamMetrics(wirePayload: ConversationServerEvent, expandedPayload?: ConversationServerEvent,): void {
        recordClientStreamMetricsExtracted(this, wirePayload, expandedPayload);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public refreshSummaryFromLiveMessage(payload: ConversationMessageEvent): void {
        refreshSummaryFromLiveMessageExtracted(this, payload);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public refreshSummaryFromLiveDelta(payload: ConversationMessageDeltaEvent): void {
        refreshSummaryFromLiveDeltaExtracted(this, payload);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public resolvePreviewDelta(delta: QaapAgentMessageWireDelta): string | undefined {
        return resolvePreviewDeltaExtracted(this, delta);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public upsert(conv: QaapAgentConversationSummaryDTO): QaapThreadStoreUpsertResult {
        return this.threadStore.upsertSummary(conv);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public markStreamingTransports(transport: 'ws' | 'sse'): void {
        markStreamingTransportsExtracted(this, transport);
    }

    protected getAllConversationBuckets(): Array<[string, QaapAgentConversationSummaryDTO[]]> {
        return getAllConversationBucketsExtracted(this);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public findTheiaSummary(id: string): QaapAgentConversationSummaryDTO | undefined {
        return findTheiaSummaryExtracted(this, id);
    }

    /** @internal Used by the extracted mobile-projects-conversations-* modules. */
    public async readJson<T>(uri: URI): Promise<T | undefined> {
        return readJsonExtracted<T>(this, uri);
    }
}

export function sortConversations(list: QaapAgentConversationSummaryDTO[]): QaapAgentConversationSummaryDTO[] {
    return [...list].sort((a, b) => {
        const aStreaming = a.status === 'streaming' ? 1 : 0;
        const bStreaming = b.status === 'streaming' ? 1 : 0;
        if (aStreaming !== bStreaming) {
            return bStreaming - aStreaming;
        }
        return b.updatedAt - a.updatedAt;
    });
}


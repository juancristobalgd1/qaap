// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

import URI from '@theia/core/lib/common/uri';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    QAAP_AGENT_CONVERSATION_API_PATH,
    QAAP_AGENT_CONVERSATION_WS_PATH,
    cancelConversationHttp,
    getConversation,
    listAllConversationGroups,
    registerConversationLiveCancel,
    type QaapAgentConversationDTO,
    type QaapAgentConversationSummaryDTO,
    type QaapAgentMessageDTO,
} from '../common/qaap-agent-conversation-client';
import { isQaapWorkHubPerfProbeEnabled } from '../common/qaap-work-hub-perf-probe';
import {
    QaapConversationStreamMetricsCollector,
    countCompressedWireFields,
    logQaapStreamMetrics,
    type QaapTurnLatencyMark,
} from '../common/qaap-agent-stream-metrics';
import {
    expandAgentMessageForWire,
    expandAgentMessageWireDelta,
} from '../common/qaap-agent-message-wire-compress';
import type { QaapAgentMessageWireDelta } from '../common/qaap-agent-message-wire-delta';
import { normalizeAgentMessageContentForDisplay, resolveMessagePreviewText } from '../common/qaap-agent-message-content';
import {
    type QaapConversationChangeEvent,
} from '../common/qaap-conversation-change';
import { backfillConversationTraceEvents } from '../common/qaap-transcript-trace-backfill';
import { QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID } from '../common/qaap-agents-hub-landing';
import { QaapThreadStore } from '../common/qaap-thread-store';
import type { QaapThreadStoreUpsertResult } from '../common/qaap-thread-store';
import { cwdMatchesProject, lookupByCwd, normalizeCwd } from './mobile-projects-active-tasks';
import { applyConversationGroupsExtracted, cacheDocumentExtracted, cancelConversationLiveExtracted, dispatchSseEventExtracted, emitConversationChangeExtracted, findConversationsForProjectExtracted, findSummaryByIdExtracted, findTheiaSerializedConversationBySessionIdExtracted, getConversationsForCwdExtracted, getSubmitLatencyMarksExtracted, getTheiaConversationExtracted, installVisibilityReconnectExtracted, mergeCwdConversationListsExtracted, openSseStreamExtracted, openWebSocketExtracted, perfProbeSeedSummariesExtracted, perfProbeTickStreamingSummariesExtracted, prefetchDocumentExtracted, prefetchDocumentsExtracted, primeFromAllExtracted, recordSnapshotExtracted, recordSubmitLatencyMarkExtracted, refreshTheiaChatSessionsForProjectsExtracted, removeSnapshotExtracted, resolveWorkspaceMetadataCwdExtracted, schedulePrimeFromAllExtracted, startExtracted } from './mobile-projects-conversations-render2';
import { clearReconnectTimersExtracted, closeSseExtracted, closeWebSocketExtracted, dispatchLiveMessageDeltaExtracted, dispatchLiveMessageExtracted, dispatchServerPayloadExtracted, findTheiaSummaryExtracted, getAllConversationBucketsExtracted, markStreamingTransportsExtracted, readJsonExtracted, recordClientStreamMetricsExtracted, refreshSummaryFromLiveDeltaExtracted, refreshSummaryFromLiveMessageExtracted, resolvePreviewDeltaExtracted, scheduleSseReconnectExtracted, scheduleWebSocketReconnectExtracted } from './mobile-projects-conversations-streaming2';

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
interface ConversationMessageEvent {
    readonly type: 'message';
    readonly conversationId: string;
    readonly cwd: string;
    readonly message: QaapAgentMessageDTO;
}
interface ConversationMessageDeltaEvent {
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
type ConversationServerEvent =
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

    /** Canonical per-thread summaries + lazy documents (AG-UI MessagesSnapshot path). */
    readonly threadStore = new QaapThreadStore();
    /** Keeps stale HTTP/WS snapshots from resurrecting rows deleted optimistically. */
    protected readonly deletedConversationIds = new Set<string>();
    /** E2E perf probe: survives server snapshot clears in {@link applyConversationGroups}. */
    protected readonly perfProbeByCwd = new Map<string, QaapAgentConversationSummaryDTO[]>();
    protected readonly theiaByCwd = new Map<string, QaapAgentConversationSummaryDTO[]>();
    protected readonly theiaSessionFiles = new Map<string, URI>();
    protected source: EventSource | undefined;
    protected socket: WebSocket | undefined;
    protected transport: 'ws' | 'sse' | 'none' = 'none';
    protected sseReconnectHandle: number | undefined;
    protected wsReconnectHandle: number | undefined;
    protected wsReconnectAttempt = 0;
    protected liveCancelDispose: Disposable = Disposable.NULL;
    protected readonly streamMetrics = new QaapConversationStreamMetricsCollector('client');
    protected readonly submitLatencyMarks = new Map<string, Partial<Record<QaapTurnLatencyMark, number>>>();
    protected started = false;
    protected visibilityListenerInstalled = false;
    protected transportWasDisconnected = false;
    protected readonly documentPrefetchInFlight = new Set<string>();

    protected readonly onDidChangeEmitter = new Emitter<void>();
    /** Fires whenever conversation state on the server changes (any project). */
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    recordSubmitLatencyMark(conversationId: string | undefined, mark: QaapTurnLatencyMark, at?: number): void {
        recordSubmitLatencyMarkExtracted(this, conversationId, mark, at);
    }

    getSubmitLatencyMarks(conversationId: string | undefined): Partial<Record<QaapTurnLatencyMark, number>> | undefined {
        return getSubmitLatencyMarksExtracted(this, conversationId);
    }

    protected readonly onDidChangeDetailEmitter = new Emitter<QaapConversationChangeEvent>();
    /** Fine-grained change metadata for selective hub / sidebar refresh. */
    readonly onDidChangeDetail: Event<QaapConversationChangeEvent> = this.onDidChangeDetailEmitter.event;

    protected readonly onDidReceiveMessageEmitter = new Emitter<ConversationLiveMessageEvent>();
    /** Fires on each live SSE message chunk — includes structured segments for QAIQ/OpenCode. */
    readonly onDidReceiveMessage: Event<ConversationLiveMessageEvent> = this.onDidReceiveMessageEmitter.event;

    protected readonly onDidReceiveParallelRunEmitter = new Emitter<ConversationParallelRunEvent>();
    /** Fires when parallel-run variant diff stats change on the VPS. */
    readonly onDidReceiveParallelRun: Event<ConversationParallelRunEvent> = this.onDidReceiveParallelRunEmitter.event;

    protected readonly onDidReceivePendingQueueEmitter = new Emitter<ConversationPendingQueuedEvent | ConversationPendingDrainedEvent>();
    /** Fires when same-session follow-ups are queued or drained (Cursor-style pending list). */
    readonly onDidReceivePendingQueue: Event<ConversationPendingQueuedEvent | ConversationPendingDrainedEvent> =
        this.onDidReceivePendingQueueEmitter.event;

    protected readonly onDidReconnectTransportEmitter = new Emitter<void>();
    /** Fires after WS/SSE reconnect — open transcript should refetch (MessagesSnapshot-style). */
    readonly onDidReconnectTransport: Event<void> = this.onDidReconnectTransportEmitter.event;

    /** Fires on any transport-liveness frame (heartbeat / pong) so the transcript can keep its
     *  stream-health clock fresh while the connection is alive but no message has arrived yet. */
    protected readonly onDidReceiveTransportActivityEmitter = new Emitter<void>();
    readonly onDidReceiveTransportActivity: Event<void> = this.onDidReceiveTransportActivityEmitter.event;

    @inject(FileService)
    protected readonly fileService: FileService;

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

    protected primeFromAllInFlight: Promise<void> | undefined;

    /** Fallback prime timer armed on WS open; cancelled once the server snapshot arrives. */
    protected wsSnapshotFallbackHandle: number | undefined;

    protected schedulePrimeFromAll(): void {
        schedulePrimeFromAllExtracted(this);
    }

    protected lastPrimeFromAllAt = 0;

    protected installVisibilityReconnect(): void {
        installVisibilityReconnectExtracted(this);
    }

    getConversationsForCwd(cwd: string): QaapAgentConversationSummaryDTO[] {
        return getConversationsForCwdExtracted(this, cwd);
    }

    protected mergeCwdConversationLists(...lists: ReadonlyArray<readonly QaapAgentConversationSummaryDTO[]>): QaapAgentConversationSummaryDTO[] {
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

    protected async primeFromAll(): Promise<void> {
        return primeFromAllExtracted(this);
    }

    protected applyConversationGroups(groups: ReadonlyArray<{ readonly cwd: string; readonly conversations: ReadonlyArray<QaapAgentConversationSummaryDTO> }>,): void {
        applyConversationGroupsExtracted(this, groups);
    }

    protected emitConversationChange(event: QaapConversationChangeEvent): void {
        emitConversationChangeExtracted(this, event);
    }

    /** Latest typed change paired with the preceding `onDidChange` tick. */
    peekLastConversationChange(): QaapConversationChangeEvent | undefined {
        return this.lastConversationChange;
    }

    protected lastConversationChange: QaapConversationChangeEvent | undefined;

    protected async cancelConversationLive(id: string): Promise<void> {
        return cancelConversationLiveExtracted(this, id);
    }

    protected openWebSocket(): void {
        openWebSocketExtracted(this);
    }

    protected openSseStream(): void {
        openSseStreamExtracted(this);
    }

    protected dispatchSseEvent(ev: MessageEvent): void {
        dispatchSseEventExtracted(this, ev);
    }

    protected dispatchServerPayload(payload: ConversationServerEvent): void {
        dispatchServerPayloadExtracted(this, payload);
    }

    protected scheduleWebSocketReconnect(): void {
        scheduleWebSocketReconnectExtracted(this);
    }

    protected scheduleSseReconnect(): void {
        scheduleSseReconnectExtracted(this);
    }

    protected closeWebSocket(): void {
        closeWebSocketExtracted(this);
    }

    protected closeSse(): void {
        closeSseExtracted(this);
    }

    protected clearReconnectTimers(): void {
        clearReconnectTimersExtracted(this);
    }

    protected async dispatchLiveMessage(payload: ConversationMessageEvent): Promise<void> {
        return dispatchLiveMessageExtracted(this, payload);
    }

    protected async dispatchLiveMessageDelta(payload: ConversationMessageDeltaEvent): Promise<void> {
        return dispatchLiveMessageDeltaExtracted(this, payload);
    }

    protected recordClientStreamMetrics(wirePayload: ConversationServerEvent, expandedPayload?: ConversationServerEvent,): void {
        recordClientStreamMetricsExtracted(this, wirePayload, expandedPayload);
    }

    protected refreshSummaryFromLiveMessage(payload: ConversationMessageEvent): void {
        refreshSummaryFromLiveMessageExtracted(this, payload);
    }

    protected refreshSummaryFromLiveDelta(payload: ConversationMessageDeltaEvent): void {
        refreshSummaryFromLiveDeltaExtracted(this, payload);
    }

    protected resolvePreviewDelta(delta: QaapAgentMessageWireDelta): string | undefined {
        return resolvePreviewDeltaExtracted(this, delta);
    }

    protected upsert(conv: QaapAgentConversationSummaryDTO): QaapThreadStoreUpsertResult {
        return this.threadStore.upsertSummary(conv);
    }

    protected markStreamingTransports(transport: 'ws' | 'sse'): void {
        markStreamingTransportsExtracted(this, transport);
    }

    protected getAllConversationBuckets(): Array<[string, QaapAgentConversationSummaryDTO[]]> {
        return getAllConversationBucketsExtracted(this);
    }

    protected findTheiaSummary(id: string): QaapAgentConversationSummaryDTO | undefined {
        return findTheiaSummaryExtracted(this, id);
    }

    protected async readJson(uri: URI): Promise<T | undefined> {
        return readJsonExtracted(this, uri);
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

function cwdBaseName(cwd: string): string {
    return normalizeCwd(cwd).split('/').pop()?.toLowerCase() ?? '';
}

function uriToFsPath(uri: URI): string {
    const raw = uri.path.toString();
    if (/^\/[A-Za-z]:/.test(raw)) {
        return raw.slice(1);
    }
    return raw;
}

function excerpt(text: string | undefined): string {
    const clean = (text ?? '').replace(/\s+/g, ' ').trim();
    return clean.length > 160 ? `${clean.slice(0, 157)}…` : clean;
}

interface TheiaSerializedChatData {
    readonly title?: string;
    readonly pinnedAgentId?: string;
    readonly saveDate: number;
    readonly model: {
        readonly requests?: ReadonlyArray<{ readonly id: string; readonly text?: string }>;
        readonly responses?: ReadonlyArray<TheiaSerializedChatResponse>;
    };
}

interface TheiaSerializedChatResponse {
    readonly requestId: string;
    readonly content?: ReadonlyArray<TheiaSerializedChatResponsePart>;
}

interface TheiaSerializedChatResponsePart {
    readonly kind: string;
    readonly fallbackMessage?: string;
    readonly data?: { readonly content?: string; readonly code?: string };
}

function theiaMessagesToConversationMessages(data: TheiaSerializedChatData): QaapAgentMessageDTO[] {
    const responsesByRequestId = new Map((data.model.responses ?? []).map(response => [response.requestId, response]));
    const messages: QaapAgentMessageDTO[] = [];
    let offset = 0;
    for (const request of data.model.requests ?? []) {
        const userText = request.text ? normalizeAgentMessageContentForDisplay(request.text).trim() : '';
        if (userText) {
            messages.push({
                id: `${request.id}:user`,
                role: 'user',
                content: userText,
                createdAt: data.saveDate + offset++,
            });
        }
        const responseText = normalizeAgentMessageContentForDisplay(responseToText(responsesByRequestId.get(request.id))).trim();
        if (responseText) {
            messages.push({
                id: `${request.id}:agent`,
                role: 'agent',
                content: responseText,
                createdAt: data.saveDate + offset++,
            });
        }
    }
    return messages;
}

function responseToText(response: TheiaSerializedChatResponse | undefined): string {
    if (!response?.content) {
        return '';
    }
    return response.content
        .map(part => part.data?.content ?? part.data?.code ?? part.fallbackMessage ?? '')
        .filter(Boolean)
        .join('\n\n');
}

function bufferToString(buffer: BinaryBuffer | { toString(): string }): string {
    return buffer.toString();
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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
import { QaapThreadStore } from '../common/qaap-thread-store';
import type { QaapThreadStoreUpsertResult } from '../common/qaap-thread-store';
import { cwdMatchesProject, lookupByCwd, normalizeCwd } from './mobile-projects-active-tasks';

const STREAM_URL = `${QAAP_AGENT_CONVERSATION_API_PATH}/stream`;
const SSE_RECONNECT_DELAY_MS = 5_000;
/** Exponential backoff cap for WebSocket reconnects. */
const WS_RECONNECT_MAX_MS = 30_000;

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
    | { readonly type: 'pong' };

/**
 * Cross-project live view of agent conversations on the VPS. The Projects panel subscribes to
 * {@link onDidChange} to refresh card listings and streaming dots as turns start and complete on
 * any project, without polling.
 */
@injectable()
export class MobileProjectsConversations {

    /** Canonical per-thread summaries + lazy documents (AG-UI MessagesSnapshot path). */
    readonly threadStore = new QaapThreadStore();
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
        this.streamMetrics.recordLatencyMark(conversationId, mark, at);
        if (!conversationId) {
            return;
        }
        const marks = this.submitLatencyMarks.get(conversationId) ?? {};
        if (marks[mark] === undefined) {
            marks[mark] = at ?? Date.now();
            this.submitLatencyMarks.set(conversationId, marks);
        }
    }

    getSubmitLatencyMarks(conversationId: string | undefined): Partial<Record<QaapTurnLatencyMark, number>> | undefined {
        if (!conversationId) {
            return undefined;
        }
        const marks = this.submitLatencyMarks.get(conversationId);
        return marks ? { ...marks } : undefined;
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

    protected readonly onDidReconnectTransportEmitter = new Emitter<void>();
    /** Fires after WS/SSE reconnect — open transcript should refetch (MessagesSnapshot-style). */
    readonly onDidReconnectTransport: Event<void> = this.onDidReconnectTransportEmitter.event;

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(EnvVariablesServer)
    protected readonly envServer: EnvVariablesServer;

    /** Idempotent — opens the WebSocket (SSE fallback) feed the first time it is called. */
    start(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        this.liveCancelDispose = registerConversationLiveCancel(id => this.cancelConversationLive(id));
        this.openWebSocket();
        this.installVisibilityReconnect();
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

    /** E2E perf probe: seed synthetic summaries for multi-agent hub scenarios. */
    perfProbeSeedSummaries(cwd: string, summaries: readonly QaapAgentConversationSummaryDTO[]): void {
        if (!isQaapWorkHubPerfProbeEnabled()) {
            return;
        }
        this.perfProbeByCwd.set(normalizeCwd(cwd), sortConversations([...summaries]));
    }

    /** E2E perf probe: bump streaming turn progress and emit one change event. */
    perfProbeTickStreamingSummaries(cwd: string): void {
        if (!isQaapWorkHubPerfProbeEnabled()) {
            return;
        }
        const key = normalizeCwd(cwd);
        const list = this.perfProbeByCwd.get(key) ?? [];
        const next = list.map(summary => summary.status === 'streaming'
            ? {
                ...summary,
                turnProgressCurrent: (summary.turnProgressCurrent ?? 0) + 1,
                updatedAt: summary.updatedAt + 1,
            }
            : summary);
        this.perfProbeByCwd.set(key, sortConversations(next));
        this.emitConversationChange({ kind: 'updated' });
    }

    protected primeFromAllInFlight: Promise<void> | undefined;

    protected schedulePrimeFromAll(): void {
        if (!this.primeFromAllInFlight) {
            this.primeFromAllInFlight = this.primeFromAll().finally(() => {
                this.primeFromAllInFlight = undefined;
            });
        }
    }

    /** iOS Safari suspends EventSource in background tabs — reconnect when the page is visible again. */
    protected installVisibilityReconnect(): void {
        if (this.visibilityListenerInstalled || typeof document === 'undefined' || typeof window === 'undefined') {
            return;
        }
        this.visibilityListenerInstalled = true;
        const reconnect = (): void => {
            if (document.visibilityState !== 'visible') {
                return;
            }
            this.closeWebSocket();
            this.closeSse();
            this.clearReconnectTimers();
            this.openWebSocket();
        };
        document.addEventListener('visibilitychange', reconnect);
        window.addEventListener('pageshow', reconnect);
    }

    /** Conversations for one project cwd, sorted newest first. */
    getConversationsForCwd(cwd: string): QaapAgentConversationSummaryDTO[] {
        const probe = isQaapWorkHubPerfProbeEnabled()
            ? lookupByCwd(this.perfProbeByCwd, cwd) ?? []
            : [];
        return this.mergeCwdConversationLists(
            lookupByCwd(this.theiaByCwd, cwd) ?? [],
            this.threadStore.getSummariesForCwd(cwd),
            probe,
        );
    }

    protected mergeCwdConversationLists(
        ...lists: ReadonlyArray<readonly QaapAgentConversationSummaryDTO[]>
    ): QaapAgentConversationSummaryDTO[] {
        const byId = new Map<string, QaapAgentConversationSummaryDTO>();
        for (const list of lists) {
            for (const summary of list) {
                byId.set(summary.id, summary);
            }
        }
        return sortConversations([...byId.values()]);
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

    /**
     * Match conversations when the panel only knows repo identity (a GitHub card without a local
     * cwd yet). Mirrors the heuristic used by {@link MobileProjectsActiveTasks}.
     */
    findConversationsForProject(project: {
        readonly name: string;
        readonly github?: { readonly owner: string; readonly name: string };
    }): QaapAgentConversationSummaryDTO[] {
        const merged = this.threadStore.listAllSummaries().filter(summary => cwdMatchesProject(summary.cwd, project));
        return sortConversations(merged);
    }

    /**
     * Reads Theia's real persisted AI chat sessions for the listed project cwds. These are the
     * same sessions shown as "Recent Chats" in the workspace Chat welcome view, stored under
     * `$CONFIGDIR/workspace-metadata/<workspace-uuid>/chatSessions`.
     */
    async refreshTheiaChatSessionsForProjects(_projects: ReadonlyArray<{
        readonly name: string;
        readonly uri?: URI;
        readonly github?: { readonly owner: string; readonly name: string };
        readonly isCurrent?: boolean;
    }>): Promise<void> {
        // Qaap product: Work Hub uses VPS QAIQ conversations only — do not merge Theia Coder sessions.
        this.theiaByCwd.clear();
        this.theiaSessionFiles.clear();
    }

    protected resolveWorkspaceMetadataCwd(
        project: { readonly name: string; readonly uri?: URI; readonly github?: { readonly owner: string; readonly name: string } },
        workspaceIndex: Record<string, string>,
    ): string | undefined {
        const fromUri = project.uri?.scheme === 'file' ? normalizeCwd(uriToFsPath(project.uri)) : undefined;
        if (fromUri && workspaceIndex[fromUri]) {
            return fromUri;
        }
        const candidates = Object.keys(workspaceIndex).map(normalizeCwd);
        const byExactName = candidates.find(cwd => cwdBaseName(cwd) === project.name.toLowerCase());
        if (byExactName) {
            return byExactName;
        }
        if (project.github) {
            const repoPath = `${project.github.owner}/${project.github.name}`.toLowerCase();
            const byGithubPath = candidates.find(cwd => {
                const normalized = cwd.toLowerCase();
                return normalized.endsWith(`/${repoPath}`)
                    || normalized.endsWith(`/repos/${repoPath}`)
                    || cwdBaseName(normalized) === project.github!.name.toLowerCase();
            });
            if (byGithubPath) {
                return byGithubPath;
            }
        }
        return fromUri;
    }

    async getTheiaConversation(id: string): Promise<QaapAgentConversationDTO | undefined> {
        const file = this.theiaSessionFiles.get(id);
        if (!file) {
            return undefined;
        }
        const data = await this.readJson<TheiaSerializedChatData>(file);
        if (!data) {
            return undefined;
        }
        const summary = this.findTheiaSummary(id);
        const cwd = summary?.cwd ?? '';
        return {
            id,
            cwd,
            agentId: data.pinnedAgentId ?? 'chat',
            title: data.title ?? summary?.title ?? 'Chat',
            status: 'idle',
            createdAt: data.saveDate,
            updatedAt: data.saveDate,
            messages: theiaMessagesToConversationMessages(data),
        };
    }

    async getTheiaSerializedConversation(id: string): Promise<unknown | undefined> {
        const file = this.theiaSessionFiles.get(id);
        return file ? this.readJson<unknown>(file) : undefined;
    }

    async findTheiaSerializedConversationBySessionId(sessionId: string, cwd?: string): Promise<unknown | undefined> {
        const normalizedCwd = cwd ? normalizeCwd(cwd) : undefined;
        for (const [id, file] of this.theiaSessionFiles) {
            const summary = this.findTheiaSummary(id);
            if (summary?.sessionId !== sessionId) {
                continue;
            }
            if (normalizedCwd && summary.cwd && normalizeCwd(summary.cwd) !== normalizedCwd) {
                continue;
            }
            return this.readJson<unknown>(file);
        }
        return undefined;
    }

    /** Optimistic update after a synchronous POST returns, before SSE catches up. */
    recordSnapshot(conv: QaapAgentConversationSummaryDTO): void {
        const result = this.upsert(conv);
        this.emitConversationChange({
            kind: 'updated',
            conversationId: conv.id,
            cwd: conv.cwd,
            changedFields: result.changedFields,
            listOrderChanged: result.listOrderChanged,
        });
    }

    /**
     * Cache a full conversation document for transcript/context surfaces.
     * Emits `document_loaded` once per conversation id (not on every SSE tick).
     */
    cacheDocument(document: QaapAgentConversationDTO): boolean {
        const normalized = backfillConversationTraceEvents(document).conversation;
        const isFirstLoad = !this.threadStore.getDocument(normalized.id);
        this.threadStore.setDocument(normalized);
        if (isFirstLoad) {
            this.emitConversationChange({
                kind: 'document_loaded',
                conversationId: normalized.id,
                cwd: normalized.cwd,
            });
        }
        return isFirstLoad;
    }

    /** Warm the full document in threadStore (deduped, best-effort). */
    prefetchDocument(conversationId: string): void {
        if (!conversationId || conversationId.startsWith('pending-')) {
            return;
        }
        const cached = this.threadStore.getDocument(conversationId);
        if (cached && cached.messages.length > 0) {
            return;
        }
        if (this.documentPrefetchInFlight.has(conversationId)) {
            return;
        }
        this.documentPrefetchInFlight.add(conversationId);
        void getConversation(conversationId)
            .then(document => {
                this.cacheDocument(document);
            })
            .catch(() => undefined)
            .finally(() => {
                this.documentPrefetchInFlight.delete(conversationId);
            });
    }

    prefetchDocuments(conversationIds: readonly string[]): void {
        for (const conversationId of conversationIds) {
            this.prefetchDocument(conversationId);
        }
    }

    /** Latest summary row for a conversation id (VPS or Theia-backed). */
    findSummaryById(id: string): QaapAgentConversationSummaryDTO | undefined {
        const fromStore = this.threadStore.findSummaryById(id);
        if (fromStore) {
            return fromStore;
        }
        for (const list of this.theiaByCwd.values()) {
            const found = list.find(c => c.id === id || c.sessionId === id);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    /** All VPS conversation summaries (newest first per cwd bucket). */
    listAllSummaries(): QaapAgentConversationSummaryDTO[] {
        return this.threadStore.listAllSummaries();
    }

    /** Optimistic update after deleting a conversation before SSE/storage refresh catches up. */
    removeSnapshot(conversationId: string, cwd: string, source?: QaapAgentConversationSummaryDTO['source']): void {
        if (source === 'theia-chat') {
            const map = this.theiaByCwd;
            const normalized = normalizeCwd(cwd);
            const list = map.get(normalized);
            if (!list) {
                return;
            }
            const next = list.filter(c => c.id !== conversationId && c.sessionId !== conversationId);
            if (next.length === 0) {
                map.delete(normalized);
            } else {
                map.set(normalized, next);
            }
            this.emitConversationChange({ kind: 'deleted', conversationId, cwd });
            return;
        }
        this.threadStore.removeSummary(conversationId, cwd);
        this.emitConversationChange({ kind: 'deleted', conversationId, cwd });
    }

    protected async primeFromAll(): Promise<void> {
        try {
            const groups = await listAllConversationGroups();
            this.applyConversationGroups(groups);
        } catch {
            /* live feed will reconcile */
        }
    }

    protected applyConversationGroups(
        groups: ReadonlyArray<{ readonly cwd: string; readonly conversations: ReadonlyArray<QaapAgentConversationSummaryDTO> }>,
    ): void {
        this.threadStore.applySummarySnapshot(groups);
        this.emitConversationChange({ kind: 'snapshot' });
    }

    protected emitConversationChange(event: QaapConversationChangeEvent): void {
        this.lastConversationChange = event;
        this.onDidChangeDetailEmitter.fire(event);
        this.onDidChangeEmitter.fire();
    }

    /** Latest typed change paired with the preceding `onDidChange` tick. */
    peekLastConversationChange(): QaapConversationChangeEvent | undefined {
        return this.lastConversationChange;
    }

    protected lastConversationChange: QaapConversationChangeEvent | undefined;

    protected async cancelConversationLive(id: string): Promise<void> {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ op: 'cancel', conversationId: id }));
            const existing = this.findSummaryById(id);
            if (existing?.status === 'streaming') {
                this.recordSnapshot({ ...existing, status: 'idle', updatedAt: Date.now() });
            }
            return;
        }
        await cancelConversationHttp(id);
    }

    protected openWebSocket(): void {
        if (typeof WebSocket === 'undefined') {
            this.openSseStream();
            void this.primeFromAll();
            return;
        }
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        try {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const socket = new WebSocket(`${proto}//${window.location.host}${QAAP_AGENT_CONVERSATION_WS_PATH}`);
            this.socket = socket;

            socket.addEventListener('open', () => {
                this.wsReconnectAttempt = 0;
                this.transport = 'ws';
                this.closeSse();
                if (this.transportWasDisconnected) {
                    this.transportWasDisconnected = false;
                    this.onDidReconnectTransportEmitter.fire();
                }
                this.markStreamingTransports('ws');
                this.schedulePrimeFromAll();
            });

            socket.addEventListener('message', ev => {
                try {
                    this.dispatchServerPayload(JSON.parse(String(ev.data)) as ConversationServerEvent);
                } catch {
                    /* drop malformed payload */
                }
            });

            socket.addEventListener('close', () => {
                this.socket = undefined;
                this.transportWasDisconnected = true;
                if (this.transport === 'ws') {
                    this.transport = 'none';
                }
                this.openSseStream();
                this.scheduleWebSocketReconnect();
            });

            socket.addEventListener('error', () => socket.close());
        } catch {
            this.openSseStream();
            void this.primeFromAll();
        }
    }

    protected openSseStream(): void {
        if (this.transport === 'ws' || typeof EventSource === 'undefined' || this.source) {
            return;
        }
        try {
            const source = new EventSource(STREAM_URL);
            this.source = source;
            this.transport = 'sse';
            this.markStreamingTransports('sse');
            source.addEventListener('created', ev => this.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('updated', ev => this.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('message', ev => this.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('message_delta', ev => this.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('deleted', ev => this.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('parallel-run', ev => this.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('open', () => {
                if (this.transportWasDisconnected) {
                    this.transportWasDisconnected = false;
                    this.onDidReconnectTransportEmitter.fire();
                }
                this.schedulePrimeFromAll();
            });
            source.addEventListener('error', () => {
                this.transportWasDisconnected = true;
                this.scheduleSseReconnect();
            });
        } catch {
            this.scheduleSseReconnect();
        }
    }

    protected dispatchSseEvent(ev: MessageEvent): void {
        try {
            this.dispatchServerPayload(JSON.parse(ev.data) as ConversationServerEvent);
        } catch {
            /* drop malformed payload */
        }
    }

    protected dispatchServerPayload(payload: ConversationServerEvent): void {
        switch (payload.type) {
            case 'snapshot':
                this.applyConversationGroups(payload.groups);
                return;
            case 'created':
            case 'updated': {
                const result = this.upsert(payload.conversation);
                this.recordClientStreamMetrics(payload);
                this.emitConversationChange({
                    kind: payload.type,
                    conversationId: payload.conversation.id,
                    cwd: payload.conversation.cwd,
                    changedFields: result.changedFields,
                    listOrderChanged: result.listOrderChanged,
                });
                return;
            }
            case 'message':
                void this.dispatchLiveMessage(payload);
                return;
            case 'message_delta':
                void this.dispatchLiveMessageDelta(payload);
                return;
            case 'deleted': {
                const cwd = normalizeCwd(payload.cwd);
                this.threadStore.removeSummary(payload.conversationId, cwd);
                this.emitConversationChange({
                    kind: 'deleted',
                    conversationId: payload.conversationId,
                    cwd: payload.cwd,
                });
                return;
            }
            case 'parallel-run':
                this.onDidReceiveParallelRunEmitter.fire(payload);
                return;
            case 'pong':
                return;
            default:
                return;
        }
    }

    protected scheduleWebSocketReconnect(): void {
        if (this.wsReconnectHandle !== undefined || typeof WebSocket === 'undefined') {
            return;
        }
        const delay = Math.min(WS_RECONNECT_MAX_MS, 1_000 * (2 ** this.wsReconnectAttempt));
        this.wsReconnectAttempt++;
        this.wsReconnectHandle = window.setTimeout(() => {
            this.wsReconnectHandle = undefined;
            this.openWebSocket();
        }, delay);
    }

    protected scheduleSseReconnect(): void {
        if (this.sseReconnectHandle !== undefined || this.transport === 'ws') {
            return;
        }
        this.closeSse();
        this.sseReconnectHandle = window.setTimeout(() => {
            this.sseReconnectHandle = undefined;
            this.openSseStream();
            void this.primeFromAll();
        }, SSE_RECONNECT_DELAY_MS);
    }

    protected closeWebSocket(): void {
        this.socket?.close();
        this.socket = undefined;
        if (this.transport === 'ws') {
            this.transport = 'none';
        }
    }

    protected closeSse(): void {
        this.source?.close();
        this.source = undefined;
        if (this.transport === 'sse') {
            this.transport = 'none';
        }
    }

    protected clearReconnectTimers(): void {
        if (this.sseReconnectHandle !== undefined) {
            window.clearTimeout(this.sseReconnectHandle);
            this.sseReconnectHandle = undefined;
        }
        if (this.wsReconnectHandle !== undefined) {
            window.clearTimeout(this.wsReconnectHandle);
            this.wsReconnectHandle = undefined;
        }
    }

    protected async dispatchLiveMessage(payload: ConversationMessageEvent): Promise<void> {
        try {
            const message = await expandAgentMessageForWire(payload.message);
            const expanded: ConversationMessageEvent = message === payload.message
                ? payload
                : { ...payload, message };
            this.recordClientStreamMetrics(payload, expanded);
            this.onDidReceiveMessageEmitter.fire(expanded);
            this.refreshSummaryFromLiveMessage(expanded);
        } catch {
            /* drop payloads the browser cannot decompress */
        }
    }

    protected async dispatchLiveMessageDelta(payload: ConversationMessageDeltaEvent): Promise<void> {
        try {
            const delta = await expandAgentMessageWireDelta(payload.delta);
            const expanded: ConversationMessageDeltaEvent = delta === payload.delta
                ? payload
                : { ...payload, delta };
            this.recordClientStreamMetrics(payload, expanded);
            this.onDidReceiveMessageEmitter.fire(expanded);
            this.refreshSummaryFromLiveDelta(expanded);
        } catch {
            /* drop payloads the browser cannot decompress */
        }
    }

    protected recordClientStreamMetrics(
        wirePayload: ConversationServerEvent,
        expandedPayload?: ConversationServerEvent,
    ): void {
        if (wirePayload.type !== 'message'
            && wirePayload.type !== 'message_delta'
            && wirePayload.type !== 'updated') {
            return;
        }
        const conversationId = wirePayload.type === 'updated'
            ? wirePayload.conversation.id
            : wirePayload.type === 'message' || wirePayload.type === 'message_delta'
                ? wirePayload.conversationId
                : undefined;
        if (!conversationId) {
            return;
        }
        if (wirePayload.type === 'updated' && wirePayload.conversation.status === 'streaming') {
            this.streamMetrics.setTransport(conversationId, this.transport === 'ws' ? 'ws' : 'sse');
        }
        this.streamMetrics.recordWireEvent(conversationId, wirePayload.type, wirePayload, {
            uncompressedPayload: expandedPayload,
            compressedFieldCount: countCompressedWireFields(wirePayload),
        });
        if (wirePayload.type === 'updated' && wirePayload.conversation.status !== 'streaming') {
            logQaapStreamMetrics(this.streamMetrics.finishTurn(conversationId));
        }
    }

    protected refreshSummaryFromLiveMessage(payload: ConversationMessageEvent): void {
        // Keep cached documents fresh for non-active conversations so the
        // transcript hydrates instantly when the user switches back.
        this.threadStore.appendLiveMessage(payload.conversationId, payload.message);
        const existing = this.threadStore.findSummaryById(payload.conversationId);
        if (!existing) {
            this.emitConversationChange({
                kind: 'message',
                conversationId: payload.conversationId,
                cwd: payload.cwd,
            });
            return;
        }
        const updated: QaapAgentConversationSummaryDTO = {
            ...existing,
            updatedAt: Math.max(existing.updatedAt, payload.message.createdAt),
            messageCount: payload.message.role === existing.lastMessageRole
                ? existing.messageCount
                : existing.messageCount + 1,
            lastMessagePreview: excerpt(resolveMessagePreviewText(payload.message)),
            lastMessageRole: payload.message.role,
        };
        const result = this.upsert(updated);
        this.emitConversationChange({
            kind: 'message',
            conversationId: payload.conversationId,
            cwd: payload.cwd,
            changedFields: result.changedFields,
            listOrderChanged: result.listOrderChanged,
        });
    }

    protected refreshSummaryFromLiveDelta(payload: ConversationMessageDeltaEvent): void {
        const existing = this.threadStore.findSummaryById(payload.conversationId);
        if (!existing) {
            this.emitConversationChange({
                kind: 'message_delta',
                conversationId: payload.conversationId,
                cwd: payload.cwd,
            });
            return;
        }
        this.threadStore.applyWireDelta(payload.conversationId, payload.messageId, payload.delta);
        const previewDelta = this.resolvePreviewDelta(payload.delta);
        const updated: QaapAgentConversationSummaryDTO = {
            ...existing,
            updatedAt: Date.now(),
            ...(previewDelta
                ? { lastMessagePreview: excerpt(`${existing.lastMessagePreview ?? ''}${previewDelta}`) }
                : {}),
        };
        const result = this.upsert(updated);
        this.emitConversationChange({
            kind: 'message_delta',
            conversationId: payload.conversationId,
            cwd: payload.cwd,
            changedFields: result.changedFields,
            listOrderChanged: result.listOrderChanged,
        });
    }

    protected resolvePreviewDelta(delta: QaapAgentMessageWireDelta): string | undefined {
        switch (delta.kind) {
            case 'append_content':
            case 'append_segment_text':
                return delta.text;
            case 'message_start':
            case 'replace':
                return resolveMessagePreviewText(delta.message);
            case 'patch_tool':
            case 'append_segment':
            case 'append_trace_event':
            case 'patch_trace_event':
            case 'noop':
                return undefined;
            default: {
                const exhaustive: never = delta;
                return exhaustive;
            }
        }
    }

    protected upsert(conv: QaapAgentConversationSummaryDTO): QaapThreadStoreUpsertResult {
        return this.threadStore.upsertSummary(conv);
    }

    protected markStreamingTransports(transport: 'ws' | 'sse'): void {
        for (const conversation of this.threadStore.listStreamingSummaries()) {
            this.streamMetrics.setTransport(conversation.id, transport);
        }
    }

    protected getAllConversationBuckets(): Array<[string, QaapAgentConversationSummaryDTO[]]> {
        const buckets = new Map<string, QaapAgentConversationSummaryDTO[]>();
        for (const [cwd, list] of this.theiaByCwd) {
            buckets.set(cwd, [...list]);
        }
        for (const summary of this.threadStore.listAllSummaries()) {
            const cwd = normalizeCwd(summary.cwd);
            const merged = [...(buckets.get(cwd) ?? []), summary];
            buckets.set(cwd, sortConversations(merged));
        }
        return [...buckets];
    }

    protected findTheiaSummary(id: string): QaapAgentConversationSummaryDTO | undefined {
        for (const list of this.theiaByCwd.values()) {
            const found = list.find(c => c.id === id);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    protected async readJson<T>(uri: URI): Promise<T | undefined> {
        try {
            const content = await this.fileService.readFile(uri);
            return JSON.parse(bufferToString(content.value)) as T;
        } catch {
            return undefined;
        }
    }
}

function sortConversations(list: QaapAgentConversationSummaryDTO[]): QaapAgentConversationSummaryDTO[] {
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

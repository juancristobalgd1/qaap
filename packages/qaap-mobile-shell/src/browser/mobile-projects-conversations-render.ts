// @ts-nocheck
// Extracted from mobile-projects-conversations.ts

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
import { sortConversations } from './mobile-projects-conversations';
import { PRIME_FROM_ALL_TTL_MS, STREAM_URL } from './mobile-projects-conversations';

export function recordSubmitLatencyMarkExtracted(ctx: any, conversationId: string | undefined, mark: QaapTurnLatencyMark, at?: number): void {
        ctx.streamMetrics.recordLatencyMark(conversationId, mark, at);
        if (!conversationId) {
            return;
        }
        const marks = ctx.submitLatencyMarks.get(conversationId) ?? {};
        if (marks[mark] === undefined) {
            marks[mark] = at ?? Date.now();
            ctx.submitLatencyMarks.set(conversationId, marks);
        }
}

export function getSubmitLatencyMarksExtracted(ctx: any, conversationId: string | undefined): Partial<Record<QaapTurnLatencyMark, number>> | undefined {
        if (!conversationId) {
            return undefined;
        }
        const marks = ctx.submitLatencyMarks.get(conversationId);
        return marks ? { ...marks } : undefined;
}

export function startExtracted(ctx: any): void {
        if (ctx.started) {
            return;
        }
        ctx.started = true;
        ctx.liveCancelDispose = registerConversationLiveCancel(id => ctx.cancelConversationLive(id));
        ctx.openWebSocket();
        ctx.installVisibilityReconnect();
}

export function perfProbeSeedSummariesExtracted(ctx: any, cwd: string, summaries: readonly QaapAgentConversationSummaryDTO[]): void {
        if (!isQaapWorkHubPerfProbeEnabled()) {
            return;
        }
        ctx.perfProbeByCwd.set(normalizeCwd(cwd), sortConversations([...summaries]));
}

export function perfProbeTickStreamingSummariesExtracted(ctx: any, cwd: string): void {
        if (!isQaapWorkHubPerfProbeEnabled()) {
            return;
        }
        const key = normalizeCwd(cwd);
        const list = ctx.perfProbeByCwd.get(key) ?? [];
        const next = list.map(summary => summary.status === 'streaming'
            ? {
                ...summary,
                turnProgressCurrent: (summary.turnProgressCurrent ?? 0) + 1,
                updatedAt: summary.updatedAt + 1,
            }
            : summary);
        ctx.perfProbeByCwd.set(key, sortConversations(next));
        ctx.emitConversationChange({ kind: 'updated' });
}

export function schedulePrimeFromAllExtracted(ctx: any): void {
        // Collapse redundant primes (boot warms + SSE/WS open listeners fire together); live
        // events reconcile anything that changes inside the window.
        if (Date.now() - ctx.lastPrimeFromAllAt < PRIME_FROM_ALL_TTL_MS) {
            return;
        }
        if (!ctx.primeFromAllInFlight) {
            ctx.lastPrimeFromAllAt = Date.now();
            ctx.primeFromAllInFlight = ctx.primeFromAll().finally(() => {
                ctx.primeFromAllInFlight = undefined;
            });
        }
}

export function installVisibilityReconnectExtracted(ctx: any): void {
        if (ctx.visibilityListenerInstalled || typeof document === 'undefined' || typeof window === 'undefined') {
            return;
        }
        ctx.visibilityListenerInstalled = true;
        const reconnect = (): void => {
            if (document.visibilityState !== 'visible') {
                return;
            }
            ctx.closeWebSocket();
            ctx.closeSse();
            ctx.clearReconnectTimers();
            ctx.openWebSocket();
        };
        document.addEventListener('visibilitychange', reconnect);
        window.addEventListener('pageshow', reconnect);
}

export function getConversationsForCwdExtracted(ctx: any, cwd: string): QaapAgentConversationSummaryDTO[] {
        const probe = isQaapWorkHubPerfProbeEnabled()
            ? lookupByCwd(ctx.perfProbeByCwd, cwd) ?? []
            : [];
        return ctx.mergeCwdConversationLists(
            lookupByCwd(ctx.theiaByCwd, cwd) ?? [],
            ctx.threadStore.getSummariesForCwd(cwd),
            probe,
        );
}

export function mergeCwdConversationListsExtracted(ctx: any, ...lists: ReadonlyArray<readonly QaapAgentConversationSummaryDTO[]>): QaapAgentConversationSummaryDTO[] {
        const byId = new Map<string, QaapAgentConversationSummaryDTO>();
        for (const list of lists) {
            for (const summary of list) {
                byId.set(summary.id, summary);
            }
        }
        return sortConversations([...byId.values()]);
}

export function findConversationsForProjectExtracted(ctx: any, project: {
        readonly name: string;
        readonly github?: { readonly owner: string; readonly name: string };
    }): QaapAgentConversationSummaryDTO[] {
        const merged = ctx.threadStore.listAllSummaries().filter(summary => cwdMatchesProject(summary.cwd, project));
        return sortConversations(merged);
}

export async function refreshTheiaChatSessionsForProjectsExtracted(ctx: any, _projects: ReadonlyArray<{
        readonly name: string;
        readonly uri?: URI;
        readonly github?: { readonly owner: string; readonly name: string };
        readonly isCurrent?: boolean;
    }>): Promise<void> {
        // Qaap product: Work Hub uses VPS QAIQ conversations only — do not merge Theia Coder sessions.
        ctx.theiaByCwd.clear();
        ctx.theiaSessionFiles.clear();
}

export function resolveWorkspaceMetadataCwdExtracted(ctx: any, project: { readonly name: string; readonly uri?: URI; readonly github?: { readonly owner: string; readonly name: string } },
        workspaceIndex: Record<string, string>,): string | undefined {
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

export async function getTheiaConversationExtracted(ctx: any, id: string): Promise<QaapAgentConversationDTO | undefined> {
        const file = ctx.theiaSessionFiles.get(id);
        if (!file) {
            return undefined;
        }
        const data = await ctx.readJson<TheiaSerializedChatData>(file);
        if (!data) {
            return undefined;
        }
        const summary = ctx.findTheiaSummary(id);
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

export async function findTheiaSerializedConversationBySessionIdExtracted(ctx: any, sessionId: string, cwd?: string): Promise<unknown | undefined> {
        const normalizedCwd = cwd ? normalizeCwd(cwd) : undefined;
        for (const [id, file] of ctx.theiaSessionFiles) {
            const summary = ctx.findTheiaSummary(id);
            if (summary?.sessionId !== sessionId) {
                continue;
            }
            if (normalizedCwd && summary.cwd && normalizeCwd(summary.cwd) !== normalizedCwd) {
                continue;
            }
            return ctx.readJson<unknown>(file);
        }
        return undefined;
}

export function recordSnapshotExtracted(ctx: any, conv: QaapAgentConversationSummaryDTO): void {
        const result = ctx.upsert(conv);
        ctx.emitConversationChange({
            kind: 'updated',
            conversationId: conv.id,
            cwd: conv.cwd,
            changedFields: result.changedFields,
            listOrderChanged: result.listOrderChanged,
        });
}

export function cacheDocumentExtracted(ctx: any, document: QaapAgentConversationDTO): boolean {
        const normalized = backfillConversationTraceEvents(document).conversation;
        const isFirstLoad = !ctx.threadStore.getDocument(normalized.id);
        ctx.threadStore.setDocument(normalized);
        if (isFirstLoad) {
            ctx.emitConversationChange({
                kind: 'document_loaded',
                conversationId: normalized.id,
                cwd: normalized.cwd,
            });
        }
        return isFirstLoad;
}

export function prefetchDocumentExtracted(ctx: any, conversationId: string): void {
        if (!conversationId || conversationId.startsWith('pending-') || conversationId === QAAP_AGENTS_HUB_IDLE_CONVERSATION_ID) {
            return;
        }
        const cached = ctx.threadStore.getDocument(conversationId);
        const summary = ctx.findSummaryById?.(conversationId) ?? ctx.threadStore.findSummaryById?.(conversationId);
        const expected = summary?.messageCount;
        const cacheLooksComplete = !!cached
            && cached.messages.length > 0
            && !(typeof expected === 'number' && expected > 0 && cached.messages.length < expected)
            && !cached.messages.some((message: { id?: string }) => message.id?.endsWith(':summary-preview'));
        if (cacheLooksComplete) {
            return;
        }
        if (ctx.documentPrefetchInFlight.has(conversationId)) {
            return;
        }
        ctx.documentPrefetchInFlight.add(conversationId);
        void getConversation(conversationId)
            .then(document => {
                ctx.cacheDocument(document);
            })
            .catch(() => undefined)
            .finally(() => {
                ctx.documentPrefetchInFlight.delete(conversationId);
            });
}

export function prefetchDocumentsExtracted(ctx: any, conversationIds: readonly string[]): void {
        for (const conversationId of conversationIds) {
            ctx.prefetchDocument(conversationId);
        }
}

export function findSummaryByIdExtracted(ctx: any, id: string): QaapAgentConversationSummaryDTO | undefined {
        const fromStore = ctx.threadStore.findSummaryById(id);
        if (fromStore) {
            return fromStore;
        }
        for (const list of ctx.theiaByCwd.values()) {
            const found = list.find(c => c.id === id || c.sessionId === id);
            if (found) {
                return found;
            }
        }
        return undefined;
}

export function removeSnapshotExtracted(ctx: any, conversationId: string, cwd: string, source?: QaapAgentConversationSummaryDTO['source']): void {
        ctx.deletedConversationIds.add(conversationId);
        if (source === 'theia-chat') {
            const map = ctx.theiaByCwd;
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
            ctx.emitConversationChange({ kind: 'deleted', conversationId, cwd });
            return;
        }
        ctx.threadStore.removeSummary(conversationId, cwd);
        ctx.emitConversationChange({ kind: 'deleted', conversationId, cwd });
}

export async function primeFromAllExtracted(ctx: any): Promise<void> {
        try {
            const groups = await listAllConversationGroups();
            ctx.applyConversationGroups(groups);
        } catch {
            if (ctx.snapshotState !== 'ready') {
                ctx.snapshotState = 'error';
                ctx.emitConversationChange({ kind: 'snapshot' });
            }
        }
}

export function applyConversationGroupsExtracted(ctx: any, groups: ReadonlyArray<{ readonly cwd: string; readonly conversations: ReadonlyArray<QaapAgentConversationSummaryDTO> }>,): void {
        ctx.snapshotState = 'ready';
        ctx.threadStore.applySummarySnapshot(groups.map(group => ({
            ...group,
            conversations: group.conversations.filter(conversation => !ctx.deletedConversationIds.has(conversation.id)),
        })));
        ctx.emitConversationChange({ kind: 'snapshot' });
}

export function emitConversationChangeExtracted(ctx: any, event: QaapConversationChangeEvent): void {
        ctx.lastConversationChange = event;
        ctx.onDidChangeDetailEmitter.fire(event);
        ctx.onDidChangeEmitter.fire();
}

export async function cancelConversationLiveExtracted(ctx: any, id: string): Promise<void> {
        if (ctx.socket?.readyState === WebSocket.OPEN) {
            ctx.socket.send(JSON.stringify({ op: 'cancel', conversationId: id }));
            const existing = ctx.findSummaryById(id);
            if (existing?.status === 'streaming') {
                ctx.recordSnapshot({ ...existing, status: 'idle', updatedAt: Date.now() });
            }
            return;
        }
        await cancelConversationHttp(id);
}

export function openWebSocketExtracted(ctx: any): void {
        if (typeof WebSocket === 'undefined') {
            ctx.openSseStream();
            void ctx.primeFromAll();
            return;
        }
        if (ctx.socket && (ctx.socket.readyState === WebSocket.OPEN || ctx.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        try {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const socket = new WebSocket(`${proto}//${window.location.host}${QAAP_AGENT_CONVERSATION_WS_PATH}`);
            ctx.socket = socket;

            socket.addEventListener('open', () => {
                ctx.wsReconnectAttempt = 0;
                ctx.transport = 'ws';
                ctx.closeSse();
                if (ctx.transportWasDisconnected) {
                    ctx.transportWasDisconnected = false;
                    ctx.onDidReconnectTransportEmitter.fire();
                }
                ctx.markStreamingTransports('ws');
                // The server primes an equivalent `snapshot` on connect — only fall back to the
                // HTTP /all prime if that snapshot never arrives (saves ~340KB per (re)connect).
                ctx.wsSnapshotFallbackHandle = window.setTimeout(() => {
                    ctx.wsSnapshotFallbackHandle = undefined;
                    ctx.schedulePrimeFromAll();
                }, 4000);
            });

            socket.addEventListener('message', ev => {
                try {
                    ctx.dispatchServerPayload(JSON.parse(String(ev.data)) as ConversationServerEvent);
                } catch {
                    /* drop malformed payload */
                }
            });

            socket.addEventListener('close', () => {
                ctx.socket = undefined;
                if (ctx.wsSnapshotFallbackHandle !== undefined) {
                    window.clearTimeout(ctx.wsSnapshotFallbackHandle);
                    ctx.wsSnapshotFallbackHandle = undefined;
                }
                ctx.transportWasDisconnected = true;
                if (ctx.transport === 'ws') {
                    ctx.transport = 'none';
                }
                ctx.openSseStream();
                ctx.scheduleWebSocketReconnect();
            });

            socket.addEventListener('error', () => socket.close());
        } catch {
            ctx.openSseStream();
            void ctx.primeFromAll();
        }
}

export function openSseStreamExtracted(ctx: any): void {
        if (ctx.transport === 'ws' || typeof EventSource === 'undefined' || ctx.source) {
            return;
        }
        try {
            const source = new EventSource(STREAM_URL);
            ctx.source = source;
            ctx.transport = 'sse';
            ctx.markStreamingTransports('sse');
            source.addEventListener('created', ev => ctx.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('updated', ev => ctx.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('message', ev => ctx.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('message_delta', ev => ctx.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('deleted', ev => ctx.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('parallel-run', ev => ctx.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('pending-queued', ev => ctx.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('pending-drained', ev => ctx.dispatchSseEvent(ev as MessageEvent));
            source.addEventListener('heartbeat', () => ctx.onDidReceiveTransportActivityEmitter.fire());
            source.addEventListener('open', () => {
                if (ctx.transportWasDisconnected) {
                    ctx.transportWasDisconnected = false;
                    ctx.onDidReconnectTransportEmitter.fire();
                }
                ctx.schedulePrimeFromAll();
            });
            source.addEventListener('error', () => {
                ctx.transportWasDisconnected = true;
                ctx.scheduleSseReconnect();
            });
        } catch {
            ctx.scheduleSseReconnect();
        }
}

export function dispatchSseEventExtracted(ctx: any, ev: MessageEvent): void {
        try {
            ctx.dispatchServerPayload(JSON.parse(ev.data) as ConversationServerEvent);
        } catch {
            /* drop malformed payload */
        }
}


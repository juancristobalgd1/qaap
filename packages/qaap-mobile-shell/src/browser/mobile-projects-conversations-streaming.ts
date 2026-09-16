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
import { SSE_RECONNECT_DELAY_MS, WS_RECONNECT_MAX_MS } from './mobile-projects-conversations';

export function dispatchServerPayloadExtracted(ctx: any, payload: ConversationServerEvent): void {
        switch (payload.type) {
            case 'snapshot':
                if (ctx.wsSnapshotFallbackHandle !== undefined) {
                    window.clearTimeout(ctx.wsSnapshotFallbackHandle);
                    ctx.wsSnapshotFallbackHandle = undefined;
                }
                ctx.applyConversationGroups(payload.groups);
                return;
            case 'created':
            case 'updated': {
                if (ctx.deletedConversationIds.has(payload.conversation.id)) {
                    return;
                }
                const result = ctx.upsert(payload.conversation);
                ctx.recordClientStreamMetrics(payload);
                ctx.emitConversationChange({
                    kind: payload.type,
                    conversationId: payload.conversation.id,
                    cwd: payload.conversation.cwd,
                    changedFields: result.changedFields,
                    listOrderChanged: result.listOrderChanged,
                });
                return;
            }
            case 'message':
                void ctx.dispatchLiveMessage(payload);
                return;
            case 'message_delta':
                void ctx.dispatchLiveMessageDelta(payload);
                return;
            case 'deleted': {
                const cwd = normalizeCwd(payload.cwd);
                ctx.deletedConversationIds.add(payload.conversationId);
                ctx.threadStore.removeSummary(payload.conversationId, cwd);
                ctx.emitConversationChange({
                    kind: 'deleted',
                    conversationId: payload.conversationId,
                    cwd: payload.cwd,
                });
                return;
            }
            case 'parallel-run':
                ctx.onDidReceiveParallelRunEmitter.fire(payload);
                return;
            case 'pending-queued':
            case 'pending-drained':
                // Same-session queue mutations: refresh list badges + open transcript footers.
                ctx.onDidReceivePendingQueueEmitter.fire(payload);
                ctx.emitConversationChange({
                    kind: 'updated',
                    conversationId: payload.conversationId,
                    cwd: payload.cwd,
                });
                return;
            case 'pong':
            case 'heartbeat':
                // Transport-liveness frames carry no conversation payload — they only prove the
                // socket is alive so the transcript can avoid a false "connection dropped" timeout.
                ctx.onDidReceiveTransportActivityEmitter.fire();
                return;
            default:
                return;
        }
}

export function scheduleWebSocketReconnectExtracted(ctx: any): void {
        if (ctx.wsReconnectHandle !== undefined || typeof WebSocket === 'undefined') {
            return;
        }
        const delay = Math.min(WS_RECONNECT_MAX_MS, 1_000 * (2 ** ctx.wsReconnectAttempt));
        ctx.wsReconnectAttempt++;
        ctx.wsReconnectHandle = window.setTimeout(() => {
            ctx.wsReconnectHandle = undefined;
            ctx.openWebSocket();
        }, delay);
}

export function scheduleSseReconnectExtracted(ctx: any): void {
        if (ctx.sseReconnectHandle !== undefined || ctx.transport === 'ws') {
            return;
        }
        ctx.closeSse();
        ctx.sseReconnectHandle = window.setTimeout(() => {
            ctx.sseReconnectHandle = undefined;
            ctx.openSseStream();
            void ctx.primeFromAll();
        }, SSE_RECONNECT_DELAY_MS);
}

export function closeWebSocketExtracted(ctx: any): void {
        ctx.socket?.close();
        ctx.socket = undefined;
        if (ctx.transport === 'ws') {
            ctx.transport = 'none';
        }
}

export function closeSseExtracted(ctx: any): void {
        ctx.source?.close();
        ctx.source = undefined;
        if (ctx.transport === 'sse') {
            ctx.transport = 'none';
        }
}

export function clearReconnectTimersExtracted(ctx: any): void {
        if (ctx.sseReconnectHandle !== undefined) {
            window.clearTimeout(ctx.sseReconnectHandle);
            ctx.sseReconnectHandle = undefined;
        }
        if (ctx.wsReconnectHandle !== undefined) {
            window.clearTimeout(ctx.wsReconnectHandle);
            ctx.wsReconnectHandle = undefined;
        }
}

export async function dispatchLiveMessageExtracted(ctx: any, payload: ConversationMessageEvent): Promise<void> {
        try {
            const message = await expandAgentMessageForWire(payload.message);
            const expanded: ConversationMessageEvent = message === payload.message
                ? payload
                : { ...payload, message };
            ctx.recordClientStreamMetrics(payload, expanded);
            ctx.onDidReceiveMessageEmitter.fire(expanded);
            ctx.refreshSummaryFromLiveMessage(expanded);
        } catch {
            /* drop payloads the browser cannot decompress */
        }
}

export async function dispatchLiveMessageDeltaExtracted(ctx: any, payload: ConversationMessageDeltaEvent): Promise<void> {
        try {
            const delta = await expandAgentMessageWireDelta(payload.delta);
            const expanded: ConversationMessageDeltaEvent = delta === payload.delta
                ? payload
                : { ...payload, delta };
            ctx.recordClientStreamMetrics(payload, expanded);
            ctx.onDidReceiveMessageEmitter.fire(expanded);
            ctx.refreshSummaryFromLiveDelta(expanded);
        } catch {
            /* drop payloads the browser cannot decompress */
        }
}

export function recordClientStreamMetricsExtracted(ctx: any, wirePayload: ConversationServerEvent,
        expandedPayload?: ConversationServerEvent,): void {
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
            ctx.streamMetrics.setTransport(conversationId, ctx.transport === 'ws' ? 'ws' : 'sse');
        }
        ctx.streamMetrics.recordWireEvent(conversationId, wirePayload.type, wirePayload, {
            uncompressedPayload: expandedPayload,
            compressedFieldCount: countCompressedWireFields(wirePayload),
        });
        if (wirePayload.type === 'updated' && wirePayload.conversation.status !== 'streaming') {
            logQaapStreamMetrics(ctx.streamMetrics.finishTurn(conversationId));
        }
}

export function refreshSummaryFromLiveMessageExtracted(ctx: any, payload: ConversationMessageEvent): void {
        // Keep cached documents fresh for non-active conversations so the
        // transcript hydrates instantly when the user switches back.
        ctx.threadStore.appendLiveMessage(payload.conversationId, payload.message);
        const existing = ctx.threadStore.findSummaryById(payload.conversationId);
        if (!existing) {
            ctx.emitConversationChange({
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
        const result = ctx.upsert(updated);
        ctx.emitConversationChange({
            kind: 'message',
            conversationId: payload.conversationId,
            cwd: payload.cwd,
            changedFields: result.changedFields,
            listOrderChanged: result.listOrderChanged,
        });
}

export function refreshSummaryFromLiveDeltaExtracted(ctx: any, payload: ConversationMessageDeltaEvent): void {
        const existing = ctx.threadStore.findSummaryById(payload.conversationId);
        if (!existing) {
            ctx.emitConversationChange({
                kind: 'message_delta',
                conversationId: payload.conversationId,
                cwd: payload.cwd,
            });
            return;
        }
        ctx.threadStore.applyWireDelta(payload.conversationId, payload.messageId, payload.delta);
        const previewDelta = ctx.resolvePreviewDelta(payload.delta);
        const updated: QaapAgentConversationSummaryDTO = {
            ...existing,
            updatedAt: Date.now(),
            ...(previewDelta
                ? { lastMessagePreview: excerpt(`${existing.lastMessagePreview ?? ''}${previewDelta}`) }
                : {}),
        };
        const result = ctx.upsert(updated);
        ctx.emitConversationChange({
            kind: 'message_delta',
            conversationId: payload.conversationId,
            cwd: payload.cwd,
            changedFields: result.changedFields,
            listOrderChanged: result.listOrderChanged,
        });
}

export function resolvePreviewDeltaExtracted(ctx: any, delta: QaapAgentMessageWireDelta): string | undefined {
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

export function markStreamingTransportsExtracted(ctx: any, transport: 'ws' | 'sse'): void {
        for (const conversation of ctx.threadStore.listStreamingSummaries()) {
            ctx.streamMetrics.setTransport(conversation.id, transport);
        }
}

export function getAllConversationBucketsExtracted(ctx: any): Array<[string, QaapAgentConversationSummaryDTO[]]> {
        const buckets = new Map<string, QaapAgentConversationSummaryDTO[]>();
        for (const [cwd, list] of ctx.theiaByCwd) {
            buckets.set(cwd, [...list]);
        }
        for (const summary of ctx.threadStore.listAllSummaries()) {
            const cwd = normalizeCwd(summary.cwd);
            const merged = [...(buckets.get(cwd) ?? []), summary];
            buckets.set(cwd, sortConversations(merged));
        }
        return [...buckets];
}

export function findTheiaSummaryExtracted(ctx: any, id: string): QaapAgentConversationSummaryDTO | undefined {
        for (const list of ctx.theiaByCwd.values()) {
            const found = list.find(c => c.id === id);
            if (found) {
                return found;
            }
        }
        return undefined;
}

export async function readJsonExtracted(ctx: any, uri: URI): Promise<T | undefined> {
        try {
            const content = await ctx.fileService.readFile(uri);
            return JSON.parse(bufferToString(content.value)) as T;
        } catch {
            return undefined;
        }
}


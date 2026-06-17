// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageDTO } from '../common/qaap-agent-conversation-client';
import { postAgUiTranscriptEvent } from '../common/qaap-agent-conversation-client';
import type { QaapAgentMessageWireDelta } from '../common/qaap-agent-message-wire-delta';
import {
    collectQaapFrontendToolNames,
    findPendingQaapFrontendToolCalls,
} from '../common/qaap-ag-ui-frontend-tool-pending';
import { buildQaapAgUiToolCallResultEvent } from '../common/qaap-ag-ui-tool-registry';
import type { ConversationLiveMessageEvent } from './mobile-projects-conversations';
import type { QaapAgUiFrontendToolService } from './qaap-ag-ui-frontend-tool-service';

/** Executes Qaap frontend AG-UI tools when the live transcript receives pending tool_call rows. */
export class QaapAgUiTranscriptLiveBridge {

    protected readonly inFlight = new Set<string>();
    protected readonly executed = new Set<string>();
    protected readonly argsByToolCall = new Map<string, string>();
    protected readonly scanTimers = new Map<string, number>();

    constructor(
        protected readonly resolveTools: () => QaapAgUiFrontendToolService | undefined,
    ) { }

    onLiveMessage(event: ConversationLiveMessageEvent): void {
        if (event.type !== 'message_delta') {
            return;
        }
        this.trackWireDelta(event.conversationId, event.delta);
    }

    afterMessageUpdated(conversationId: string, message: QaapAgentMessageDTO): void {
        const timerKey = `scan:${conversationId}`;
        const existing = this.scanTimers.get(timerKey);
        if (existing !== undefined) {
            window.clearTimeout(existing);
        }
        this.scanTimers.set(timerKey, window.setTimeout(() => {
            this.scanTimers.delete(timerKey);
            void this.scanAndExecutePendingTools(conversationId, message);
        }, 80));
    }

    clearConversation(conversationId: string): void {
        const prefix = `${conversationId}:`;
        for (const key of [...this.inFlight, ...this.executed]) {
            if (key.startsWith(prefix)) {
                this.inFlight.delete(key);
                this.executed.delete(key);
            }
        }
        for (const key of [...this.argsByToolCall.keys()]) {
            if (key.startsWith(prefix)) {
                this.argsByToolCall.delete(key);
            }
        }
        const timer = this.scanTimers.get(`scan:${conversationId}`);
        if (timer !== undefined) {
            window.clearTimeout(timer);
            this.scanTimers.delete(`scan:${conversationId}`);
        }
    }

    protected trackWireDelta(conversationId: string, delta: QaapAgentMessageWireDelta): void {
        if (delta.kind === 'patch_trace_event') {
            if (delta.argsAppend !== undefined) {
                const key = `${conversationId}:${delta.eventId}`;
                this.argsByToolCall.set(key, `${this.argsByToolCall.get(key) ?? ''}${delta.argsAppend}`);
            }
            return;
        }
        if (delta.kind === 'append_trace_event' && delta.event.type === 'tool_call') {
            const key = `${conversationId}:${delta.event.id}`;
            this.argsByToolCall.set(key, delta.event.args ?? '');
        }
    }

    protected async scanAndExecutePendingTools(
        conversationId: string,
        message: QaapAgentMessageDTO,
    ): Promise<void> {
        const tools = this.resolveTools();
        if (!tools || message.role !== 'agent') {
            return;
        }
        const frontendNames = collectQaapFrontendToolNames(tools.listFrontendToolDefinitions());
        const messageWithMergedArgs = this.mergeTrackedArgs(conversationId, message);
        const pending = findPendingQaapFrontendToolCalls(messageWithMergedArgs, frontendNames);
        for (const call of pending) {
            const flyKey = `${conversationId}:${call.toolCallId}`;
            if (this.executed.has(flyKey) || this.inFlight.has(flyKey)) {
                continue;
            }
            this.inFlight.add(flyKey);
            try {
                const result = await tools.executeFrontendToolCall(call.name, call.args);
                if (result === undefined) {
                    continue;
                }
                this.executed.add(flyKey);
                await postAgUiTranscriptEvent(
                    conversationId,
                    buildQaapAgUiToolCallResultEvent(call.toolCallId, result),
                );
            } catch {
                /* tool failure — agent may retry; do not mark executed */
            } finally {
                this.inFlight.delete(flyKey);
            }
        }
    }

    protected mergeTrackedArgs(conversationId: string, message: QaapAgentMessageDTO): QaapAgentMessageDTO {
        if (!message.traceEvents?.length && !message.segments?.length) {
            return message;
        }
        const traceEvents = message.traceEvents?.map(event => {
            if (event.type !== 'tool_call') {
                return event;
            }
            const tracked = this.argsByToolCall.get(`${conversationId}:${event.id}`);
            return tracked !== undefined ? { ...event, args: tracked } : event;
        });
        const segments = message.segments?.map(segment => {
            if (segment.type !== 'tool') {
                return segment;
            }
            const tracked = this.argsByToolCall.get(`${conversationId}:${segment.toolUseId}`);
            return tracked !== undefined ? { ...segment, args: tracked } : segment;
        });
        return {
            ...message,
            ...(traceEvents ? { traceEvents } : {}),
            ...(segments ? { segments } : {}),
        };
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgUiEvent } from './qaap-ag-ui-transcript-adapter';
import type { QaapCliAgUiStreamEmitter } from './qaap-cli-ag-ui-stream';
import { mergeIncrementalStreamText } from './qaap-qaiq-stream';

interface ContentBlock {
    readonly type?: string;
    readonly text?: string;
    readonly thinking?: string;
    readonly data?: string;
    readonly id?: string;
    readonly name?: string;
    readonly input?: Record<string, unknown>;
    readonly tool_use_id?: string;
    readonly content?: unknown;
    readonly is_error?: boolean;
}

interface StreamMessageEnvelope {
    readonly type?: string;
    readonly timestamp_ms?: number;
    readonly message?: {
        readonly content?: ContentBlock[] | string;
    };
    readonly event?: {
        readonly type?: string;
        readonly index?: number;
        readonly content_block?: ContentBlock;
        readonly delta?: {
            readonly type?: string;
            readonly text?: string;
            readonly thinking?: string;
            readonly partial_json?: string;
        };
    };
    readonly result?: string;
    readonly is_error?: boolean;
}

interface BlockState {
    readonly kind: 'text' | 'thinking' | 'tool';
    readonly messageId: string;
    readonly toolName?: string;
}

/**
 * Incrementally maps QAIQ / Claude Code stream-json NDJSON into native AG-UI events
 * for {@link applyAgUiTranscriptEvent} — no segment accumulator on the hot path.
 */
export class QaapQaiqAgUiStreamEmitter implements QaapCliAgUiStreamEmitter {

    protected buffer = '';
    protected sawTimestampedAssistant = false;
    protected liveTextId: string | undefined;
    protected liveThoughtId: string | undefined;
    protected liveText = '';
    protected liveThinking = '';
    protected readonly blockByIndex = new Map<number, BlockState>();
    protected readonly toolArgsById = new Map<string, string>();
    protected readonly startedTools = new Set<string>();
    protected readonly textContentById = new Map<string, string>();
    protected readonly thoughtContentById = new Map<string, string>();
    protected seq = 0;

    push(chunk: string): QaapAgUiEvent[] {
        if (!chunk) {
            return [];
        }
        const events: QaapAgUiEvent[] = [];
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
            events.push(...this.consumeLine(line.trim()));
        }
        return events;
    }

    protected consumeLine(line: string): QaapAgUiEvent[] {
        if (!line) {
            return [];
        }
        let envelope: StreamMessageEnvelope;
        try {
            envelope = JSON.parse(line) as StreamMessageEnvelope;
        } catch {
            return [];
        }
        const type = envelope.type;
        if (type === 'system') {
            return [];
        }
        if (type === 'stream_event') {
            return this.handleStreamEvent(envelope);
        }
        if (type === 'assistant') {
            return this.handleAssistantMessage(envelope);
        }
        if (type === 'user') {
            return this.handleUserMessage(envelope);
        }
        if (type === 'result' && envelope.is_error && typeof envelope.result === 'string' && envelope.result.trim()) {
            return [{ type: 'RUN_ERROR', message: envelope.result.trim() }];
        }
        return [];
    }

    protected handleStreamEvent(envelope: StreamMessageEnvelope): QaapAgUiEvent[] {
        const event = envelope.event;
        if (!event?.type) {
            return [];
        }
        if (event.type === 'content_block_start') {
            return this.handleContentBlockStart(event);
        }
        if (event.type === 'content_block_delta') {
            return this.handleContentBlockDelta(event);
        }
        if (event.type === 'content_block_stop') {
            return this.handleContentBlockStop(event);
        }
        return [];
    }

    protected handleContentBlockStart(event: NonNullable<StreamMessageEnvelope['event']>): QaapAgUiEvent[] {
        const block = event.content_block;
        if (!block?.type || event.index === undefined) {
            return [];
        }
        if (block.type === 'tool_use' && block.id && block.name) {
            const args = block.input && Object.keys(block.input).length > 0
                ? JSON.stringify(block.input)
                : '';
            this.blockByIndex.set(event.index, { kind: 'tool', messageId: block.id, toolName: block.name });
            this.toolArgsById.set(block.id, args);
            this.startedTools.add(block.id);
            const events: QaapAgUiEvent[] = [{
                type: 'TOOL_CALL_START',
                toolCallId: block.id,
                toolCallName: block.name,
            }];
            if (args) {
                events.push({
                    type: 'TOOL_CALL_ARGS',
                    toolCallId: block.id,
                    delta: args,
                });
            }
            return events;
        }
        if (block.type === 'thinking' || block.type === 'redacted_thinking') {
            const messageId = this.nextMessageId('thought');
            this.blockByIndex.set(event.index, { kind: 'thinking', messageId });
            this.liveThoughtId = messageId;
            this.liveThinking = '';
            this.thoughtContentById.set(messageId, '');
            return [{ type: 'REASONING_MESSAGE_START', messageId }];
        }
        if (block.type === 'text') {
            const messageId = this.nextMessageId('text');
            this.blockByIndex.set(event.index, { kind: 'text', messageId });
            this.liveTextId = messageId;
            this.liveText = '';
            this.textContentById.set(messageId, '');
            return [{ type: 'TEXT_MESSAGE_START', messageId }];
        }
        return [];
    }

    protected handleContentBlockDelta(event: NonNullable<StreamMessageEnvelope['event']>): QaapAgUiEvent[] {
        const delta = event.delta;
        if (!delta?.type) {
            return [];
        }
        if (delta.type === 'text_delta' && delta.text) {
            const block = event.index !== undefined ? this.blockByIndex.get(event.index) : undefined;
            const messageId = block?.kind === 'text'
                ? block.messageId
                : this.ensureLiveTextId();
            this.liveText = mergeIncrementalStreamText(this.liveText, delta.text);
            this.textContentById.set(messageId, this.liveText);
            const events: QaapAgUiEvent[] = [];
            if (!block && this.liveText === delta.text) {
                events.push({ type: 'TEXT_MESSAGE_START', messageId });
            }
            events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: delta.text });
            return events;
        }
        if (delta.type === 'thinking_delta' && delta.thinking) {
            const block = event.index !== undefined ? this.blockByIndex.get(event.index) : undefined;
            const messageId = block?.kind === 'thinking'
                ? block.messageId
                : this.ensureLiveThoughtId();
            this.liveThinking = mergeIncrementalStreamText(this.liveThinking, delta.thinking);
            this.thoughtContentById.set(messageId, this.liveThinking);
            const events: QaapAgUiEvent[] = [];
            if (!block && this.liveThinking === delta.thinking) {
                events.push({ type: 'REASONING_MESSAGE_START', messageId });
            }
            events.push({ type: 'REASONING_MESSAGE_CONTENT', messageId, delta: delta.thinking });
            return events;
        }
        if (delta.type === 'input_json_delta' && delta.partial_json && event.index !== undefined) {
            const block = this.blockByIndex.get(event.index);
            if (!block || block.kind !== 'tool') {
                return [];
            }
            const merged = `${this.toolArgsById.get(block.messageId) ?? ''}${delta.partial_json}`;
            this.toolArgsById.set(block.messageId, merged);
            return [{
                type: 'TOOL_CALL_ARGS',
                toolCallId: block.messageId,
                delta: delta.partial_json,
            }];
        }
        return [];
    }

    protected handleContentBlockStop(event: NonNullable<StreamMessageEnvelope['event']>): QaapAgUiEvent[] {
        if (event.index === undefined) {
            return [];
        }
        const block = this.blockByIndex.get(event.index);
        this.blockByIndex.delete(event.index);
        if (!block) {
            return [];
        }
        if (block.kind === 'text') {
            if (this.liveTextId === block.messageId) {
                this.liveTextId = undefined;
                this.liveText = '';
            }
            return [{ type: 'TEXT_MESSAGE_END', messageId: block.messageId }];
        }
        if (block.kind === 'thinking') {
            if (this.liveThoughtId === block.messageId) {
                this.liveThoughtId = undefined;
                this.liveThinking = '';
            }
            return [{ type: 'REASONING_MESSAGE_END', messageId: block.messageId }];
        }
        return [];
    }

    protected handleAssistantMessage(envelope: StreamMessageEnvelope): QaapAgUiEvent[] {
        if (envelope.timestamp_ms !== undefined) {
            this.sawTimestampedAssistant = true;
        } else if (this.sawTimestampedAssistant) {
            return [];
        }
        const raw = envelope.message?.content;
        if (!raw) {
            return [];
        }
        const blocks = typeof raw === 'string' ? [{ type: 'text', text: raw }] : raw;
        if (!Array.isArray(blocks)) {
            return [];
        }
        const events: QaapAgUiEvent[] = [];
        for (const block of blocks) {
            events.push(...this.syncSnapshotBlock(block));
        }
        return events;
    }

    protected syncSnapshotBlock(block: ContentBlock): QaapAgUiEvent[] {
        switch (block.type) {
            case 'text':
                return block.text ? this.syncSnapshotText(block.text) : [];
            case 'thinking':
            case 'redacted_thinking':
                return this.syncSnapshotThought(block.thinking ?? block.data ?? '');
            case 'tool_use':
            case 'server_tool_use':
                return block.id && block.name
                    ? this.syncSnapshotTool(block.id, block.name, block.input)
                    : [];
            default:
                return [];
        }
    }

    protected syncSnapshotText(text: string): QaapAgUiEvent[] {
        const trimmed = text.trim();
        if (!trimmed) {
            return [];
        }
        const existingId = this.findTextIdWithContent(trimmed);
        if (existingId) {
            return [];
        }
        const priorId = this.liveTextId ?? this.findPartialTextId(trimmed);
        if (priorId) {
            const prior = this.textContentById.get(priorId) ?? '';
            if (trimmed === prior) {
                return [{ type: 'TEXT_MESSAGE_END', messageId: priorId }];
            }
            if (trimmed.startsWith(prior) && trimmed.length > prior.length) {
                const append = trimmed.slice(prior.length);
                this.textContentById.set(priorId, trimmed);
                return [
                    { type: 'TEXT_MESSAGE_CONTENT', messageId: priorId, delta: append },
                    { type: 'TEXT_MESSAGE_END', messageId: priorId },
                ];
            }
        }
        const messageId = this.nextMessageId('text');
        this.textContentById.set(messageId, trimmed);
        return [
            { type: 'TEXT_MESSAGE_START', messageId },
            { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: trimmed },
            { type: 'TEXT_MESSAGE_END', messageId },
        ];
    }

    protected syncSnapshotThought(content: string): QaapAgUiEvent[] {
        const trimmed = content.trim();
        if (!trimmed) {
            return [];
        }
        const priorId = this.liveThoughtId ?? this.findPartialThoughtId(trimmed);
        if (priorId) {
            const prior = this.thoughtContentById.get(priorId) ?? '';
            if (trimmed === prior) {
                return [{ type: 'REASONING_MESSAGE_END', messageId: priorId }];
            }
            if (trimmed.startsWith(prior) && trimmed.length > prior.length) {
                const append = trimmed.slice(prior.length);
                this.thoughtContentById.set(priorId, trimmed);
                return [
                    { type: 'REASONING_MESSAGE_CONTENT', messageId: priorId, delta: append },
                    { type: 'REASONING_MESSAGE_END', messageId: priorId },
                ];
            }
        }
        const messageId = this.nextMessageId('thought');
        this.thoughtContentById.set(messageId, trimmed);
        return [
            { type: 'REASONING_MESSAGE_START', messageId },
            { type: 'REASONING_MESSAGE_CONTENT', messageId, delta: trimmed },
            { type: 'REASONING_MESSAGE_END', messageId },
        ];
    }

    protected syncSnapshotTool(
        toolCallId: string,
        name: string,
        input: Record<string, unknown> | undefined,
    ): QaapAgUiEvent[] {
        const args = input && Object.keys(input).length > 0 ? JSON.stringify(input) : '';
        const events: QaapAgUiEvent[] = [];
        if (!this.startedTools.has(toolCallId)) {
            this.startedTools.add(toolCallId);
            this.toolArgsById.set(toolCallId, args);
            events.push({
                type: 'TOOL_CALL_START',
                toolCallId,
                toolCallName: name,
            });
            if (args) {
                events.push({ type: 'TOOL_CALL_ARGS', toolCallId, delta: args });
            }
            return events;
        }
        const priorArgs = this.toolArgsById.get(toolCallId) ?? '';
        if (args && args !== priorArgs && args.startsWith(priorArgs) && args.length > priorArgs.length) {
            const append = args.slice(priorArgs.length);
            this.toolArgsById.set(toolCallId, args);
            events.push({ type: 'TOOL_CALL_ARGS', toolCallId, delta: append });
        }
        return events;
    }

    protected handleUserMessage(envelope: StreamMessageEnvelope): QaapAgUiEvent[] {
        const raw = envelope.message?.content;
        if (!raw) {
            return [];
        }
        const blocks = typeof raw === 'string' ? [] : raw;
        if (!Array.isArray(blocks)) {
            return [];
        }
        const events: QaapAgUiEvent[] = [];
        for (const block of blocks) {
            if (block.type !== 'tool_result' || !block.tool_use_id) {
                continue;
            }
            const result = typeof block.content === 'string'
                ? block.content
                : JSON.stringify(block.content ?? '');
            events.push({
                type: 'TOOL_CALL_RESULT',
                toolCallId: block.tool_use_id,
                result,
            });
            events.push({
                type: 'TOOL_CALL_END',
                toolCallId: block.tool_use_id,
            });
        }
        return events;
    }

    protected ensureLiveTextId(): string {
        if (!this.liveTextId) {
            this.liveTextId = this.nextMessageId('text');
            this.textContentById.set(this.liveTextId, '');
        }
        return this.liveTextId;
    }

    protected ensureLiveThoughtId(): string {
        if (!this.liveThoughtId) {
            this.liveThoughtId = this.nextMessageId('thought');
            this.thoughtContentById.set(this.liveThoughtId, '');
        }
        return this.liveThoughtId;
    }

    protected findTextIdWithContent(content: string): string | undefined {
        for (const [id, value] of this.textContentById.entries()) {
            if (value === content) {
                return id;
            }
        }
        return undefined;
    }

    protected findPartialTextId(content: string): string | undefined {
        for (const [id, value] of this.textContentById.entries()) {
            if (content.startsWith(value) || value.startsWith(content)) {
                return id;
            }
        }
        return undefined;
    }

    protected findPartialThoughtId(content: string): string | undefined {
        for (const [id, value] of this.thoughtContentById.entries()) {
            if (content.startsWith(value) || value.startsWith(content)) {
                return id;
            }
        }
        return undefined;
    }

    protected nextMessageId(prefix: string): string {
        this.seq += 1;
        return `${prefix}-${this.seq}`;
    }
}

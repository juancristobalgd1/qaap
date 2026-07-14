// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageSegment } from './qaap-qaiq-stream';
import { normalizeQaiqToolName } from './qaap-qaiq-stream';
import type { QaapAgentContextUsage } from './qaap-agent-context-usage';
import { segmentsToTraceEvents, type QaapTranscriptTraceEventDTO } from './qaap-transcript-trace-model';

interface CodexStreamItem {
    readonly id?: string;
    readonly type?: string;
    readonly item_type?: string;
    readonly text?: string;
    readonly command?: string;
    readonly tool?: string;
    readonly status?: string;
    readonly output?: string;
    readonly stdout?: string;
    readonly stderr?: string;
    readonly prompt?: string;
    readonly parent_id?: string;
    readonly parent_tool_use_id?: string;
}

interface CodexStreamEvent {
    readonly type?: string;
    readonly parent_id?: string;
    readonly parent_tool_use_id?: string;
    readonly item?: CodexStreamItem;
    readonly msg?: {
        readonly type?: string;
        readonly content?: string;
    };
    readonly error?: { readonly message?: string };
    readonly usage?: {
        readonly input_tokens?: number;
        readonly output_tokens?: number;
        readonly cached_input_tokens?: number;
    };
}

/**
 * Incrementally parses {@code codex exec --json} NDJSON into chat segments.
 */
export class QaapCodexStreamAccumulator {

    protected buffer = '';
    protected segments: QaapAgentMessageSegment[] = [];
    protected readonly itemsById = new Map<string, number>();
    protected readonly toolParentById = new Map<string, string>();
    protected activeParentToolUseId: string | undefined;
    protected jsonEvents = 0;
    protected turnUsage: QaapAgentContextUsage | undefined;

    getTurnUsage(): QaapAgentContextUsage | undefined {
        return this.turnUsage;
    }

    push(chunk: string): readonly QaapAgentMessageSegment[] {
        if (!chunk) {
            return this.segments;
        }
        this.buffer += chunk;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';
        for (const line of lines) {
            this.consumeLine(line.trim());
        }
        return this.segments;
    }

    getSegments(): readonly QaapAgentMessageSegment[] {
        return this.segments;
    }

    consumedJsonEvents(): boolean {
        return this.jsonEvents > 0;
    }

    getDisplayText(): string {
        const parts: string[] = [];
        for (const segment of this.segments) {
            if (segment.type === 'text' && segment.content.trim()) {
                parts.push(segment.content.trim());
            } else if (segment.type === 'thinking' && segment.content.trim()) {
                parts.push(`[thinking] ${segment.content.trim()}`);
            } else if (segment.type === 'tool') {
                parts.push(`[tool ${segment.finished ? 'done' : 'running'}] ${segment.name}`);
            }
        }
        return parts.join('\n\n');
    }

    getTraceEvents(): readonly QaapTranscriptTraceEventDTO[] {
        return segmentsToTraceEvents(this.segments, { streaming: true });
    }

    protected consumeLine(line: string): void {
        if (!line) {
            return;
        }
        let envelope: CodexStreamEvent;
        try {
            envelope = JSON.parse(line) as CodexStreamEvent;
        } catch {
            return;
        }
        this.jsonEvents += 1;
        this.captureUsage(envelope);
        this.captureParentContext(envelope);
        if (envelope.msg?.type === 'text' && envelope.msg.content?.trim()) {
            this.appendText(envelope.msg.content);
            return;
        }
        if (envelope.error?.message?.trim()) {
            this.appendText(`\n\n**Error:** ${envelope.error.message.trim()}`);
            return;
        }
        const eventType = envelope.type ?? '';
        const item = envelope.item;
        if (!item) {
            return;
        }
        const itemType = item.type ?? item.item_type ?? '';
        const itemId = item.id ?? `codex-${this.segments.length}`;
        this.captureParentContext(envelope, item);
        if (eventType === 'item.started' || (eventType === 'item.updated' && item.status === 'in_progress')) {
            this.consumeItemStarted(itemId, itemType, item);
            return;
        }
        if (eventType === 'item.completed' || eventType === 'item.updated') {
            this.consumeItemCompleted(itemId, itemType, item);
        }
    }

    protected captureUsage(envelope: CodexStreamEvent): void {
        if (envelope.type !== 'turn.completed' || !envelope.usage) {
            return;
        }
        const reportedInput = Math.max(0, envelope.usage.input_tokens ?? 0);
        const cacheReadInputTokens = Math.min(reportedInput, Math.max(0, envelope.usage.cached_input_tokens ?? 0));
        const inputTokens = reportedInput - cacheReadInputTokens;
        const outputTokens = Math.max(0, envelope.usage.output_tokens ?? 0);
        if (inputTokens + outputTokens + cacheReadInputTokens === 0) {
            return;
        }
        this.turnUsage = {
            inputTokens,
            outputTokens,
            ...(cacheReadInputTokens > 0 ? { cacheReadInputTokens } : {}),
        };
    }

    protected captureParentContext(envelope: CodexStreamEvent, item?: CodexStreamItem): void {
        const parentFromEvent = resolveCodexParentToolUseId(envelope.parent_tool_use_id ?? envelope.parent_id);
        if (parentFromEvent) {
            this.activeParentToolUseId = parentFromEvent;
        }
        const parentFromItem = resolveCodexParentToolUseId(item?.parent_tool_use_id ?? item?.parent_id);
        if (parentFromItem) {
            this.activeParentToolUseId = parentFromItem;
        }
    }

    protected consumeItemStarted(itemId: string, itemType: string, item: CodexStreamItem): void {
        if (isCodexCollabItem(itemType)) {
            this.consumeCollabItem(itemId, itemType, item, false);
            return;
        }
        if (isCodexReasoningItem(itemType)) {
            if (item.text?.trim()) {
                this.appendThinking(item.text);
            }
            return;
        }
        if (isCodexToolItem(itemType)) {
            const name = classifyCodexToolName(itemType, item);
            const args = buildCodexToolArgs(itemType, item);
            this.upsertTool(itemId, name, args, false);
        }
    }

    protected consumeItemCompleted(itemId: string, itemType: string, item: CodexStreamItem): void {
        if (isCodexCollabItem(itemType)) {
            this.consumeCollabItem(itemId, itemType, item, true);
            return;
        }
        if (isCodexMessageItem(itemType)) {
            if (item.text?.trim()) {
                this.appendText(item.text);
            }
            return;
        }
        if (isCodexReasoningItem(itemType)) {
            if (item.text?.trim()) {
                this.appendThinking(item.text);
            }
            return;
        }
        if (isCodexToolItem(itemType)) {
            const name = classifyCodexToolName(itemType, item);
            const args = buildCodexToolArgs(itemType, item);
            const result = extractCodexToolResult(item);
            this.upsertTool(itemId, name, args, true, result);
        }
    }

    protected appendText(text: string): void {
        if (!text) {
            return;
        }
        const last = this.segments[this.segments.length - 1];
        if (last?.type === 'text') {
            this.segments[this.segments.length - 1] = { type: 'text', content: last.content + text };
            return;
        }
        this.segments.push({ type: 'text', content: text });
    }

    protected appendThinking(text: string): void {
        if (!text) {
            return;
        }
        const last = this.segments[this.segments.length - 1];
        if (last?.type === 'thinking') {
            this.segments[this.segments.length - 1] = { type: 'thinking', content: last.content + text };
            return;
        }
        this.segments.push({ type: 'thinking', content: text });
    }

    protected consumeCollabItem(
        itemId: string,
        itemType: string,
        item: CodexStreamItem,
        finished: boolean,
    ): void {
        const collabTool = (item.tool ?? itemType).toLowerCase();
        const args = buildCodexToolArgs(itemType, item);
        if (isCodexCollabSpawnTool(collabTool)) {
            this.upsertTool(itemId, 'Agent', args, finished);
            this.activeParentToolUseId = itemId;
            return;
        }
        if (isCodexCollabCloseTool(collabTool)) {
            this.upsertTool(itemId, 'Task', args, finished);
            if (finished) {
                this.activeParentToolUseId = undefined;
            }
            return;
        }
        this.upsertTool(itemId, 'Agent', args, finished);
    }

    protected upsertTool(
        toolUseId: string,
        name: string,
        args: string,
        finished: boolean,
        result?: string,
    ): void {
        let parentToolUseId = this.toolParentById.get(toolUseId);
        if (!parentToolUseId && this.activeParentToolUseId && this.activeParentToolUseId !== toolUseId) {
            parentToolUseId = this.activeParentToolUseId;
            this.toolParentById.set(toolUseId, parentToolUseId);
        }
        const existingIndex = this.itemsById.get(toolUseId);
        const segment: QaapAgentMessageSegment = result !== undefined
            ? {
                type: 'tool',
                toolUseId,
                name,
                args,
                finished,
                result,
                ...(parentToolUseId ? { parentToolUseId } : {}),
            }
            : {
                type: 'tool',
                toolUseId,
                name,
                args,
                finished,
                ...(parentToolUseId ? { parentToolUseId } : {}),
            };
        if (existingIndex !== undefined) {
            this.segments[existingIndex] = segment;
            return;
        }
        this.itemsById.set(toolUseId, this.segments.length);
        this.segments.push(segment);
    }
}

export function parseCodexLog(log: string): { content: string; segments: QaapAgentMessageSegment[] } {
    const acc = new QaapCodexStreamAccumulator();
    acc.push(log);
    if (acc.consumedJsonEvents()) {
        const segments = [...acc.getSegments()];
        return { content: acc.getDisplayText() || log.trim(), segments };
    }
    return { content: log.trim(), segments: [] };
}

function isCodexMessageItem(itemType: string): boolean {
    return itemType === 'agent_message' || itemType === 'assistant_message';
}

function isCodexReasoningItem(itemType: string): boolean {
    return itemType === 'reasoning' || itemType === 'reasoning_text';
}

function isCodexToolItem(itemType: string): boolean {
    return itemType === 'command_execution'
        || itemType === 'shell_command'
        || itemType === 'file_change'
        || itemType === 'apply_patch'
        || itemType === 'mcp_tool_call'
        || itemType === 'web_search'
        || itemType === 'tool_call';
}

function isCodexCollabItem(itemType: string): boolean {
    return itemType === 'collab_tool_call';
}

function isCodexCollabSpawnTool(tool: string): boolean {
    return tool === 'spawn_agent' || tool.includes('spawn');
}

function isCodexCollabCloseTool(tool: string): boolean {
    return tool === 'close_agent' || tool.includes('close');
}

function resolveCodexParentToolUseId(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

function classifyCodexToolName(itemType: string, item: CodexStreamItem): string {
    if (itemType === 'command_execution' || itemType === 'shell_command') {
        return 'Bash';
    }
    if (itemType === 'mcp_tool_call') {
        return 'mcp_tool_call';
    }
    if (itemType === 'file_change' || itemType === 'apply_patch') {
        return 'Edit';
    }
    if (itemType === 'web_search') {
        return 'WebSearch';
    }
    return normalizeQaiqToolName(itemType.replace(/_/g, ' '));
}

function buildCodexToolArgs(itemType: string, item: CodexStreamItem): string {
    if (item.command?.trim()) {
        return JSON.stringify({ command: item.command.trim() });
    }
    if (item.text?.trim()) {
        return JSON.stringify({ detail: item.text.trim() });
    }
    return JSON.stringify({ type: itemType });
}

function extractCodexToolResult(item: CodexStreamItem): string | undefined {
    const output = item.output ?? item.stdout ?? item.stderr;
    return typeof output === 'string' && output.trim() ? output.trim() : undefined;
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgUiEvent } from './qaap-ag-ui-transcript-adapter';
import { normalizeQaiqToolName } from './qaap-qaiq-stream';
import type { QaapCliAgUiStreamEmitter } from './qaap-cli-ag-ui-stream';

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
}

/** Maps Codex {@code exec --json} NDJSON into native AG-UI transcript events. */
export class QaapCodexAgUiStreamEmitter implements QaapCliAgUiStreamEmitter {

    protected buffer = '';
    protected liveTextId: string | undefined;
    protected liveThoughtId: string | undefined;
    protected readonly startedTools = new Set<string>();
    protected readonly toolArgsById = new Map<string, string>();
    protected readonly completedTools = new Set<string>();
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
        let envelope: CodexStreamEvent;
        try {
            envelope = JSON.parse(line) as CodexStreamEvent;
        } catch {
            return [];
        }
        const events: QaapAgUiEvent[] = [];
        if (envelope.msg?.type === 'text' && envelope.msg.content?.trim()) {
            events.push(...this.appendText(envelope.msg.content));
            return events;
        }
        if (envelope.error?.message?.trim()) {
            events.push(...this.endLiveStreams());
            events.push({ type: 'RUN_ERROR', message: envelope.error.message.trim() });
            return events;
        }
        const eventType = envelope.type ?? '';
        const item = envelope.item;
        if (!item) {
            return events;
        }
        const itemType = item.type ?? item.item_type ?? '';
        const itemId = item.id ?? `codex-${this.seq + 1}`;
        if (eventType === 'item.started' || (eventType === 'item.updated' && item.status === 'in_progress')) {
            events.push(...this.consumeItemStarted(itemId, itemType, item));
            return events;
        }
        if (eventType === 'item.completed' || eventType === 'item.updated') {
            events.push(...this.consumeItemCompleted(itemId, itemType, item));
        }
        return events;
    }

    protected consumeItemStarted(itemId: string, itemType: string, item: CodexStreamItem): QaapAgUiEvent[] {
        if (isCodexCollabItem(itemType)) {
            return this.startTool(itemId, isCodexCollabSpawnTool((item.tool ?? itemType).toLowerCase()) ? 'Agent' : 'Task', buildCodexToolArgs(itemType, item));
        }
        if (isCodexReasoningItem(itemType)) {
            return item.text?.trim() ? this.appendThought(item.text) : [];
        }
        if (isCodexToolItem(itemType)) {
            return this.startTool(itemId, classifyCodexToolName(itemType, item), buildCodexToolArgs(itemType, item));
        }
        return [];
    }

    protected consumeItemCompleted(itemId: string, itemType: string, item: CodexStreamItem): QaapAgUiEvent[] {
        if (isCodexCollabItem(itemType)) {
            const events = this.startTool(itemId, isCodexCollabSpawnTool((item.tool ?? itemType).toLowerCase()) ? 'Agent' : 'Task', buildCodexToolArgs(itemType, item));
            events.push(...this.completeTool(itemId, extractCodexToolResult(item)));
            return events;
        }
        if (isCodexMessageItem(itemType)) {
            return item.text?.trim() ? this.appendText(item.text) : [];
        }
        if (isCodexReasoningItem(itemType)) {
            const events = item.text?.trim() ? this.appendThought(item.text) : [];
            events.push(...this.endLiveThought());
            return events;
        }
        if (isCodexToolItem(itemType)) {
            const events = this.startTool(itemId, classifyCodexToolName(itemType, item), buildCodexToolArgs(itemType, item));
            events.push(...this.completeTool(itemId, extractCodexToolResult(item)));
            return events;
        }
        return [];
    }

    protected startTool(toolCallId: string, name: string, args: string): QaapAgUiEvent[] {
        this.endLiveText();
        this.endLiveThought();
        if (this.startedTools.has(toolCallId)) {
            const priorArgs = this.toolArgsById.get(toolCallId) ?? '';
            if (args && args !== priorArgs && args.startsWith(priorArgs) && args.length > priorArgs.length) {
                const delta = args.slice(priorArgs.length);
                this.toolArgsById.set(toolCallId, args);
                return [{ type: 'TOOL_CALL_ARGS', toolCallId, delta }];
            }
            return [];
        }
        this.startedTools.add(toolCallId);
        this.toolArgsById.set(toolCallId, args);
        const events: QaapAgUiEvent[] = [{
            type: 'TOOL_CALL_START',
            toolCallId,
            toolCallName: name,
        }];
        if (args) {
            events.push({ type: 'TOOL_CALL_ARGS', toolCallId, delta: args });
        }
        return events;
    }

    protected completeTool(toolCallId: string, result: string | undefined): QaapAgUiEvent[] {
        if (this.completedTools.has(toolCallId)) {
            return [];
        }
        this.completedTools.add(toolCallId);
        const events: QaapAgUiEvent[] = [];
        if (result !== undefined) {
            events.push({ type: 'TOOL_CALL_RESULT', toolCallId, result });
        }
        events.push({ type: 'TOOL_CALL_END', toolCallId });
        return events;
    }

    protected appendText(text: string): QaapAgUiEvent[] {
        if (!text) {
            return [];
        }
        this.endLiveThought();
        const events: QaapAgUiEvent[] = [];
        if (!this.liveTextId) {
            this.liveTextId = this.nextId('text');
            events.push({ type: 'TEXT_MESSAGE_START', messageId: this.liveTextId });
        }
        events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: this.liveTextId, delta: text });
        return events;
    }

    protected appendThought(text: string): QaapAgUiEvent[] {
        if (!text) {
            return [];
        }
        this.endLiveText();
        const events: QaapAgUiEvent[] = [];
        if (!this.liveThoughtId) {
            this.liveThoughtId = this.nextId('thought');
            events.push({ type: 'REASONING_MESSAGE_START', messageId: this.liveThoughtId });
        }
        events.push({ type: 'REASONING_MESSAGE_CONTENT', messageId: this.liveThoughtId, delta: text });
        return events;
    }

    protected endLiveText(): QaapAgUiEvent[] {
        if (!this.liveTextId) {
            return [];
        }
        const messageId = this.liveTextId;
        this.liveTextId = undefined;
        return [{ type: 'TEXT_MESSAGE_END', messageId }];
    }

    protected endLiveThought(): QaapAgUiEvent[] {
        if (!this.liveThoughtId) {
            return [];
        }
        const messageId = this.liveThoughtId;
        this.liveThoughtId = undefined;
        return [{ type: 'REASONING_MESSAGE_END', messageId }];
    }

    protected endLiveStreams(): QaapAgUiEvent[] {
        return [...this.endLiveText(), ...this.endLiveThought()];
    }

    protected nextId(prefix: string): string {
        this.seq += 1;
        return `${prefix}-${this.seq}`;
    }
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

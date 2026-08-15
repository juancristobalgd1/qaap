// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgUiEvent } from './qaap-ag-ui-transcript-adapter';
import { normalizeQaiqToolName } from './qaap-qaiq-stream';
import type { QaapCliAgUiStreamEmitter } from './qaap-cli-ag-ui-stream';

interface OpencodeToolPart {
    readonly id?: string;
    readonly type?: string;
    readonly tool?: string;
    readonly input?: Record<string, unknown>;
    readonly text?: string;
    readonly parentID?: string;
    readonly state?: {
        readonly status?: string;
        readonly error?: string;
        readonly output?: string;
        readonly stdout?: string;
        readonly input?: Record<string, unknown>;
    };
}

interface OpencodeStreamEvent {
    readonly type?: string;
    readonly part?: OpencodeToolPart;
}

/** Maps OpenCode {@code run --format json} NDJSON into native AG-UI transcript events. */
export class QaapOpencodeAgUiStreamEmitter implements QaapCliAgUiStreamEmitter {

    protected buffer = '';
    protected liveTextId: string | undefined;
    protected liveThoughtId: string | undefined;
    protected readonly startedTools = new Set<string>();
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
        let envelope: OpencodeStreamEvent;
        try {
            envelope = JSON.parse(line) as OpencodeStreamEvent;
        } catch {
            return [];
        }
        if (!envelope.type) {
            return [];
        }
        switch (envelope.type) {
            case 'text':
                return envelope.part?.text?.trim() ? this.appendText(envelope.part.text) : [];
            case 'reasoning':
                return envelope.part?.text?.trim() ? this.appendThought(envelope.part.text) : [];
            case 'tool_use':
                return this.consumeToolPart(envelope.part);
            default:
                return [];
        }
    }

    protected consumeToolPart(part: OpencodeToolPart | undefined): QaapAgUiEvent[] {
        if (!part || part.type !== 'tool' || !part.tool) {
            return [];
        }
        const toolCallId = part.id ?? `opencode-${this.seq + 1}`;
        const name = normalizeQaiqToolName(part.tool);
        const args = JSON.stringify(part.input ?? {});
        const status = part.state?.status;
        const finished = status === 'completed' || status === 'error' || status === undefined;
        const result = extractOpencodeToolResult(part.state);
        const events = this.startTool(toolCallId, name, args);
        if (finished) {
            events.push(...this.completeTool(toolCallId, result));
        }
        return events;
    }

    protected startTool(toolCallId: string, name: string, args: string): QaapAgUiEvent[] {
        this.endLiveText();
        this.endLiveThought();
        if (this.startedTools.has(toolCallId)) {
            return [];
        }
        this.startedTools.add(toolCallId);
        const events: QaapAgUiEvent[] = [{
            type: 'TOOL_CALL_START',
            toolCallId,
            toolCallName: name,
        }];
        if (args && args !== '{}') {
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

    protected nextId(prefix: string): string {
        this.seq += 1;
        return `${prefix}-${this.seq}`;
    }
}

function extractOpencodeToolResult(state: OpencodeToolPart['state']): string | undefined {
    if (!state) {
        return undefined;
    }
    if (typeof state.error === 'string' && state.error.trim()) {
        return `Error: ${state.error.trim()}`;
    }
    if (typeof state.output === 'string' && state.output.trim()) {
        return state.output;
    }
    if (typeof state.stdout === 'string' && state.stdout.trim()) {
        return state.stdout;
    }
    return undefined;
}

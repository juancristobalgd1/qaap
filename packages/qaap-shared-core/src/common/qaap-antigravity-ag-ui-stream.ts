// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgUiEvent } from './qaap-ag-ui-transcript-adapter';
import type { QaapCliAgUiStreamEmitter } from './qaap-cli-ag-ui-stream';
import { QaapQaiqAgUiStreamEmitter } from './qaap-qaiq-ag-ui-stream';

/** Matches OpenCode-style formatted CLI tool lines (`→ Read …`, `$ npm test`). */
const FORMATTED_TOOL_LINE = /^(?:→|✱|⎔|⚙|⌁|\$)\s+/u;

const FORMATTED_HEADER_LINE = /^>\s+/;

/**
 * Antigravity CLI: stream-json when available (QAIQ envelope), otherwise incremental
 * OpenCode-style formatted stdout → AG-UI events.
 */
export class QaapAntigravityAgUiStreamEmitter implements QaapCliAgUiStreamEmitter {

    protected readonly jsonEmitter = new QaapQaiqAgUiStreamEmitter();
    protected buffer = '';
    protected sawJsonEnvelope = false;
    protected liveTextId: string | undefined;
    protected toolSeq = 0;
    protected textSeq = 0;

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
        if (this.isJsonEnvelopeLine(line)) {
            this.sawJsonEnvelope = true;
            return this.jsonEmitter.push(`${line}\n`);
        }
        if (this.sawJsonEnvelope) {
            return [];
        }
        return this.consumeFormattedLine(line);
    }

    protected isJsonEnvelopeLine(line: string): boolean {
        if (!line.startsWith('{')) {
            return false;
        }
        try {
            const envelope = JSON.parse(line) as { type?: unknown };
            return typeof envelope.type === 'string';
        } catch {
            return false;
        }
    }

    protected consumeFormattedLine(line: string): QaapAgUiEvent[] {
        if (FORMATTED_HEADER_LINE.test(line)) {
            return [];
        }
        if (FORMATTED_TOOL_LINE.test(line)) {
            return this.emitFormattedTool(line);
        }
        return this.appendFormattedText(line);
    }

    protected emitFormattedTool(line: string): QaapAgUiEvent[] {
        this.endLiveText();
        this.toolSeq += 1;
        const toolCallId = `fmt-tool-${this.toolSeq}`;
        if (line.startsWith('$')) {
            const command = line.slice(1).trim();
            const args = JSON.stringify({ command });
            return [
                { type: 'TOOL_CALL_START', toolCallId, toolCallName: 'Bash' },
                { type: 'TOOL_CALL_ARGS', toolCallId, delta: args },
                { type: 'TOOL_CALL_END', toolCallId },
            ];
        }
        const { name, args } = classifyFormattedToolLine(line);
        return [
            { type: 'TOOL_CALL_START', toolCallId, toolCallName: name },
            { type: 'TOOL_CALL_ARGS', toolCallId, delta: args },
            { type: 'TOOL_CALL_END', toolCallId },
        ];
    }

    protected appendFormattedText(line: string): QaapAgUiEvent[] {
        const events: QaapAgUiEvent[] = [];
        if (!this.liveTextId) {
            this.textSeq += 1;
            this.liveTextId = `fmt-text-${this.textSeq}`;
            events.push({ type: 'TEXT_MESSAGE_START', messageId: this.liveTextId });
        }
        events.push({ type: 'TEXT_MESSAGE_CONTENT', messageId: this.liveTextId, delta: `${line}\n` });
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
}

function classifyFormattedToolLine(line: string): { name: string; args: string } {
    const body = line.replace(/^(?:→|✱|⎔|⚙|⌁)\s+/u, '').trim();
    const readMatch = /^Read\s+(.+)$/i.exec(body);
    if (readMatch) {
        return { name: 'Read', args: JSON.stringify({ file_path: readMatch[1] }) };
    }
    const editMatch = /^Edit\s+(.+)$/i.exec(body);
    if (editMatch) {
        return { name: 'Edit', args: JSON.stringify({ file_path: editMatch[1] }) };
    }
    return { name: 'Tool', args: JSON.stringify({ title: body }) };
}

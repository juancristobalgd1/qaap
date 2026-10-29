// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentStreamAccumulator } from './qaap-cli-transcript-stream';
import type { QaapAgentContextUsage } from './qaap-agent-context-usage';
import type { QaapAgentMessageSegment } from './qaap-qaiq-stream';
import { normalizeQaiqToolName } from './qaap-qaiq-stream';
import { segmentsToTraceEvents, type QaapTranscriptTraceEventDTO } from './qaap-transcript-trace-model';

/** Pi's `--mode json` writes this type for the session header, the first record of the stream. */
export const PI_JSON_SESSION_HEADER_TYPE = 'session';

/** Usage as Pi reports it on assistant messages (see Pi `message-types.md`). */
interface PiJsonUsage {
    readonly input?: number;
    readonly output?: number;
    readonly cacheRead?: number;
    readonly cacheWrite?: number;
    /** Already included in `output`; never added again. */
    readonly reasoning?: number;
    readonly totalTokens?: number;
    readonly cost?: { readonly total?: number };
}

interface PiJsonContentBlock {
    readonly type?: string;
    readonly text?: string;
    readonly thinking?: string;
    readonly id?: string;
    readonly name?: string;
    readonly arguments?: unknown;
}

interface PiJsonMessage {
    readonly role?: string;
    readonly content?: unknown;
    readonly usage?: PiJsonUsage;
    readonly stopReason?: string;
    readonly errorMessage?: string;
}

interface PiJsonAssistantMessageEvent {
    readonly type?: string;
    readonly contentIndex?: number;
    readonly delta?: string;
    readonly content?: string;
    readonly id?: string;
    readonly toolName?: string;
    readonly toolCall?: { readonly id?: string; readonly name?: string; readonly arguments?: unknown };
}

interface PiJsonEvent {
    readonly type?: string;
    readonly usage?: PiJsonUsage;
    readonly assistantMessageEvent?: PiJsonAssistantMessageEvent;
    readonly message?: PiJsonMessage;
    readonly toolCallId?: string;
    readonly toolName?: string;
    readonly args?: unknown;
    readonly partialResult?: unknown;
    readonly result?: unknown;
    readonly isError?: boolean;
}

/** Token and cost totals for one turn, read from its last cumulative usage value. */
interface PiTurnUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly costUsd?: number;
}

/**
 * Incrementally parses Pi's `--mode json` JSONL (one session header, then session events) into chat
 * segments and per-turn usage. Pi reports usage and cost cumulatively per assistant message, so each
 * turn keeps only its last value; totals sum the turns and never the updates inside a turn.
 */
export class QaapPiStreamAccumulator implements QaapAgentStreamAccumulator {
    protected buffer = '';
    protected segments: QaapAgentMessageSegment[] = [];
    /** Segment index of each text/thinking block in the current assistant message, by `contentIndex`. */
    protected readonly blockSegmentByIndex = new Map<number, number>();
    /** Tool call id of each tool block in the current assistant message, by `contentIndex`. */
    protected readonly toolIdByIndex = new Map<number, string>();
    /** Argument JSON accumulated from `toolcall_delta`, by `contentIndex`. */
    protected readonly toolArgsByIndex = new Map<number, string>();
    protected readonly toolSegmentById = new Map<string, number>();
    protected jsonEvents = 0;
    protected sessionHeaderSeen = false;
    protected activeTurn: PiTurnUsage | undefined;
    protected readonly completedTurns: PiTurnUsage[] = [];

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

    /** True once at least one JSON record was consumed. */
    consumedJsonEvents(): boolean {
        return this.jsonEvents > 0;
    }

    /** True once the session header record was seen. */
    hasSessionHeader(): boolean {
        return this.sessionHeaderSeen;
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

    /** Usage of the latest turn: the active one, or the last completed one. */
    getTurnUsage(): QaapAgentContextUsage | undefined {
        const turn = this.activeTurn ?? this.completedTurns[this.completedTurns.length - 1];
        return turn ? toContextUsage(turn) : undefined;
    }

    /** Tokens summed across all turns, each turn counted once at its last cumulative value. */
    getTotalUsage(): QaapAgentContextUsage | undefined {
        const turns = this.allTurns();
        if (turns.length === 0) {
            return undefined;
        }
        const total = turns.reduce<PiTurnUsage>((sum, turn) => ({
            inputTokens: sum.inputTokens + turn.inputTokens,
            outputTokens: sum.outputTokens + turn.outputTokens,
            cacheReadTokens: sum.cacheReadTokens + turn.cacheReadTokens,
            cacheWriteTokens: sum.cacheWriteTokens + turn.cacheWriteTokens,
        }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
        return toContextUsage(total);
    }

    /** Pi-reported cost summed across turns; undefined when no turn reported a cost. */
    getReportedCostUsd(): number | undefined {
        const costs = this.allTurns().map(turn => turn.costUsd).filter((cost): cost is number => cost !== undefined);
        return costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : undefined;
    }

    protected allTurns(): PiTurnUsage[] {
        return this.activeTurn ? [...this.completedTurns, this.activeTurn] : [...this.completedTurns];
    }

    protected consumeLine(line: string): void {
        if (!line) {
            return;
        }
        let event: PiJsonEvent;
        try {
            event = JSON.parse(line) as PiJsonEvent;
        } catch {
            return;
        }
        if (typeof event !== 'object' || event === null) {
            return;
        }
        this.jsonEvents += 1;
        switch (event.type) {
            case PI_JSON_SESSION_HEADER_TYPE:
                this.sessionHeaderSeen = true;
                return;
            case 'turn_start':
                this.finishActiveTurn();
                return;
            case 'turn_end':
                this.consumeUsage(event.message?.usage);
                this.finishActiveTurn();
                return;
            case 'message_start':
                if (event.message?.role === 'assistant') {
                    this.resetAssistantMessage();
                }
                return;
            case 'message_update':
                this.consumeUsage(event.usage);
                this.consumeAssistantMessageEvent(event.assistantMessageEvent);
                return;
            case 'message_end':
                if (event.message?.role === 'assistant') {
                    this.consumeAssistantMessageEnd(event.message);
                }
                return;
            case 'tool_execution_start':
                if (event.toolCallId) {
                    this.upsertTool(event.toolCallId, normalizeQaiqToolName(event.toolName ?? 'tool'), stringifyArgs(event.args));
                }
                return;
            case 'tool_execution_update':
                if (event.toolCallId) {
                    this.setToolResult(event.toolCallId, contentText(event.partialResult), false);
                }
                return;
            case 'tool_execution_end':
                if (event.toolCallId) {
                    this.setToolResult(event.toolCallId, contentText(event.result), true, event.isError === true);
                }
                return;
            default:
                return;
        }
    }

    protected consumeAssistantMessageEvent(event: PiJsonAssistantMessageEvent | undefined): void {
        if (!event) {
            return;
        }
        const index = event.contentIndex;
        switch (event.type) {
            case 'text_delta':
                this.appendBlock(index, 'text', event.delta ?? '');
                return;
            case 'text_end':
                this.setBlockContent(index, 'text', event.content);
                return;
            case 'thinking_delta':
                this.appendBlock(index, 'thinking', event.delta ?? '');
                return;
            case 'thinking_end':
                this.setBlockContent(index, 'thinking', event.content);
                return;
            case 'toolcall_start':
                if (index !== undefined && event.id) {
                    this.toolIdByIndex.set(index, event.id);
                    this.toolArgsByIndex.set(index, '');
                    this.upsertTool(event.id, normalizeQaiqToolName(event.toolName ?? 'tool'), '');
                }
                return;
            case 'toolcall_delta': {
                const toolId = index !== undefined ? this.toolIdByIndex.get(index) : undefined;
                if (toolId !== undefined && index !== undefined) {
                    const args = (this.toolArgsByIndex.get(index) ?? '') + (event.delta ?? '');
                    this.toolArgsByIndex.set(index, args);
                    const name = this.toolNameById(toolId);
                    this.upsertTool(toolId, name, args);
                }
                return;
            }
            case 'toolcall_end':
                if (event.toolCall?.id) {
                    this.upsertTool(
                        event.toolCall.id,
                        normalizeQaiqToolName(event.toolCall.name ?? 'tool'),
                        stringifyArgs(event.toolCall.arguments),
                    );
                }
                return;
            default:
                return;
        }
    }

    /** The message_end record is authoritative: it reconciles every block of the assistant message. */
    protected consumeAssistantMessageEnd(message: PiJsonMessage): void {
        const blocks = Array.isArray(message.content) ? message.content as PiJsonContentBlock[] : [];
        blocks.forEach((block, index) => {
            if (block.type === 'text') {
                this.setBlockContent(index, 'text', block.text);
            } else if (block.type === 'thinking') {
                this.setBlockContent(index, 'thinking', block.thinking);
            } else if (block.type === 'toolCall' && block.id) {
                this.upsertTool(block.id, normalizeQaiqToolName(block.name ?? 'tool'), stringifyArgs(block.arguments));
            }
        });
        if (message.stopReason === 'error' && message.errorMessage?.trim()) {
            this.appendText(`\n\n**Error:** ${message.errorMessage.trim()}`);
        }
        this.consumeUsage(message.usage);
    }

    /** Usage is cumulative per message, so the latest value replaces the turn's value. */
    protected consumeUsage(usage: PiJsonUsage | undefined): void {
        if (!usage) {
            return;
        }
        const turn = toTurnUsage(usage);
        if (turn) {
            this.activeTurn = turn;
        }
    }

    protected finishActiveTurn(): void {
        if (this.activeTurn) {
            this.completedTurns.push(this.activeTurn);
            this.activeTurn = undefined;
        }
    }

    protected resetAssistantMessage(): void {
        this.blockSegmentByIndex.clear();
        this.toolIdByIndex.clear();
        this.toolArgsByIndex.clear();
    }

    protected appendBlock(index: number | undefined, kind: 'text' | 'thinking', delta: string): void {
        if (index === undefined || !delta) {
            return;
        }
        const existing = this.blockSegmentByIndex.get(index);
        const previous = existing !== undefined ? this.segments[existing] : undefined;
        if (existing !== undefined && previous?.type === kind) {
            this.segments[existing] = { type: kind, content: previous.content + delta };
            return;
        }
        this.blockSegmentByIndex.set(index, this.segments.length);
        this.segments.push({ type: kind, content: delta });
    }

    protected setBlockContent(index: number | undefined, kind: 'text' | 'thinking', content: string | undefined): void {
        if (index === undefined || content === undefined) {
            return;
        }
        const existing = this.blockSegmentByIndex.get(index);
        if (existing !== undefined && this.segments[existing]?.type === kind) {
            this.segments[existing] = { type: kind, content };
            return;
        }
        if (!content.trim()) {
            return;
        }
        this.blockSegmentByIndex.set(index, this.segments.length);
        this.segments.push({ type: kind, content });
    }

    protected appendText(text: string): void {
        const last = this.segments[this.segments.length - 1];
        if (last?.type === 'text') {
            this.segments[this.segments.length - 1] = { type: 'text', content: last.content + text };
            return;
        }
        this.segments.push({ type: 'text', content: text });
    }

    protected toolNameById(toolUseId: string): string {
        const index = this.toolSegmentById.get(toolUseId);
        const segment = index !== undefined ? this.segments[index] : undefined;
        return segment?.type === 'tool' ? segment.name : 'tool';
    }

    /** Creates or updates a tool segment; a finished result is kept when only the arguments change. */
    protected upsertTool(toolUseId: string, name: string, args: string): void {
        const existingIndex = this.toolSegmentById.get(toolUseId);
        const previous = existingIndex !== undefined ? this.segments[existingIndex] : undefined;
        const prior = previous?.type === 'tool' ? previous : undefined;
        const segment: QaapAgentMessageSegment = {
            type: 'tool',
            toolUseId,
            name,
            args,
            finished: prior?.finished ?? false,
            ...(prior?.result !== undefined ? { result: prior.result } : {}),
            ...(prior?.error ? { error: true } : {}),
        };
        if (existingIndex !== undefined) {
            this.segments[existingIndex] = segment;
            return;
        }
        this.toolSegmentById.set(toolUseId, this.segments.length);
        this.segments.push(segment);
    }

    protected setToolResult(toolUseId: string, result: string | undefined, finished: boolean, error = false): void {
        if (!this.toolSegmentById.has(toolUseId)) {
            this.upsertTool(toolUseId, 'tool', '');
        }
        const index = this.toolSegmentById.get(toolUseId)!;
        const previous = this.segments[index];
        if (previous?.type !== 'tool') {
            return;
        }
        this.segments[index] = {
            ...previous,
            finished: previous.finished || finished,
            ...(result !== undefined ? { result } : {}),
            ...(error ? { error: true } : {}),
        };
    }
}

/**
 * Returns a Pi JSON accumulator when the first non-empty line of the output is Pi's session header.
 * Plain-text Pi output returns `undefined`, so the existing text path stays in use. Pass the output
 * once its first line is complete.
 */
export function resolvePiJsonStreamAccumulator(output: string): QaapPiStreamAccumulator | undefined {
    const firstLine = output.split('\n').map(line => line.trim()).find(line => line.length > 0);
    return firstLine !== undefined && isPiJsonSessionHeaderLine(firstLine) ? new QaapPiStreamAccumulator() : undefined;
}

/** True when a single line is a JSON object with Pi's session header type. */
export function isPiJsonSessionHeaderLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
        return false;
    }
    try {
        const parsed = JSON.parse(trimmed) as { readonly type?: unknown };
        return parsed.type === PI_JSON_SESSION_HEADER_TYPE;
    } catch {
        return false;
    }
}

function toTurnUsage(usage: PiJsonUsage): PiTurnUsage | undefined {
    const inputTokens = nonNegative(usage.input);
    const outputTokens = nonNegative(usage.output);
    const cacheReadTokens = nonNegative(usage.cacheRead);
    const cacheWriteTokens = nonNegative(usage.cacheWrite);
    const costTotal = usage.cost?.total;
    const costUsd = typeof costTotal === 'number' && Number.isFinite(costTotal) ? Math.max(0, costTotal) : undefined;
    if (inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens === 0 && costUsd === undefined) {
        return undefined;
    }
    return {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        ...(costUsd !== undefined ? { costUsd } : {}),
    };
}

function toContextUsage(turn: PiTurnUsage): QaapAgentContextUsage {
    return {
        inputTokens: turn.inputTokens,
        outputTokens: turn.outputTokens,
        ...(turn.cacheWriteTokens > 0 ? { cacheCreationInputTokens: turn.cacheWriteTokens } : {}),
        ...(turn.cacheReadTokens > 0 ? { cacheReadInputTokens: turn.cacheReadTokens } : {}),
    };
}

function nonNegative(value: number | undefined): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function stringifyArgs(args: unknown): string {
    return args === undefined ? '{}' : JSON.stringify(args);
}

/** Text of a Pi tool result: the text blocks of its content, joined. */
function contentText(result: unknown): string | undefined {
    if (typeof result !== 'object' || result === null) {
        return undefined;
    }
    const content = (result as { readonly content?: unknown }).content;
    if (!Array.isArray(content)) {
        return undefined;
    }
    const text = (content as PiJsonContentBlock[])
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('');
    return text;
}

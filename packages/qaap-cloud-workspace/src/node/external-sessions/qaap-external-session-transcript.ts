// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapTranscriptTraceEventDTO } from '@theia/qaap-shared-core/lib/common/qaap-transcript-trace-model';
import { QAAP_TASK_CONTEXT_MARKER } from '../../common/qaap-agent-task-context';

/** A message of an external CLI session, mapped to the shape of a Qaap conversation message. */
export interface QaapExternalImportedMessage {
    readonly role: 'user' | 'agent';
    readonly content: string;
    readonly createdAt: number;
    /** Agent messages: when the turn's last item was logged (the transcript's "Processed in" end). */
    readonly finishedAt?: number;
    readonly traceEvents?: QaapTranscriptTraceEventDTO[];
}

/** What a listing needs from one session log. */
export interface QaapExternalSessionHeader {
    readonly sessionId: string;
    readonly cwd: string;
    readonly title: string;
    readonly firstUserMessage: string;
    readonly startedAt: number;
    readonly updatedAt: number;
    readonly originator?: string;
    /** The session was started by Qaap itself (its first prompt carries Qaap's markers). Hidden from the list. */
    readonly startedByQaap: boolean;
}

export interface QaapExternalSessionTranscript {
    readonly header: QaapExternalSessionHeader;
    readonly messages: readonly QaapExternalImportedMessage[];
}

export namespace QaapExternalSessionText {

    /** Longest tool result kept per call; imported logs can hold megabytes of command output. */
    export const MAX_TOOL_RESULT_CHARS = 8_000;
    export const MAX_TOOL_ARGS_CHARS = 4_000;
    /** Longest first-message preview in a listing. */
    export const MAX_PREVIEW_CHARS = 280;
    /** Most recent messages kept per import. */
    export const MAX_IMPORTED_MESSAGES = 400;

    const QAAP_PROMPT_MARKERS = [QAAP_TASK_CONTEXT_MARKER, '[Qaap interaction-mode system instruction]'];

    export function truncate(text: string, max: number): string {
        return text.length > max ? `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]` : text;
    }

    export function preview(text: string): string {
        const collapsed = text.replace(/\s+/g, ' ').trim();
        return collapsed.length > MAX_PREVIEW_CHARS ? `${collapsed.slice(0, MAX_PREVIEW_CHARS - 1)}…` : collapsed;
    }

    export function isStartedByQaap(firstUserMessage: string): boolean {
        return QAAP_PROMPT_MARKERS.some(marker => firstUserMessage.includes(marker));
    }

    /** Arguments as the transcript's tool rows expect them: a JSON string. */
    export function stringifyArgs(value: unknown): string {
        if (typeof value === 'string') {
            return truncate(value, MAX_TOOL_ARGS_CHARS);
        }
        try {
            return truncate(JSON.stringify(value ?? {}), MAX_TOOL_ARGS_CHARS);
        } catch {
            return '{}';
        }
    }

    /** Text out of a string or an array of `{ type: 'text', text }` blocks (other block types are skipped). */
    export function textOf(value: unknown): string {
        if (typeof value === 'string') {
            return value;
        }
        if (!Array.isArray(value)) {
            return '';
        }
        return value
            .map(block => typeof block === 'object' && block !== null && typeof (block as { text?: unknown }).text === 'string'
                ? (block as { text: string }).text
                : '')
            .filter(text => text.length > 0)
            .join('\n');
    }
}

/**
 * Folds the items of a CLI log, in order, into user messages and agent messages. Every assistant item between
 * two user turns lands in ONE agent message (its `traceEvents`), the way a native Qaap turn is stored.
 */
export class QaapExternalTranscriptBuilder {

    protected readonly messages: QaapExternalImportedMessage[] = [];
    protected agent: { createdAt: number; finishedAt: number; events: QaapTranscriptTraceEventDTO[] } | undefined;
    protected readonly toolIndex = new Map<string, number>();
    protected ordinal = 0;

    addUser(text: string, createdAt: number): void {
        const content = text.trim();
        if (!content) {
            return;
        }
        this.flushAgent();
        this.messages.push({ role: 'user', content, createdAt });
    }

    addAssistantText(text: string, createdAt: number): void {
        if (!text.trim()) {
            return;
        }
        this.ensureAgent(createdAt).events.push({ type: 'assistant_text', id: this.nextId('text'), content: text, status: 'completed' });
    }

    addThought(text: string, createdAt: number): void {
        if (!text.trim()) {
            return;
        }
        this.ensureAgent(createdAt).events.push({
            type: 'thought', id: this.nextId('thought'), content: text, status: 'completed', startedAt: createdAt, finishedAt: createdAt,
        });
    }

    /** Starts a tool call. `id` pairs it with {@link finishTool}; a missing id gets a generated one. */
    startTool(id: string | undefined, name: string, args: unknown, createdAt: number): void {
        const agent = this.ensureAgent(createdAt);
        const toolId = id || this.nextId('tool');
        this.toolIndex.set(toolId, agent.events.length);
        agent.events.push({
            type: 'tool_call',
            id: toolId,
            name: name || 'tool',
            args: QaapExternalSessionText.stringifyArgs(args),
            status: 'completed',
            startedAt: createdAt,
        });
    }

    /** Attaches the result to the call started with `id`. Unknown ids are ignored (the call was cut off). */
    finishTool(id: string | undefined, result: string, failed: boolean, finishedAt: number): void {
        if (!id || !this.agent) {
            return;
        }
        const index = this.toolIndex.get(id);
        const event = index === undefined ? undefined : this.agent.events[index];
        if (!event || event.type !== 'tool_call') {
            return;
        }
        this.agent.events[index!] = {
            ...event,
            status: failed ? 'failed' : 'completed',
            result: QaapExternalSessionText.truncate(result, QaapExternalSessionText.MAX_TOOL_RESULT_CHARS),
            finishedAt,
        };
        this.agent.finishedAt = Math.max(this.agent.finishedAt, finishedAt);
    }

    /** The messages, the last {@link QaapExternalSessionText.MAX_IMPORTED_MESSAGES} at most, starting on a user turn. */
    build(maxMessages = QaapExternalSessionText.MAX_IMPORTED_MESSAGES): QaapExternalImportedMessage[] {
        this.flushAgent();
        let kept = this.messages.length > maxMessages ? this.messages.slice(-maxMessages) : [...this.messages];
        const firstUser = kept.findIndex(message => message.role === 'user');
        kept = firstUser > 0 ? kept.slice(firstUser) : kept;
        return kept;
    }

    protected ensureAgent(createdAt: number): { createdAt: number; finishedAt: number; events: QaapTranscriptTraceEventDTO[] } {
        if (!this.agent) {
            this.agent = { createdAt, finishedAt: createdAt, events: [] };
            this.toolIndex.clear();
        }
        this.agent.finishedAt = Math.max(this.agent.finishedAt, createdAt);
        return this.agent;
    }

    protected flushAgent(): void {
        const agent = this.agent;
        this.agent = undefined;
        this.toolIndex.clear();
        if (!agent || agent.events.length === 0) {
            return;
        }
        const content = agent.events
            .flatMap(event => event.type === 'assistant_text' ? [event.content] : [])
            .join('\n\n');
        this.messages.push({ role: 'agent', content, createdAt: agent.createdAt, finishedAt: agent.finishedAt, traceEvents: agent.events });
    }

    protected nextId(kind: string): string {
        return `import-${kind}-${this.ordinal++}`;
    }
}

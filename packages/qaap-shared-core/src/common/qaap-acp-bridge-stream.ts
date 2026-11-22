// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgUiEvent } from './qaap-ag-ui-transcript-adapter';
import type { QaapAgentContextUsage } from './qaap-agent-context-usage';
import { QaapQaiqStreamAccumulator, type QaapAgentMessageSegment } from './qaap-qaiq-stream';
import { QaapQaiqAgUiStreamEmitter } from './qaap-qaiq-ag-ui-stream';
import type { QaapTranscriptTraceEventDTO } from './qaap-transcript-trace-model';

/**
 * Logs of a harness that ran through the Qaap ACP bridge (`qaap-acp-bridge.mjs` in qaap-cloud-workspace) are Claude
 * stream-json whatever the agent id. The same agent id can produce its native format or the bridge's (the bridge is
 * a per-harness flag), so readers decide by content, not by id.
 *
 * The decision cannot rest on the bridge's init line alone: the log readers drop `system/init` lines
 * (`filterQaiqStreamProcessLogLines`) and the task log is read from its tail when it is large. It rests on the first
 * JSON line with a `type`: Claude stream-json uses `stream_event` / `assistant` / `user` / `result` (and `system`),
 * which OpenCode's native `--format json` never does (`text`, `reasoning`, `tool_use`, `step_start`, `step_finish`,
 * `error`). Plain-text lines (Qaap notes, `…(truncated)`) are skipped.
 */
const CLAUDE_STREAM_TYPES = new Set(['stream_event', 'assistant', 'user', 'result']);

/** Characters buffered before giving up on finding a typed JSON line and using the native reader. */
const MAX_UNDECIDED_CHARS = 256 * 1024;

/** 'acp' for a line of the bridge's stream, 'native' for any other typed JSON line, undefined when the line says nothing. */
export function classifyQaapAcpBridgeLine(line: string): 'acp' | 'native' | undefined {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
        return undefined;
    }
    let parsed: { type?: unknown; qaap_transport?: unknown };
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
        return undefined;
    }
    if (CLAUDE_STREAM_TYPES.has(parsed.type) || (parsed.type === 'system' && parsed.qaap_transport === 'acp')) {
        return 'acp';
    }
    return 'native';
}

/** True when the first typed JSON line of a log belongs to the bridge's stream. */
export function isQaapAcpBridgeLog(log: string): boolean {
    for (const line of log.split('\n')) {
        const kind = classifyQaapAcpBridgeLine(line);
        if (kind) {
            return kind === 'acp';
        }
    }
    return false;
}

/** Decision over a growing buffer: 'acp' / 'native' once known, undefined while only untyped lines arrived. */
function decide(buffer: string, final: boolean): 'acp' | 'native' | undefined {
    const lines = buffer.split('\n');
    // The last piece may be a partial line; it only counts once the stream ended.
    const complete = final ? lines : lines.slice(0, -1);
    for (const line of complete) {
        const kind = classifyQaapAcpBridgeLine(line);
        if (kind) {
            return kind;
        }
    }
    // `common/` also runs in the browser: no Buffer here.
    return buffer.length > MAX_UNDECIDED_CHARS ? 'native' : undefined;
}

/** Minimal shape of a live parser, structurally equal to `QaapAgentStreamAccumulator`. */
interface QaapSniffedStreamAccumulator {
    push(chunk: string): readonly QaapAgentMessageSegment[];
    getSegments(): readonly QaapAgentMessageSegment[];
    getDisplayText(): string;
    getTraceEvents(): readonly QaapTranscriptTraceEventDTO[];
    getTurnUsage?(): QaapAgentContextUsage | undefined;
}

/**
 * Live parser that buffers until the first typed JSON line, then hands the whole stream to the Claude parser (bridge
 * stream) or to the harness's native parser. While undecided, getters answer as the native parser would for what
 * arrived so far.
 */
export class QaapAcpSniffingStreamAccumulator<T extends QaapSniffedStreamAccumulator> implements QaapSniffedStreamAccumulator {

    protected pending = '';
    protected delegate: QaapSniffedStreamAccumulator | undefined;

    constructor(protected readonly createNative: () => T) { }

    /** True once the stream was recognized as the bridge's. */
    get isAcpBridge(): boolean {
        return this.delegate instanceof QaapQaiqStreamAccumulator;
    }

    push(chunk: string): readonly QaapAgentMessageSegment[] {
        if (this.delegate) {
            return this.delegate.push(chunk);
        }
        this.pending += chunk;
        const kind = decide(this.pending, false);
        if (!kind) {
            return [];
        }
        this.delegate = kind === 'acp' ? new QaapQaiqStreamAccumulator() : this.createNative();
        const buffered = this.pending;
        this.pending = '';
        return this.delegate.push(buffered);
    }

    protected current(): QaapSniffedStreamAccumulator {
        if (this.delegate) {
            return this.delegate;
        }
        const kind = decide(this.pending, true);
        const reader = kind === 'acp' ? new QaapQaiqStreamAccumulator() : this.createNative();
        reader.push(this.pending);
        return reader;
    }

    getSegments(): readonly QaapAgentMessageSegment[] {
        return this.current().getSegments();
    }

    getDisplayText(): string {
        return this.current().getDisplayText();
    }

    getTraceEvents(): readonly QaapTranscriptTraceEventDTO[] {
        return this.current().getTraceEvents();
    }

    getTurnUsage(): QaapAgentContextUsage | undefined {
        return this.current().getTurnUsage?.();
    }
}

interface QaapSniffedAgUiEmitter {
    push(chunk: string): QaapAgUiEvent[];
}

/** AG-UI counterpart of {@link QaapAcpSniffingStreamAccumulator}. */
export class QaapAcpSniffingAgUiEmitter implements QaapSniffedAgUiEmitter {

    protected pending = '';
    protected delegate: QaapSniffedAgUiEmitter | undefined;

    constructor(protected readonly createNative: () => QaapSniffedAgUiEmitter) { }

    push(chunk: string): QaapAgUiEvent[] {
        if (this.delegate) {
            return this.delegate.push(chunk);
        }
        this.pending += chunk;
        const kind = decide(this.pending, false);
        if (!kind) {
            return [];
        }
        this.delegate = kind === 'acp' ? new QaapQaiqAgUiStreamEmitter() : this.createNative();
        const buffered = this.pending;
        this.pending = '';
        return this.delegate.push(buffered);
    }
}

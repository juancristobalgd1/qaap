// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgUiEvent } from './qaap-ag-ui-transcript-adapter';
import type { QaapAgentContextUsage } from './qaap-agent-context-usage';
import type { QaapAgentMessageSegment } from './qaap-qaiq-stream';
import { QaapQaiqStreamAccumulator } from './qaap-qaiq-stream';
import { QaapQaiqAgUiStreamEmitter } from './qaap-qaiq-ag-ui-stream';
import type { QaapTranscriptTraceEventDTO } from './qaap-transcript-trace-model';

/**
 * Logs of a harness that ran through the Qaap ACP bridge (`qaap-acp-bridge.mjs` in qaap-cloud-workspace) are
 * Claude stream-json whatever the agent id, and start with this init line. The same agent id can produce its native
 * format or the bridge's (the bridge is per-harness flag), so readers decide by the first line, not by the id.
 */
export function isQaapAcpBridgeLogLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.includes('"qaap_transport"')) {
        return false;
    }
    try {
        const parsed = JSON.parse(trimmed) as { type?: unknown; qaap_transport?: unknown };
        return parsed.type === 'system' && parsed.qaap_transport === 'acp';
    } catch {
        return false;
    }
}

/** True when the first non-empty line of a full log is the bridge's init line. */
export function isQaapAcpBridgeLog(log: string): boolean {
    for (const line of log.split('\n')) {
        if (line.trim()) {
            return isQaapAcpBridgeLogLine(line);
        }
    }
    return false;
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
 * Live parser that waits for the first complete line, then hands the whole stream to the Claude parser (bridge log)
 * or to the harness's native parser. Before the first line it reports nothing.
 */
export class QaapAcpSniffingStreamAccumulator<T extends QaapSniffedStreamAccumulator> implements QaapSniffedStreamAccumulator {

    protected pending = '';
    protected delegate: QaapSniffedStreamAccumulator | undefined;

    constructor(protected readonly createNative: () => T) { }

    /** True once the stream was recognized as a bridge log. */
    get isAcpBridge(): boolean {
        return this.delegate instanceof QaapQaiqStreamAccumulator;
    }

    push(chunk: string): readonly QaapAgentMessageSegment[] {
        if (this.delegate) {
            return this.delegate.push(chunk);
        }
        this.pending += chunk;
        const newline = this.pending.indexOf('\n');
        const firstLine = this.pending.slice(0, newline < 0 ? undefined : newline);
        if (newline < 0 && !(firstLine.trim() && !firstLine.trim().startsWith('{'))) {
            return [];
        }
        this.delegate = isQaapAcpBridgeLogLine(firstLine) ? new QaapQaiqStreamAccumulator() : this.createNative();
        const buffered = this.pending;
        this.pending = '';
        return this.delegate.push(buffered);
    }

    getSegments(): readonly QaapAgentMessageSegment[] {
        return this.delegate?.getSegments() ?? [];
    }

    getDisplayText(): string {
        return this.delegate?.getDisplayText() ?? '';
    }

    getTraceEvents(): readonly QaapTranscriptTraceEventDTO[] {
        return this.delegate?.getTraceEvents() ?? [];
    }

    getTurnUsage(): QaapAgentContextUsage | undefined {
        return this.delegate?.getTurnUsage?.();
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
        const newline = this.pending.indexOf('\n');
        const firstLine = this.pending.slice(0, newline < 0 ? undefined : newline);
        if (newline < 0 && !(firstLine.trim() && !firstLine.trim().startsWith('{'))) {
            return [];
        }
        this.delegate = isQaapAcpBridgeLogLine(firstLine) ? new QaapQaiqAgUiStreamEmitter() : this.createNative();
        const buffered = this.pending;
        this.pending = '';
        return this.delegate.push(buffered);
    }
}

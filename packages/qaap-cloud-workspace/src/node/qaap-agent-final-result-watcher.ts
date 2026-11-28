// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { parseQaapClaudeResultUsage, parseQaapOpenCodeStepUsage, type QaapTurnUsage } from '../common/qaap-turn-usage';

/** The final `{"type":"result"}` event of a stream-json turn. */
export interface QaapAgentFinalResult {
    readonly isError: boolean;
    /** The turn's usage as the CLI reported it in the same event; absent when the event carries none. */
    readonly usage?: QaapTurnUsage;
}

/**
 * Watches a stream-json stdout (Claude Code, OpenClaude) for the turn's final `result` event.
 * The answer is complete at that point; the CLI may still spend a long time exiting (telemetry,
 * auto-update checks behind the egress allowlist), which kept the turn showing as working.
 */
export class QaapAgentFinalResultWatcher {

    protected buffer = '';
    protected found: QaapAgentFinalResult | undefined;

    /** Feeds a stdout chunk; returns the result once it has been seen. */
    push(chunk: string): QaapAgentFinalResult | undefined {
        if (this.found) {
            return this.found;
        }
        this.buffer += chunk;
        let newline = this.buffer.indexOf('\n');
        while (newline >= 0) {
            const line = this.buffer.slice(0, newline).trim();
            this.buffer = this.buffer.slice(newline + 1);
            const result = parseFinalResultLine(line);
            if (result) {
                this.found = result;
                this.buffer = '';
                return result;
            }
            newline = this.buffer.indexOf('\n');
        }
        // A single huge line must not grow without bound: a result line is short.
        if (this.buffer.length > 1_000_000) {
            this.buffer = '';
        }
        return undefined;
    }

    get result(): QaapAgentFinalResult | undefined {
        return this.found;
    }
}

function parseFinalResultLine(line: string): QaapAgentFinalResult | undefined {
    if (!line.startsWith('{') || !line.includes('"result"')) {
        return undefined;
    }
    try {
        const record = JSON.parse(line) as { type?: unknown; is_error?: unknown; subtype?: unknown };
        if (record.type !== 'result') {
            return undefined;
        }
        const usage = parseQaapClaudeResultUsage(line);
        return {
            isError: record.is_error === true || (typeof record.subtype === 'string' && record.subtype.startsWith('error')),
            ...(usage ? { usage } : {}),
        };
    } catch {
        return undefined;
    }
}

/** How long a CLI may keep running after its final result before Qaap ends it. */
export const QAAP_AGENT_EXIT_AFTER_RESULT_GRACE_MS = 8_000;

/** How long OpenCode may linger silently after `step_finish` (`reason: "stop"`) before Qaap ends it. */
export const QAAP_OPENCODE_EXIT_AFTER_STOP_GRACE_MS = 12_000;

/** Harnesses whose stdout is Claude-style stream-json with a final `result` event. */
export function emitsStreamJsonFinalResult(agentId: string | undefined): boolean {
    const id = agentId?.trim().toLowerCase();
    return id === 'claude' || id === 'openclaude';
}

export type QaapOpencodeFinalStepEvent =
    | { readonly kind: 'final'; readonly result: QaapAgentFinalResult }
    | { readonly kind: 'activity' };

/**
 * Watches `opencode run --format json` stdout for a terminal `step_finish` (`reason: "stop"`).
 * OpenCode can linger after finishing a turn (background LSP/MCP/server handles) while the answer
 * is already complete; any subsequent non-stop event cancels the grace timer so multi-step turns
 * are never cut short.
 */
export class QaapOpencodeFinalStepWatcher {

    protected buffer = '';
    protected pendingFinal: QaapAgentFinalResult | undefined;

    push(chunk: string): QaapOpencodeFinalStepEvent | undefined {
        this.buffer += chunk;
        let event: QaapOpencodeFinalStepEvent | undefined;
        let newline = this.buffer.indexOf('\n');
        while (newline >= 0) {
            const line = this.buffer.slice(0, newline).trim();
            this.buffer = this.buffer.slice(newline + 1);
            const parsed = parseOpencodeLine(line);
            if (parsed?.kind === 'final') {
                this.pendingFinal = parsed.result;
                event = parsed;
            } else if (parsed?.kind === 'activity' && this.pendingFinal) {
                this.pendingFinal = undefined;
                event = parsed;
            }
            newline = this.buffer.indexOf('\n');
        }
        if (this.buffer.length > 1_000_000) {
            this.buffer = '';
        }
        return event;
    }

    get result(): QaapAgentFinalResult | undefined {
        return this.pendingFinal;
    }
}

function parseOpencodeLine(line: string): QaapOpencodeFinalStepEvent | undefined {
    if (!line.startsWith('{')) {
        return undefined;
    }
    try {
        const record = JSON.parse(line) as { type?: unknown; reason?: unknown; part?: { reason?: unknown } };
        if (record.type === 'step_finish') {
            const reason = typeof record.part?.reason === 'string'
                ? record.part.reason
                : typeof record.reason === 'string'
                    ? record.reason
                    : undefined;
            if (reason === 'stop') {
                const usage = parseQaapOpenCodeStepUsage(line);
                return {
                    kind: 'final',
                    result: { isError: false, ...(usage ? { usage } : {}) },
                };
            }
            return { kind: 'activity' };
        }
        if (record.type === 'step_start' || record.type === 'tool_use' || record.type === 'text') {
            return { kind: 'activity' };
        }
        return undefined;
    } catch {
        return undefined;
    }
}

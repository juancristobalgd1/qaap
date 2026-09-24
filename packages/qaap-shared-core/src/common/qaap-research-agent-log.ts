// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Structured envelope shapes this module recognizes. QAIQ / Claude Code's
 * `--output-format stream-json` emits one JSON object per line; the assistant's actual prose is
 * buried inside `stream_event.event.delta.text` (token-level deltas) or `assistant.message.content[]`
 * (full-message snapshots) — never as a bare fenced code block the way a plain-text agent log would
 * have it. `result.result` is a last-resort fallback for agents that only emit a final summary (it is
 * frequently empty for QAIQ/Claude, which streams everything via deltas instead).
 */
interface StreamEnvelope {
    readonly type?: string;
    readonly event?: {
        readonly type?: string;
        readonly delta?: {
            readonly type?: string;
            readonly text?: string;
        };
    };
    readonly message?: {
        readonly content?: unknown;
    };
    readonly result?: string;
}

interface ContentTextBlock {
    readonly type?: string;
    readonly text?: string;
}

/**
 * Extracts the assistant-authored prose out of an agent task log, so callers like
 * {@link parseExperimentProposal} can find a `[QAAP experiment]` block that would otherwise be
 * buried — and JSON-escaped — inside a stream-json envelope.
 *
 * Two log shapes are supported, line by line:
 * - **stream-json** (QAIQ / Claude Code `--output-format stream-json`): each line is parsed as
 *   JSON. Text is pulled from the known assistant-bearing shapes (`stream_event` text deltas,
 *   `assistant` message snapshots, non-empty `result`) and everything else — `system`, `user`,
 *   tool_use/tool_result envelopes — is ignored.
 * - **plain text** (the other ~13 agents whose stdout is not structured JSON at all): a line that
 *   fails to parse as a JSON object is kept verbatim, so this function is a safe passthrough for
 *   agents that never speak stream-json in the first place.
 *
 * Never throws: malformed JSON on a line just falls back to treating that line as plain text.
 */
export function extractAgentTextFromLog(log: string): string {
    let result = '';
    const appendDirect = (text: string): void => {
        result += text;
    };
    const appendLine = (text: string): void => {
        if (result && !result.endsWith('\n')) {
            result += '\n';
        }
        result += text;
    };

    for (const line of log.split('\n')) {
        if (!line.trim()) {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(line.trim());
        } catch {
            // Not a JSON envelope at all — this is a plain-text agent log line, keep it as-is.
            appendLine(line);
            continue;
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            appendLine(line);
            continue;
        }
        const envelope = parsed as StreamEnvelope;
        if (typeof envelope.type !== 'string') {
            // Valid JSON, but not shaped like a stream-json envelope (no `type` discriminator) —
            // e.g. a plain-text agent log line that happens to itself be JSON (a compact fenced
            // `[QAAP experiment]` block, a metric script's JSON output, ...). Keep it verbatim
            // rather than silently swallowing content real stream envelopes never contain anyway.
            appendLine(line);
            continue;
        }
        appendStructuredEnvelopeText(envelope, appendDirect, appendLine);
    }
    return result;
}

interface ResultEnvelope {
    readonly type?: string;
    readonly is_error?: boolean;
    readonly result?: string;
}

/**
 * Extracts the agent CLI's own terminal error message from a stream-json log — e.g. an
 * authentication failure that makes the CLI print `{"type":"result","is_error":true,"result":
 * "Failed to authenticate: ..."}` and exit 0, having done nothing. This is a THIRD round outcome
 * the runner must not confuse with either an infra failure (non-zero exit) or a no-op (the agent
 * ran but changed nothing): see `qaap-research-runner.ts`'s BUG 1 fix, which routes this straight
 * to an infra-failure verdict instead of letting it masquerade as "(no file changes detected)".
 *
 * Scans every line for a `result`-type envelope with `is_error: true` and returns its `result`
 * text (or a generic fallback when that field is empty); returns `undefined` when the turn
 * actually succeeded, or for plain-text agent logs that never emit stream-json at all. Never
 * throws: malformed JSON lines are simply skipped.
 */
export function extractAgentTurnError(log: string): string | undefined {
    let lastError: string | undefined;
    for (const line of log.split('\n')) {
        if (!line.trim()) {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(line.trim());
        } catch {
            continue;
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            continue;
        }
        const envelope = parsed as ResultEnvelope;
        if (envelope.type !== 'result' || !envelope.is_error) {
            continue;
        }
        lastError = envelope.result && envelope.result.trim() ? envelope.result.trim() : 'agent turn failed (no error message provided)';
    }
    return lastError;
}

function appendStructuredEnvelopeText(
    envelope: StreamEnvelope,
    appendDirect: (text: string) => void,
    appendLine: (text: string) => void,
): void {
    switch (envelope.type) {
        case 'stream_event': {
            const event = envelope.event;
            if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                const text = event.delta.text;
                if (typeof text === 'string' && text) {
                    // Token-level deltas of the SAME continuous string — concatenate directly,
                    // never inject a separator, or a mid-string split would corrupt the JSON
                    // fenced block the deltas are reassembling.
                    appendDirect(text);
                }
            }
            return;
        }
        case 'assistant': {
            const content = envelope.message?.content;
            if (!Array.isArray(content)) {
                return;
            }
            for (const block of content as ContentTextBlock[]) {
                if (block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string' && block.text) {
                    appendLine(block.text);
                }
            }
            return;
        }
        case 'result': {
            const text = envelope.result;
            if (typeof text === 'string' && text.trim()) {
                appendLine(text);
            }
            return;
        }
        default:
            // system / user / tool_use / tool_result / anything else: no assistant prose here.
            return;
    }
}

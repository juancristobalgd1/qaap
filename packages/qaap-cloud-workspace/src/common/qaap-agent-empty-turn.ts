// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Detects an agent turn that produced NOTHING — no tool ever ran and the final message is empty.
 *
 * Every other gate in the runner is diff-centric (`hasEditedFilesForVerification`), so a turn that
 * edits no files skips verification and review and closes as `completed`. That is correct for a
 * question ("what does this file do?"), but it also waves through the failure mode observed live:
 * a weak model emits its tool call as plain TEXT (`{"type": "function", "name": "Edit", …}`),
 * executes nothing, and exits 0 with an empty result. The graph then reported `succeeded` on a task
 * where the bug was still there.
 *
 * The signal is deliberately narrow, because a false positive would flag honest work:
 * - a turn that ran any tool is never empty, whatever it wrote;
 * - a turn that answered in prose is never empty, even with no tools;
 * - anything we cannot parse (unknown CLI format, truncated log) is never empty — fail open.
 */

/** Bytes of `result` text we keep in the summary, so a huge blob cannot reach the task index. */
const MAX_SUMMARY_CHARS = 200;

export interface QaapEmptyAgentTurnResult {
    readonly empty: boolean;
    /** Human-readable reason, suitable for a verification summary. Only set when `empty`. */
    readonly reason?: string;
}

export interface QaapEmptyAgentTurnOptions {
    /**
     * Whether `log` is the WHOLE log. A tail could hide the tool calls that happened earlier, so a
     * truncated log is never judged empty.
     */
    readonly complete?: boolean;
}

const NOT_EMPTY: QaapEmptyAgentTurnResult = { empty: false };

/**
 * @param log raw agent stdout/stderr (JSONL for the claude-code stream format).
 */
export function detectEmptyAgentTurn(
    log: string | undefined,
    options: QaapEmptyAgentTurnOptions = {},
): QaapEmptyAgentTurnResult {
    if (!log?.trim() || options.complete === false) {
        return NOT_EMPTY;
    }
    let sawResult = false;
    let resultText = '';
    for (const line of log.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) {
            continue;
        }
        // A tool call anywhere in the turn means work happened; no need to parse the rest.
        if (trimmed.includes('"tool_use"') || trimmed.includes('"tool_result"')) {
            return NOT_EMPTY;
        }
        let parsed: { readonly type?: unknown; readonly result?: unknown };
        try {
            parsed = JSON.parse(trimmed) as typeof parsed;
        } catch {
            continue;
        }
        if (parsed.type === 'result') {
            sawResult = true;
            // Later result records win: the last one is the turn's actual final message.
            resultText = typeof parsed.result === 'string' ? parsed.result : '';
        }
    }
    if (!sawResult) {
        // No terminal record: either a CLI whose format we do not parse, or a log we cannot trust.
        return NOT_EMPTY;
    }
    if (resultText.trim().length > 0) {
        return NOT_EMPTY;
    }
    return {
        empty: true,
        reason: 'The agent ran no tools and produced no final message, so nothing was done. '
            + 'This is the signature of a backend that emitted its tool call as plain text instead of invoking it.',
    };
}

/**
 * The turn's final visible message, or '' when the log carries no terminal record. Reads the same
 * `result` field {@link detectEmptyAgentTurn} judges, so "empty turn" and "nothing to hand on to
 * the next node" can never disagree.
 */
export function extractAgentFinalMessage(log: string | undefined): string {
    if (!log?.trim()) {
        return '';
    }
    let final = '';
    for (const line of log.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{') || !trimmed.includes('"result"')) {
            continue;
        }
        try {
            const parsed = JSON.parse(trimmed) as { readonly type?: unknown; readonly result?: unknown };
            if (parsed.type === 'result' && typeof parsed.result === 'string') {
                final = parsed.result;
            }
        } catch {
            continue;
        }
    }
    return final;
}

/** Shortened `result` text for diagnostics, never the whole blob. */
export function summarizeAgentResultText(text: string): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    return normalized.length > MAX_SUMMARY_CHARS ? `${normalized.slice(0, MAX_SUMMARY_CHARS)}…` : normalized;
}

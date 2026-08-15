// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { parseOpencodeFormattedLog, parseOpencodeLog, QaapOpencodeStreamAccumulator } from '../common/qaap-opencode-stream';
import type { QaapAgentMessageSegment } from '../common/qaap-qaiq-stream';

/** Match server `MAX_LOG_BYTES` — keep a bounded live tail in the Working DETAIL panel. */
export const WORKING_DETAIL_TASK_LOG_MAX_BYTES = 512 * 1024;

/** Stay pinned to the bottom when the user is within this distance of the end. */
export const WORKING_DETAIL_TASK_LOG_AUTO_SCROLL_THRESHOLD_PX = 48;

export const WORKING_DETAIL_TASK_LOG_CLASS = 'qaap-working-agents-detail-command-log';
export const WORKING_DETAIL_TASK_LOG_OUTPUT_CLASS = 'qaap-working-agents-detail-command-log-output';

export interface WorkingDetailTaskLogBufferState {
    readonly text: string;
    readonly truncated: boolean;
}

/**
 * Append a stdout/stderr chunk and keep only the trailing {@link maxBytes}.
 * Uses UTF-16 code units as a practical byte budget for UI buffering.
 */
export function appendWorkingDetailTaskLogChunk(
    previous: string,
    chunk: string,
    maxBytes: number = WORKING_DETAIL_TASK_LOG_MAX_BYTES,
): WorkingDetailTaskLogBufferState {
    if (!chunk) {
        return { text: previous, truncated: previous.length > maxBytes };
    }
    const merged = previous ? previous + chunk : chunk;
    if (merged.length <= maxBytes) {
        return { text: merged, truncated: false };
    }
    return {
        text: merged.slice(merged.length - maxBytes),
        truncated: true,
    };
}

/** Replace the buffer with a seeded server log tail (open DETAIL mid-run). */
export function seedWorkingDetailTaskLog(
    log: string,
    maxBytes: number = WORKING_DETAIL_TASK_LOG_MAX_BYTES,
): WorkingDetailTaskLogBufferState {
    if (!log) {
        return { text: '', truncated: false };
    }
    if (log.length <= maxBytes) {
        return { text: log, truncated: false };
    }
    return {
        text: log.slice(log.length - maxBytes),
        truncated: true,
    };
}

/** True when the scroll host is near the bottom (or has no overflow yet). */
export function isWorkingDetailTaskLogNearBottom(
    host: HTMLElement,
    thresholdPx: number = WORKING_DETAIL_TASK_LOG_AUTO_SCROLL_THRESHOLD_PX,
): boolean {
    const remaining = host.scrollHeight - host.scrollTop - host.clientHeight;
    return remaining <= thresholdPx;
}

export function scrollWorkingDetailTaskLogToBottom(host: HTMLElement): void {
    host.scrollTop = host.scrollHeight;
}

export interface RenderWorkingDetailTaskLogOptions {
    readonly taskId: string;
    readonly text?: string;
    readonly running?: boolean;
    readonly truncated?: boolean;
    /** True while HTTP seed is in flight and no chunks have arrived yet. */
    readonly loading?: boolean;
}

/** Cursor-style terminal card for VPS command output inside Working DETAIL. */
export function renderWorkingDetailTaskLog(options: RenderWorkingDetailTaskLogOptions): HTMLElement {
    const root = document.createElement('div');
    root.className = WORKING_DETAIL_TASK_LOG_CLASS;
    root.dataset.taskId = options.taskId;
    applyWorkingDetailTaskLogMeta(root, options);

    const header = document.createElement('div');
    header.className = 'qaap-working-agents-detail-command-log-header';

    const label = document.createElement('div');
    label.className = 'qaap-working-agents-detail-command-log-label';
    label.textContent = nls.localize(
        'qaap/workHubChrome/workingDetailCommandOutput',
        'Command output',
    );

    const live = document.createElement('span');
    live.className = 'qaap-working-agents-detail-command-log-live';
    live.setAttribute('aria-hidden', 'true');
    live.textContent = nls.localize('qaap/workHubChrome/workingDetailCommandOutputLive', 'Live');

    header.append(label, live);

    const output = document.createElement('pre');
    output.className = WORKING_DETAIL_TASK_LOG_OUTPUT_CLASS;
    output.setAttribute('role', 'log');
    output.setAttribute('aria-live', options.running === false ? 'off' : 'polite');
    output.setAttribute('aria-relevant', 'additions');
    applyWorkingDetailTaskLogText(output, {
        text: options.text ?? '',
        truncated: options.truncated === true,
        running: options.running !== false,
        loading: options.loading === true,
    });

    root.append(header, output);
    return root;
}

export function findWorkingDetailTaskLog(root: ParentNode): HTMLElement | undefined {
    const el = root.querySelector(`.${WORKING_DETAIL_TASK_LOG_CLASS}`);
    return el instanceof HTMLElement ? el : undefined;
}

export function findWorkingDetailTaskLogOutput(root: ParentNode): HTMLElement | undefined {
    const el = root.querySelector(`.${WORKING_DETAIL_TASK_LOG_OUTPUT_CLASS}`);
    return el instanceof HTMLElement ? el : undefined;
}

/**
 * Patch an existing DETAIL command-log card. Preserves scroll position unless the
 * user was already near the bottom (or the log was empty).
 */
export function updateWorkingDetailTaskLog(
    root: HTMLElement,
    options: {
        readonly text: string;
        readonly running?: boolean;
        readonly truncated?: boolean;
        readonly loading?: boolean;
        readonly forceScrollToBottom?: boolean;
    },
): void {
    applyWorkingDetailTaskLogMeta(root, options);
    const output = findWorkingDetailTaskLogOutput(root);
    if (!output) {
        return;
    }
    const stick = options.forceScrollToBottom === true || isWorkingDetailTaskLogNearBottom(output);
    applyWorkingDetailTaskLogText(output, {
        text: options.text,
        truncated: options.truncated === true,
        running: options.running !== false,
        loading: options.loading === true,
    });
    output.setAttribute('aria-live', options.running === false ? 'off' : 'polite');
    if (stick) {
        scrollWorkingDetailTaskLogToBottom(output);
    }
}

function applyWorkingDetailTaskLogMeta(
    root: HTMLElement,
    options: {
        readonly running?: boolean;
        readonly truncated?: boolean;
        readonly loading?: boolean;
    },
): void {
    const running = options.running !== false;
    root.dataset.state = running ? 'running' : 'idle';
    if (options.loading === true && running) {
        root.dataset.loading = 'true';
    } else {
        delete root.dataset.loading;
    }
    if (options.truncated) {
        root.dataset.truncated = 'true';
    } else {
        delete root.dataset.truncated;
    }
}

function applyWorkingDetailTaskLogText(
    output: HTMLElement,
    options: {
        readonly text: string;
        readonly truncated: boolean;
        readonly running: boolean;
        readonly loading: boolean;
    },
): void {
    const trimmed = options.text.replace(/\s+$/u, '');
    if (!trimmed) {
        const waiting = options.loading || options.running;
        output.textContent = waiting
            ? nls.localize(
                'qaap/workHubChrome/workingDetailCommandOutputWaiting',
                'Waiting for output…',
            )
            : nls.localize(
                'qaap/workHubChrome/workingDetailCommandOutputEmpty',
                'No output',
            );
        output.classList.add('theia-mod-empty');
        output.classList.toggle('theia-mod-waiting', waiting);
        return;
    }
    output.classList.remove('theia-mod-empty', 'theia-mod-waiting');
    const humanReadable = formatVpsTaskLogForHuman(trimmed);
    if (!humanReadable.trim()) {
        output.textContent = options.running
            ? nls.localize('qaap/mobileProjects/status/working', 'Working')
            : nls.localize(
                'qaap/workHubChrome/workingDetailCommandOutputEmpty',
                'No output',
            );
        output.classList.add('theia-mod-empty');
        output.classList.toggle('theia-mod-waiting', options.running);
        return;
    }
    if (options.truncated) {
        const notice = nls.localize(
            'qaap/workHubChrome/workingDetailCommandOutputTruncated',
            '… earlier output truncated',
        );
        output.textContent = `${notice}\n${humanReadable}`;
        return;
    }
    output.textContent = humanReadable;
}

/**
 * Transform raw VPS task log (JSON stream events, one per line) into human-readable text.
 * Prefers OpenCode NDJSON → transcript segments, then Anthropic-style stream-json, then raw lines.
 */
export function formatVpsTaskLogForHuman(raw: string): string {
    const opencode = parseOpencodeLog(raw);
    if (opencode.segments.length > 0) {
        return formatSegmentsAsTranscriptText(opencode.segments);
    }
    const lines = raw.split('\n');
    const out: string[] = [];
    let sawJson = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        // Try to parse as JSON stream event.
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                const parsed = JSON.parse(trimmed);
                const formatted = formatStreamEventLine(parsed);
                if (formatted) {
                    out.push(formatted);
                    sawJson = true;
                } else {
                    // Recognized JSON wire noise (e.g. step_finish) — do not fall back to raw.
                    sawJson = true;
                }
                continue;
            } catch {
                // Not valid JSON — fall through to keep as raw text.
            }
        }
        // Keep non-JSON lines as-is (shell output, plain text).
        out.push(line);
    }

    // If we didn't find any JSON, return the original text unchanged.
    if (!sawJson) {
        return raw;
    }
    // Prefer a clean transcript; never dump unrecognized wire JSON back to the user.
    return out.join('\n').trim();
}

/** True when the VPS log parses into structured transcript segments (OpenCode / similar). */
export function workingDetailTaskLogHasTranscriptSegments(raw: string | undefined): boolean {
    return parseWorkingDetailTaskLogSegments(raw).length > 0;
}

/**
 * Parse a VPS task log into transcript segments for Working DETAIL.
 * Only returns segments for structured OpenCode NDJSON or formatted CLI tool markers —
 * plain shell tails (test runners, npm, etc.) stay empty so Command output remains.
 */
export function parseWorkingDetailTaskLogSegments(raw: string | undefined): readonly QaapAgentMessageSegment[] {
    const text = raw?.trim();
    if (!text) {
        return [];
    }
    const jsonAcc = new QaapOpencodeStreamAccumulator();
    // Ensure the final NDJSON line is consumed even when the log has no trailing newline.
    jsonAcc.push(text.endsWith('\n') ? text : `${text}\n`);
    if (jsonAcc.consumedJsonEvents()) {
        return [...jsonAcc.getSegments()];
    }
    const formatted = parseOpencodeFormattedLog(text);
    // Formatted fallback treats every prose line as a text segment — that would hide the
    // Command output card for ordinary shell logs. Require at least one tool/thinking cue.
    if (formatted.segments.some(segment => segment.type === 'tool' || segment.type === 'thinking')) {
        return formatted.segments;
    }
    return [];
}

function formatSegmentsAsTranscriptText(segments: readonly QaapAgentMessageSegment[]): string {
    const parts: string[] = [];
    for (const segment of segments) {
        if (segment.type === 'text' && segment.content.trim()) {
            parts.push(segment.content.trim());
        } else if (segment.type === 'thinking' && segment.content.trim()) {
            parts.push(segment.content.trim());
        } else if (segment.type === 'tool') {
            const status = segment.finished ? 'done' : 'running';
            let detail = '';
            try {
                const args = JSON.parse(segment.args || '{}') as Record<string, unknown>;
                const candidate = args.command ?? args.path ?? args.file_path ?? args.pattern ?? args.query;
                if (typeof candidate === 'string' && candidate.trim()) {
                    detail = candidate.trim().length > 120
                        ? `${candidate.trim().slice(0, 117)}…`
                        : candidate.trim();
                }
            } catch {
                /* ignore */
            }
            parts.push(detail ? `→ ${segment.name} (${status}): ${detail}` : `→ ${segment.name} (${status})`);
            if (segment.finished && segment.result?.trim()) {
                const clean = segment.result.replace(/\x1b\[[0-9;]*m/g, '').trim();
                if (clean) {
                    parts.push(clean.length > 400 ? `  ${clean.slice(0, 397)}…` : `  ${clean}`);
                }
            }
        }
    }
    return parts.join('\n');
}

/** Extract a human-readable summary from a single JSON stream event object. */
function formatStreamEventLine(obj: any): string | undefined {
    if (!obj || typeof obj !== 'object') {
        return undefined;
    }

    const type = obj.type;

    // Assistant message — extract text and tool_use content blocks.
    if (type === 'assistant' && obj.message?.content) {
        const blocks = Array.isArray(obj.message.content) ? obj.message.content : [];
        const parts: string[] = [];
        for (const block of blocks) {
            if (block.type === 'text' && block.text?.trim()) {
                parts.push(block.text.trim());
            } else if (block.type === 'tool_use') {
                const toolName = block.name ?? 'tool';
                const input = block.input ?? {};
                // Show a compact summary of the tool call.
                const detail = input.command
                    ?? input.path
                    ?? input.pattern
                    ?? input.prompt
                    ?? input.query
                    ?? input.file_path
                    ?? '';
                const detailStr = typeof detail === 'string' ? detail.trim() : '';
                if (detailStr) {
                    const shortDetail = detailStr.length > 120
                        ? `${detailStr.slice(0, 117).trimEnd()}…`
                        : detailStr;
                    parts.push(`→ ${toolName}: ${shortDetail}`);
                } else {
                    parts.push(`→ ${toolName}`);
                }
            }
        }
        return parts.length > 0 ? parts.join('\n') : undefined;
    }

    // Tool result — show a truncated preview of the output.
    if (type === 'user' && obj.message?.content) {
        const blocks = Array.isArray(obj.message.content) ? obj.message.content : [];
        for (const block of blocks) {
            if (block.type === 'tool_result' && block.content) {
                const content = typeof block.content === 'string'
                    ? block.content
                    : JSON.stringify(block.content);
                const trimmed = content.trim();
                if (!trimmed) {
                    return undefined;
                }
                // Strip ANSI escape codes for readability.
                const clean = trimmed.replace(/\x1b\[[0-9;]*m/g, '');
                // Truncate long results to keep the log scannable.
                if (clean.length > 500) {
                    return `  ${clean.slice(0, 497).trimEnd()}…`;
                }
                return `  ${clean}`;
            }
        }
        return undefined;
    }

    // Final result — show completion status.
    if (type === 'result') {
        const subtype = obj.subtype ?? 'success';
        const icon = subtype === 'success' ? '✓' : subtype === 'error' ? '✗' : '•';
        const resultText = typeof obj.result === 'string' ? obj.result.trim() : '';
        if (resultText) {
            const short = resultText.length > 200
                ? `${resultText.slice(0, 197).trimEnd()}…`
                : resultText;
            return `${icon} ${short}`;
        }
        return `${icon} ${subtype}`;
    }

    // Skip wire-protocol noise: stream_event, control_request, message_start, etc.
    return undefined;
}

/** VPS DETAIL members without a conversation stream command output here. */
export function shouldShowWorkingDetailTaskLog(member: {
    readonly taskId?: string;
    readonly conversationId?: string;
}): boolean {
    return !!member.taskId?.trim() && !member.conversationId?.trim();
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageSegment } from './qaap-qaiq-stream';
import { normalizeQaiqToolName } from './qaap-qaiq-stream';

/** Matches Copilot CLI bulleted tool invocations, e.g. `● preview_start (MC… {"status":"ready"...` or `✓ Read foo.ts`. */
const COPILOT_BULLET_TOOL_LINE = /^(\s*)[●○✓✗✕]\s+(.+)$/u;

/** Matches Copilot CLI slash-prefixed tool summaries, e.g. `/ Search "*" 33 files found`. */
const COPILOT_SLASH_TOOL_LINE = /^\s*\/\s+(Search|Read|View|List|Glob|Grep|Edit|Write|Create|Delete|Run|Bash|Shell|Fetch|Web)\b(.*)$/i;

/** Matches indented tool-output / attachment continuation lines emitted beneath a Copilot tool line. */
const COPILOT_TOOL_ATTACHMENT_LINE = /^\s*\[Image:\s+[^\]]+\]\s*$/i;
const COPILOT_TOOL_TREE_LINE = /^\s*[└├│↳]\s*(.*)$/u;

/** Matches lines in Copilot CLI's trailing usage / resume telemetry footer. */
const COPILOT_FOOTER_LINE = /^(?:Changes\s+[+-]\d+\s+[+-]\d+|AI Credits\s+\S+|Tokens\s+[↑↓]|Resume\s+copilot\s+--resume=\S+|Total usage est:|API time spent:|Total session time:|Total code changes:|Breakdown by AI model:)/u;

/**
 * Parses GitHub Copilot CLI plain-text stdout (`copilot -p …`) into structured tool/text segments:
 * - Bullet tool calls (`● preview_start … {"status":"ready",…}`) and slash summaries (`/ Search …`)
 *   become completed `tool` segments so raw tool JSON stays inside the collapsible tool drawer.
 * - Attachment echoes (`[Image: [image/png] 1280x900]`) and tree lines (`└ …`) attach to the
 *   preceding tool segment's result.
 * - The trailing `Changes / AI Credits / Tokens / Resume copilot --resume=…` telemetry footer is
 *   stripped from the reply prose.
 *
 * Plain prose without Copilot CLI markers passes through untouched (`segments: []`).
 */
export function parseCopilotFormattedLog(log: string): { content: string; segments: QaapAgentMessageSegment[] } {
    const rawLines = log.replace(/\r\n/g, '\n').split('\n');

    // Trim trailing blank lines and Copilot CLI's trailing telemetry footer block.
    let end = rawLines.length;
    while (end > 0 && !rawLines[end - 1].trim()) {
        end -= 1;
    }
    let strippedFooter = false;
    while (end > 0) {
        const trimmed = rawLines[end - 1].trim();
        if (!trimmed) {
            end -= 1;
            continue;
        }
        if (COPILOT_FOOTER_LINE.test(trimmed)) {
            strippedFooter = true;
            end -= 1;
            continue;
        }
        break;
    }

    const lines = rawLines.slice(0, end);
    const segments: QaapAgentMessageSegment[] = [];
    const textLines: string[] = [];
    let toolCount = 0;

    const flushText = (): void => {
        const text = textLines.join('\n').trim();
        textLines.length = 0;
        if (text) {
            segments.push({ type: 'text', content: text });
        }
    };

    const appendToLastToolResult = (extra: string): void => {
        const last = segments[segments.length - 1];
        if (!last || last.type !== 'tool') {
            return;
        }
        const merged = last.result ? `${last.result}\n${extra}` : extra;
        segments[segments.length - 1] = { ...last, result: merged };
    };

    let index = 0;
    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        const bulletMatch = COPILOT_BULLET_TOOL_LINE.exec(line);
        if (bulletMatch) {
            flushText();
            const parsed = parseCopilotBulletToolLine(bulletMatch[2]);
            toolCount += 1;
            segments.push({
                type: 'tool',
                id: `copilot-tool-${toolCount}`,
                name: parsed.name,
                args: parsed.args,
                ...(parsed.result ? { result: parsed.result } : {}),
                finished: true,
            });
            index += 1;
            // Absorb immediately following attachment / tree / indented JSON continuation lines.
            while (index < lines.length) {
                const nextRaw = lines[index];
                const nextTrimmed = nextRaw.trim();
                if (!nextTrimmed) {
                    const peek = lines[index + 1] ?? '';
                    if (COPILOT_TOOL_ATTACHMENT_LINE.test(peek) || COPILOT_TOOL_TREE_LINE.test(peek)) {
                        index += 1;
                        continue;
                    }
                    break;
                }
                if (COPILOT_TOOL_ATTACHMENT_LINE.test(nextRaw)) {
                    appendToLastToolResult(nextTrimmed);
                    index += 1;
                    continue;
                }
                const treeMatch = COPILOT_TOOL_TREE_LINE.exec(nextRaw);
                if (treeMatch) {
                    appendToLastToolResult(treeMatch[1].trim() || nextTrimmed);
                    index += 1;
                    continue;
                }
                if (/^\s+\{/.test(nextRaw)) {
                    appendToLastToolResult(nextTrimmed);
                    index += 1;
                    continue;
                }
                break;
            }
            continue;
        }

        const slashMatch = COPILOT_SLASH_TOOL_LINE.exec(line);
        if (slashMatch) {
            flushText();
            const parsed = classifyCopilotSlashTool(slashMatch[1], slashMatch[2].trim());
            toolCount += 1;
            segments.push({
                type: 'tool',
                id: `copilot-tool-${toolCount}`,
                name: parsed.name,
                args: parsed.args,
                finished: true,
            });
            index += 1;
            continue;
        }

        textLines.push(line);
        index += 1;
    }

    if (toolCount === 0 && !strippedFooter) {
        return { content: log.trim(), segments: [] };
    }

    flushText();
    const display = segments
        .filter((segment): segment is Extract<QaapAgentMessageSegment, { type: 'text' }> => segment.type === 'text')
        .map(segment => segment.content.trim())
        .filter(Boolean)
        .join('\n\n');

    return {
        content: display,
        segments: toolCount > 0 ? segments : [],
    };
}

function parseCopilotBulletToolLine(body: string): { name: string; args: string; result?: string } {
    const trimmed = body.trim();
    // Separate inline JSON result payload (e.g. `preview_start (MC… {"status":"ready",…`).
    const jsonStart = trimmed.search(/(?:^|\s)\{/);
    const headerRaw = (jsonStart >= 0 ? trimmed.slice(0, jsonStart) : trimmed).trim();
    const result = jsonStart >= 0 ? trimmed.slice(jsonStart).trim() : undefined;

    // Strip Copilot's truncated MCP/label chrome such as `(MC…`, `(MCP)…`, or trailing `…`.
    const cleanedHeader = headerRaw
        .replace(/\s*\(MC(?:P)?[….]*$/i, '')
        .replace(/\s*[….]+$/u, '')
        .trim();

    const parts = /^([a-zA-Z0-9_.:/-]+)(?:\s+(.+))?$/.exec(cleanedHeader);
    const rawName = parts?.[1] ?? (cleanedHeader || 'Tool');
    const detail = parts?.[2]?.trim();
    const normalized = normalizeQaiqToolName(rawName);
    const args = detail
        ? JSON.stringify({ title: detail })
        : '{}';
    return {
        name: normalized,
        args,
        ...(result ? { result } : {}),
    };
}

function classifyCopilotSlashTool(verb: string, rest: string): { name: string; args: string } {
    const lower = verb.toLowerCase();
    if (lower === 'search' || lower === 'grep') {
        return { name: 'Grep', args: JSON.stringify({ pattern: rest || '*' }) };
    }
    if (lower === 'list' || lower === 'glob') {
        return { name: 'Glob', args: JSON.stringify({ path: rest || '.' }) };
    }
    if (lower === 'read' || lower === 'view') {
        return { name: 'Read', args: JSON.stringify({ file_path: rest || '.' }) };
    }
    if (lower === 'edit') {
        return { name: 'Edit', args: JSON.stringify({ file_path: rest || '.' }) };
    }
    if (lower === 'write' || lower === 'create') {
        return { name: 'Write', args: JSON.stringify({ file_path: rest || '.' }) };
    }
    if (lower === 'run' || lower === 'bash' || lower === 'shell') {
        return { name: 'Bash', args: JSON.stringify({ command: rest }) };
    }
    return { name: normalizeQaiqToolName(verb), args: JSON.stringify({ title: rest }) };
}

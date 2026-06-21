// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Minimal segment shape for transcript activity / inline-render decisions. */
export interface QaapTranscriptActivitySegment {
    readonly type: 'thinking' | 'tool' | 'text';
    readonly content?: string;
    readonly name?: string;
}

export type QaapTranscriptToolActivityKind = 'reading' | 'searching' | 'terminal' | 'editing' | 'mcp' | 'tool';

/** True when a tool name denotes an MCP server invocation (Codex `mcp_tool_call`, Cursor `CallMcpTool`, …). */
export function isTranscriptMcpTool(toolName: string): boolean {
    const name = toolName.toLowerCase().replace(/\s+/g, '_');
    return name.includes('mcp')
        || name === 'callmcptool'
        || name.startsWith('mcp_')
        || name.endsWith('_mcp');
}

/** Short MCP server label from common tool-arg shapes (`server`, `mcp_server`, …). */
export function extractTranscriptMcpServerLabel(argsJson: string): string | undefined {
    try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        const server = [args.server, args.server_name, args.mcp_server, args.mcpServer]
            .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
        if (!server) {
            return undefined;
        }
        const clean = server.trim();
        return clean.length > 24 ? `${clean.slice(0, 21)}…` : clean;
    } catch {
        return undefined;
    }
}

export interface QaapTranscriptActivityStats {
    readonly fileReads: number;
    readonly searches: number;
    readonly shells: number;
    readonly edits: number;
    readonly otherTools: number;
}

/** Classifies a tool name into a coarse activity bucket for transcript meta stats. */
export function classifyTranscriptToolActivityKind(toolName: string): QaapTranscriptToolActivityKind {
    if (isTranscriptMcpTool(toolName)) {
        return 'mcp';
    }
    const name = toolName.toLowerCase();
    if (name.includes('bash') || name.includes('shell') || name.includes('terminal') || name.includes('run_')) {
        return 'terminal';
    }
    // Task-list tools track the agent's plan, not workspace files — never count them as edits.
    if (name.includes('todo')) {
        return 'tool';
    }
    if (name.includes('write') || name.includes('edit') || name.includes('patch') || name.includes('replace')) {
        return 'editing';
    }
    if (name.includes('grep') || name.includes('search') || name.includes('glob')) {
        return 'searching';
    }
    if (name.includes('read') || name.includes('list') || name.includes('ls')) {
        return 'reading';
    }
    return 'tool';
}

/** Aggregates tool-call counts shown under the thought-brief header (Cursor-style meta line). */
export function resolveTranscriptActivityStats(
    segments: readonly QaapTranscriptActivitySegment[],
): QaapTranscriptActivityStats {
    let fileReads = 0;
    let searches = 0;
    let shells = 0;
    let edits = 0;
    let otherTools = 0;
    for (const segment of segments) {
        if (segment.type !== 'tool' || !segment.name) {
            continue;
        }
        switch (classifyTranscriptToolActivityKind(segment.name)) {
            case 'reading':
                fileReads += 1;
                break;
            case 'searching':
                searches += 1;
                break;
            case 'terminal':
                shells += 1;
                break;
            case 'editing':
                edits += 1;
                break;
            default:
                otherTools += 1;
        }
    }
    return { fileReads, searches, shells, edits, otherTools };
}

export function hasTranscriptActivityStats(stats: QaapTranscriptActivityStats): boolean {
    return stats.fileReads + stats.searches + stats.shells + stats.edits + stats.otherTools > 0;
}

/** Joins thinking segments into one block of reasoning text. */
export function resolveTranscriptThinkingContent(segments: readonly QaapTranscriptActivitySegment[]): string | undefined {
    const parts = segments
        .filter((segment): segment is QaapTranscriptActivitySegment & { type: 'thinking' } =>
            segment.type === 'thinking' && !!segment.content?.trim())
        .map(segment => segment.content!.trim());
    if (parts.length === 0) {
        return undefined;
    }
    return parts.join('\n\n');
}

/** One-line code preview from a read tool result — skips diffs, errors, and placeholder "ok". */
export function excerptTranscriptReadResultPreview(result: string | undefined, maxLength = 88): string | undefined {
    const raw = result?.trim();
    if (!raw || /^ok$/i.test(raw)) {
        return undefined;
    }
    if (raw.includes('@@') || raw.startsWith('--- ') || raw.startsWith('+++ ')) {
        return undefined;
    }
    if (/\berror\b/i.test(raw.split('\n')[0] ?? '')) {
        return undefined;
    }
    const line = raw
        .split('\n')
        .map(entry => entry.replace(/\s+/g, ' ').trim())
        .find(entry => entry.length > 0);
    if (!line) {
        return undefined;
    }
    if (line.length <= maxLength) {
        return line;
    }
    return `${line.slice(0, maxLength - 1).trimEnd()}…`;
}

/** One-line preview for the thought-brief body (Cursor-style intent paragraph). */
export function excerptTranscriptThought(text: string | undefined, maxLength = 280): string {
    const compact = (text ?? '').replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) {
        return compact;
    }
    return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

export function isTranscriptThoughtExcerptTruncated(text: string | undefined, maxLength = 280): boolean {
    return (text ?? '').replace(/\s+/g, ' ').trim().length > maxLength;
}

/**
 * Whether the premium activity timeline would render for these segments.
 * Mirrors {@link resolveTranscriptActivityItems} empty-check without building labels.
 */
export function hasTranscriptActivityTimeline(segments: readonly QaapTranscriptActivitySegment[]): boolean {
    for (const segment of segments) {
        if (segment.type === 'thinking' && segment.content?.trim()) {
            return true;
        }
        if (segment.type === 'tool') {
            return true;
        }
    }
    if (segments.some(segment => segment.type === 'text' && segment.content?.trim())) {
        return true;
    }
    return false;
}

/**
 * When the activity timeline is shown, finished successful tool calls are already listed there.
 * Keep inline detail only for live tools (still running) or failed results worth inspecting.
 */
export function shouldRenderTranscriptToolSegmentInline(options: {
    readonly activityTimelineShown: boolean;
    readonly finished: boolean;
    readonly resultFailed: boolean;
    readonly toolKind?: QaapTranscriptToolActivityKind;
    readonly hasToolOutput?: boolean;
}): boolean {
    if (!options.activityTimelineShown) {
        return true;
    }
    if (!options.finished) {
        return true;
    }
    if (options.resultFailed) {
        return true;
    }
    if (options.toolKind === 'terminal' && options.hasToolOutput) {
        return true;
    }
    return false;
}

/** Expand tool/shell panels while running or when a failed result needs attention. */
export function shouldOpenTranscriptToolDetails(options: {
    readonly finished: boolean;
    readonly resultFailed: boolean;
}): boolean {
    if (!options.finished) {
        return true;
    }
    return options.resultFailed;
}

export type QaapTranscriptInlineDiffLineKind = 'add' | 'remove' | 'context';

export interface QaapTranscriptInlineDiffLine {
    readonly kind: QaapTranscriptInlineDiffLineKind;
    readonly text: string;
}

/** Extract a compact unified-diff preview for inline transcript rendering. */
export function extractInlineDiffPreview(text: string, maxLines = 6): QaapTranscriptInlineDiffLine[] | undefined {
    const lines = text.split('\n');
    const preview: QaapTranscriptInlineDiffLine[] = [];
    for (const line of lines) {
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
            continue;
        }
        if (line.startsWith('+')) {
            preview.push({ kind: 'add', text: line.slice(1) });
        } else if (line.startsWith('-')) {
            preview.push({ kind: 'remove', text: line.slice(1) });
        } else if (preview.length > 0 && line.startsWith(' ')) {
            preview.push({ kind: 'context', text: line.slice(1) });
        }
        if (preview.length >= maxLines) {
            break;
        }
    }
    return preview.length > 0 ? preview : undefined;
}

export interface QaapTranscriptDiffCardLine {
    readonly kind: QaapTranscriptInlineDiffLineKind;
    readonly text: string;
    /** New-file line number for add/context lines, old-file number for removes (from `@@` hunks). */
    readonly lineNumber?: number;
}

export interface QaapTranscriptDiffCard {
    readonly lines: QaapTranscriptDiffCardLine[];
    readonly added: number;
    readonly removed: number;
    readonly truncated: boolean;
}

/**
 * Claude-Code-style diff card data from a unified diff: numbered changed lines plus total
 * added/removed counts. Counts cover the whole diff even when the preview is truncated.
 */
export function extractTranscriptDiffCard(text: string, maxLines = 12): QaapTranscriptDiffCard | undefined {
    const lines = text.split('\n');
    const preview: QaapTranscriptDiffCardLine[] = [];
    let added = 0;
    let removed = 0;
    let truncated = false;
    let oldLine: number | undefined;
    let newLine: number | undefined;
    for (const line of lines) {
        const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
        if (hunk) {
            oldLine = Number(hunk[1]);
            newLine = Number(hunk[2]);
            continue;
        }
        if (line.startsWith('+++') || line.startsWith('---')) {
            continue;
        }
        if (line.startsWith('+')) {
            added++;
            if (preview.length < maxLines) {
                preview.push({ kind: 'add', text: line.slice(1), lineNumber: newLine });
            } else {
                truncated = true;
            }
            if (newLine !== undefined) {
                newLine++;
            }
        } else if (line.startsWith('-')) {
            removed++;
            if (preview.length < maxLines) {
                preview.push({ kind: 'remove', text: line.slice(1), lineNumber: oldLine });
            } else {
                truncated = true;
            }
            if (oldLine !== undefined) {
                oldLine++;
            }
        } else if (line.startsWith(' ')) {
            if (preview.length > 0 && preview.length < maxLines) {
                preview.push({ kind: 'context', text: line.slice(1), lineNumber: newLine });
            }
            if (newLine !== undefined) {
                newLine++;
            }
            if (oldLine !== undefined) {
                oldLine++;
            }
        }
    }
    if (added === 0 && removed === 0) {
        return undefined;
    }
    // Drop a trailing context line so the card ends on a real change.
    while (preview.length > 0 && preview[preview.length - 1].kind === 'context') {
        preview.pop();
    }
    return preview.length > 0 ? { lines: preview, added, removed, truncated } : undefined;
}

export interface QaapTranscriptToolRowParts {
    /** Muted action prefix, e.g. "Ran", "Read", "Edited". */
    readonly verb: string;
    /** Emphasised description, e.g. the command excerpt or file name. */
    readonly detail: string;
}

/** Human-readable tool name for timeline rows (AskUserQuestion → Ask User Question). */
export function humanizeTranscriptToolDisplayName(toolName: string): string {
    return toolName
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();
}

/** Cursor-style label override for tools that need verb/detail instead of a raw identifier. */
export function resolveSpecialTranscriptToolTraceLabel(
    toolName: string,
): QaapTranscriptToolRowParts | undefined {
    const key = toolName.toLowerCase().replace(/[_-]+/g, '');
    switch (key) {
        case 'askuserquestion':
            return { verb: 'Asked', detail: 'a question' };
        case 'websearch':
        case 'websearchtool':
            return { verb: 'Searched', detail: 'the web' };
        case 'webfetch':
        case 'webfetchtool':
            return { verb: 'Fetched', detail: 'a page' };
        case 'listdir':
        case 'list_dir':
        case 'getworkspacefilelist':
            return { verb: 'Listed', detail: 'directory' };
        default:
            return undefined;
    }
}

/** Compact a shell command for a one-line row label. */
export function excerptTranscriptToolCommand(command: string, maxChars = 64): string {
    const collapsed = command.replace(/\s+/g, ' ').trim();
    return collapsed.length > maxChars ? `${collapsed.slice(0, maxChars).trimEnd()}…` : collapsed;
}

/** Claude-Code-style verb-first row label parts for a tool call. */
export function resolveTranscriptToolRowParts(
    kind: string,
    toolName: string,
    options?: { readonly path?: string; readonly command?: string },
): QaapTranscriptToolRowParts {
    if (isTranscriptTodoTool(toolName)) {
        return { verb: 'Updated', detail: 'todo list' };
    }
    const file = options?.path ? options.path.split('/').pop() ?? options.path : undefined;
    switch (kind) {
        case 'reading':
            return { verb: 'Read', detail: file ?? 'file' };
        case 'searching':
            return { verb: 'Searched', detail: file ?? 'workspace' };
        case 'terminal':
            return { verb: 'Ran', detail: options?.command ? excerptTranscriptToolCommand(options.command) : 'command' };
        case 'mcp':
            return { verb: 'Called', detail: humanizeTranscriptToolDisplayName(toolName || 'MCP') };
        case 'editing':
            return { verb: 'Edited', detail: file ?? 'file' };
        default: {
            const special = resolveSpecialTranscriptToolTraceLabel(toolName);
            if (special) {
                return special;
            }
            return { verb: 'Used', detail: humanizeTranscriptToolDisplayName(toolName || 'tool') };
        }
    }
}

/** True for agent task-list tools (Claude Code `TodoWrite`, opencode `todowrite`, …). */
export function isTranscriptTodoTool(toolName: string): boolean {
    return toolName.toLowerCase().includes('todo');
}

export type QaapTranscriptTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface QaapTranscriptTodoItem {
    readonly label: string;
    readonly status: QaapTranscriptTodoStatus;
}

/**
 * Parse a todo-tool args payload into checklist items. Tolerates the common CLI shapes
 * (`{todos: [{content|subject|description, status}]}` or a bare array) and returns
 * undefined for anything unparseable (e.g. args still streaming in).
 */
export function parseTranscriptTodoChecklist(argsJson: string): QaapTranscriptTodoItem[] | undefined {
    let parsed: unknown;
    try {
        parsed = JSON.parse(argsJson);
    } catch {
        return undefined;
    }
    const list = Array.isArray(parsed)
        ? parsed
        : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { todos?: unknown }).todos)
            ? (parsed as { todos: unknown[] }).todos
            : undefined;
    if (!list) {
        return undefined;
    }
    const items: QaapTranscriptTodoItem[] = [];
    for (const entry of list) {
        if (typeof entry !== 'object' || entry === null) {
            continue;
        }
        const record = entry as Record<string, unknown>;
        const label = [record.content, record.subject, record.description, record.title]
            .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
        if (!label) {
            continue;
        }
        const status = record.status === 'completed' || record.status === 'in_progress' ? record.status : 'pending';
        items.push({ label: label.trim(), status });
    }
    return items.length > 0 ? items : undefined;
}

export interface QaapTranscriptToolPillDescriptor {
    readonly toolUseId: string;
    readonly label: string;
    readonly kind: QaapTranscriptToolActivityKind;
    readonly finished: boolean;
    readonly resultFailed: boolean;
    readonly hasInlineDiff: boolean;
}

export interface QaapTranscriptToolPillSegment {
    readonly type: 'tool';
    readonly toolUseId: string;
    readonly name: string;
    readonly args: string;
    readonly finished: boolean;
    readonly result?: string;
}

/** Compact labels for collapsed tool pills in the transcript. */
export function resolveTranscriptToolPillDescriptors(
    segments: readonly QaapTranscriptToolPillSegment[],
    options?: { readonly resolvePath?: (args: string) => string | undefined },
): QaapTranscriptToolPillDescriptor[] {
    const pills: QaapTranscriptToolPillDescriptor[] = [];
    for (const segment of segments) {
        const kind = classifyTranscriptToolActivityKind(segment.name);
        const path = options?.resolvePath?.(segment.args);
        const label = resolveTranscriptToolPillLabel(kind, segment.name, path);
        const result = segment.result ?? '';
        const resultFailed = result.toLowerCase().includes('error') || result.toLowerCase().includes('failed');
        pills.push({
            toolUseId: segment.toolUseId,
            label,
            kind,
            finished: segment.finished,
            resultFailed,
            hasInlineDiff: kind === 'editing' && !!extractInlineDiffPreview(result),
        });
    }
    return pills;
}

function resolveTranscriptToolPillLabel(
    kind: QaapTranscriptToolActivityKind,
    toolName: string,
    path?: string,
): string {
    const file = path ? path.split('/').pop() ?? path : undefined;
    switch (kind) {
        case 'reading':
            return file ? `Read ${file}` : 'Read file';
        case 'searching':
            return file ? `Search ${file}` : 'Search';
        case 'terminal':
            return 'Run command';
        case 'mcp':
            return 'MCP tool';
        case 'editing':
            return file ? `Edit ${file}` : 'Edit file';
        default:
            return (toolName ?? 'tool').replace(/_/g, ' ');
    }
}

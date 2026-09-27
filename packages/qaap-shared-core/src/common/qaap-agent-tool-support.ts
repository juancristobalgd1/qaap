// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Tool-calling (function calling) support signals for QAIQ agent models.
 *
 * Free gateway models without native function calling accept a `tools` request field but
 * answer by writing the tool-call arguments as plain assistant text, e.g.
 * `{ "command": "ls -la", "description": "List all files in the current directory" }`.
 * The CLI then believes the turn finished without tool calls and the run dies silently
 * with exit 0. These helpers back three defenses: a picker badge, a pre-spawn gate, and
 * a settle-time detector that reroutes such turns into the model-fallback retry.
 */

/** Model families confirmed to lack native function calling on gateway endpoints. */
const TOOL_CALL_UNSUPPORTED_MODEL_PATTERNS: readonly RegExp[] = [
    // Tencent Hunyuan (e.g. `tencent/hy3:free` via OpenRouter): emits tool args as text.
    /^tencent\/hy/i,
];

/**
 * Tri-state tool-calling capability for a model slug: `false` for confirmed-unsupported
 * families, `undefined` (optimistic) for everything else. Unknown models stay usable —
 * the settle-time detector catches them at runtime instead.
 */
export function qaiqModelSupportsToolCalls(modelId: string | undefined): boolean | undefined {
    const trimmed = modelId?.trim();
    if (!trimmed) {
        return undefined;
    }
    if (TOOL_CALL_UNSUPPORTED_MODEL_PATTERNS.some(pattern => pattern.test(trimmed))) {
        return false;
    }
    return undefined;
}

const TOOL_CALL_NAME_KEYS = ['name', 'tool', 'tool_name', 'function'] as const;
const TOOL_CALL_ARGS_KEYS = ['arguments', 'input', 'args', 'parameters'] as const;

/**
 * Argument shapes of ubiquitous coding-agent CLI tools (Claude Code-style). A bare-args
 * object only counts as a tool call when every key fits exactly one known shape, so plain
 * JSON answers do not false-positive. Deliberately excludes generic shapes like
 * `{pattern}` that legitimate JSON answers could produce.
 */
const KNOWN_CLI_TOOL_ARG_SHAPES: readonly { readonly required: readonly string[]; readonly allowed: readonly string[] }[] = [
    // Bash
    {
        required: ['command'],
        allowed: ['command', 'description', 'timeout', 'run_in_background', 'sandbox'],
    },
    // Read / Write / Edit
    {
        required: ['file_path'],
        allowed: ['file_path', 'content', 'old_string', 'new_string', 'replace_all', 'offset', 'limit', 'edits'],
    },
    // TodoWrite
    {
        required: ['todos'],
        allowed: ['todos'],
    },
];

/**
 * The whole text as a JSON-object source: either the trimmed text itself, or the body of
 * a single fenced code block (optionally tagged `json`). Anything else — prose around the
 * object, multiple blocks — yields `undefined`.
 */
function extractSoleJsonObjectSource(trimmed: string): string | undefined {
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        return trimmed;
    }
    const fence = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
    if (fence) {
        const body = fence[1].trim();
        if (body.startsWith('{') && body.endsWith('}')) {
            return body;
        }
    }
    return undefined;
}

/**
 * True when `text` is exactly one JSON object shaped like a tool call: either a wrapped
 * call (`{name/tool: string, arguments/input: object}`) or bare arguments matching a
 * known CLI tool schema (`{command, description}` → Bash). Conservative by design —
 * embedded JSON inside prose never matches.
 */
export function looksLikeToolCallJsonText(text: string | undefined): boolean {
    const trimmed = (text ?? '').trim();
    if (!trimmed) {
        return false;
    }
    const source = extractSoleJsonObjectSource(trimmed);
    if (!source) {
        return false;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch {
        return false;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return false;
    }
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) {
        return false;
    }
    const nameKey = TOOL_CALL_NAME_KEYS.find(key => typeof record[key] === 'string' && !!(record[key] as string).trim());
    if (nameKey) {
        const argsValue = TOOL_CALL_ARGS_KEYS.map(key => record[key]).find(value => value !== undefined);
        if (argsValue && typeof argsValue === 'object' && !Array.isArray(argsValue)) {
            return true;
        }
    }
    return KNOWN_CLI_TOOL_ARG_SHAPES.some(shape =>
        shape.required.every(key => key in record)
        && keys.every(key => shape.allowed.includes(key)));
}

/** Minimal transcript segment view needed by the settle-time detector. */
export interface QaapAgentToolSupportSegment {
    readonly type: string;
    readonly content?: string;
}

/**
 * True when a settled agent turn ran no tools but "answered" with tool-call-shaped JSON —
 * the signature of a model without native function calling. Turns that executed any real
 * tool never match, so casual JSON output from a working model is not flagged.
 */
export function agentTurnLooksLikeToolCallEmittedAsText(
    segments: readonly QaapAgentToolSupportSegment[] | undefined,
): boolean {
    if (!segments?.length) {
        return false;
    }
    if (segments.some(segment => segment.type === 'tool')) {
        return false;
    }
    return segments.some(segment => segment.type === 'text' && looksLikeToolCallJsonText(segment.content));
}

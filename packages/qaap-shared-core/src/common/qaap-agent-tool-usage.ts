// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Route under `QAAP_AGENT_CONVERSATION_API_PATH` with the owner's most used skills, MCP servers and tools. */
export const QAAP_AGENT_TOOL_USAGE_ROUTE = 'tool-usage';

/** What kind of capability a usage row counts. */
export type QaapAgentToolUsageKind = 'skill' | 'mcp' | 'tool';

export interface QaapAgentToolUsageRow {
    /** Display name: `$skill`, the MCP server name, or the tool name. */
    readonly name: string;
    readonly kind: QaapAgentToolUsageKind;
    readonly runs: number;
}

export interface QaapAgentToolUsageResponse {
    readonly rows: readonly QaapAgentToolUsageRow[];
}

/** How many rows the Profile lists. */
export const QAAP_AGENT_TOOL_USAGE_MAX_ROWS = 6;

/** A tool call as a message segment records it. */
export interface QaapAgentToolUsageSegment {
    readonly type: string;
    readonly name?: string;
    readonly args?: string;
}

const SKILL_TOOL_NAMES: ReadonlySet<string> = new Set(['skill', 'useskill', 'use_skill', 'load_skill']);

function skillNameFromArgs(args: string | undefined): string | undefined {
    if (!args) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(args) as Record<string, unknown>;
        for (const key of ['skill', 'name', 'skill_name', 'command']) {
            const value = parsed[key];
            if (typeof value === 'string' && value.trim()) {
                return value.trim().replace(/^\$/, '');
            }
        }
    } catch {
        // Not JSON: a bare skill name.
        const bare = args.trim().replace(/^\$/, '');
        return /^[\w.-]{1,64}$/.test(bare) ? bare : undefined;
    }
    return undefined;
}

/** Classifies one tool call: a skill (`$name`), an MCP server, or a plain tool. `undefined` for a nameless call. */
export function classifyQaapAgentToolCall(segment: QaapAgentToolUsageSegment): Omit<QaapAgentToolUsageRow, 'runs'> | undefined {
    const name = segment.name?.trim();
    if (segment.type !== 'tool' || !name) {
        return undefined;
    }
    if (SKILL_TOOL_NAMES.has(name.toLowerCase())) {
        const skill = skillNameFromArgs(segment.args);
        return skill ? { name: `$${skill}`, kind: 'skill' } : { name, kind: 'tool' };
    }
    const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(name);
    if (mcp) {
        return { name: mcp[1], kind: 'mcp' };
    }
    return { name, kind: 'tool' };
}

/**
 * Counts tool calls across conversations. Skills and MCP servers rank before plain tools at an equal count, since
 * they are what a user installs; the list is capped at {@link QAAP_AGENT_TOOL_USAGE_MAX_ROWS}.
 */
export function aggregateQaapAgentToolUsage(
    conversations: Iterable<{ readonly messages: ReadonlyArray<{ readonly segments?: ReadonlyArray<QaapAgentToolUsageSegment> }> }>,
    maxRows = QAAP_AGENT_TOOL_USAGE_MAX_ROWS,
): QaapAgentToolUsageRow[] {
    const counts = new Map<string, { name: string; kind: QaapAgentToolUsageKind; runs: number }>();
    for (const conversation of conversations) {
        for (const message of conversation.messages) {
            for (const segment of message.segments ?? []) {
                const call = classifyQaapAgentToolCall(segment);
                if (!call) {
                    continue;
                }
                const key = `${call.kind}\u0000${call.name.toLowerCase()}`;
                const entry = counts.get(key) ?? { ...call, runs: 0 };
                entry.runs++;
                counts.set(key, entry);
            }
        }
    }
    const kindRank: Record<QaapAgentToolUsageKind, number> = { skill: 0, mcp: 1, tool: 2 };
    return [...counts.values()]
        .sort((a, b) => b.runs - a.runs || kindRank[a.kind] - kindRank[b.kind] || a.name.localeCompare(b.name))
        .slice(0, maxRows);
}

/** The signed-in owner's most used skills, MCP servers and tools; empty when the backend cannot answer. */
export async function fetchQaapAgentToolUsage(apiPath: string): Promise<readonly QaapAgentToolUsageRow[]> {
    const response = await fetch(`${apiPath}/${QAAP_AGENT_TOOL_USAGE_ROUTE}`, { credentials: 'include', headers: { Accept: 'application/json' } });
    if (!response.ok) {
        throw new Error(`Tool usage request failed (${response.status})`);
    }
    const body = await response.json() as Partial<QaapAgentToolUsageResponse>;
    return Array.isArray(body.rows) ? body.rows : [];
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Execution Event Builder (mobile) ────────────────────────────────────────
//
// Transforms a flat list of agent message segments (text / thinking / tool)
// into the event-based timeline tree: narrative events with grouped tool
// children. Extracted from qaap-execution-event-timeline.ts.

import type { QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { extractToolArgFilePath, formatReadToolDetailFromArgs } from '../common/qaap-agent-conversation-list-metrics';
import { classifyTranscriptToolActivityKind, extractTranscriptTaskSummary } from '../common/qaap-agent-transcript-segments';
import { isTranscriptSubagentToolName } from '../common/qaap-transcript-activity-nesting';
import { isAgentToolResultFailure } from '../common/qaap-transcript-content-display';
import {
    isTranscriptWebSearchTool,
    parseTranscriptWebSearchQuery,
} from '../common/qaap-transcript-web-search-core';
import type {
    MobileEventKind,
    MobileExecutionTool,
    MobileExecutionEvent,
    MobileExecutionTimeline
} from './mobile-execution-event-types';

export function buildMobileExecutionEvents(segments: readonly QaapAgentMessageSegmentDTO[]): MobileExecutionTimeline {
    const events: MobileExecutionEvent[] = [];
    // Accumulate consecutive text/thinking segments so that none are silently
    // dropped. Each entry becomes part of the narrative for the next event
    // (or the closing narrative if no more tools follow).
    let pendingNarrative: string[] = [];
    let closingNarrative: string[] = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        if (segment.type === 'text') {
            const text = segment.content?.trim();
            if (!text) {
                continue;
            }
            pendingNarrative.push(text);
            continue;
        }

        if (segment.type === 'thinking') {
            // Thinking segments can serve as narrative if no text is available.
            // Only use the first thinking segment as narrative; subsequent
            // thinking segments are appended so none are dropped.
            const text = segment.content?.trim();
            if (text) {
                const excerpt = text.length > 120 ? text.slice(0, 117) + '...' : text;
                pendingNarrative.push(excerpt);
            }
            continue;
        }

        // Tool segment
        const descriptor = describeMobileTool(segment);
        const lastEvent = events[events.length - 1];

        // Merge into last event if no new narrative and same kind.
        // Never merge run/verification groups: incomplete Bash args often start
        // as `run` and later flip to `verification`, which would collapse two
        // events into one (`nextEvents.length < prev`) and force a full timeline
        // rebuild (visible flicker) on every classification flip.
        const canMergeKind = descriptor.kind !== 'run' && descriptor.kind !== 'verification';
        if (lastEvent && pendingNarrative.length === 0 && lastEvent.kind === descriptor.kind && canMergeKind) {
            lastEvent.tools.push(toMobileTool(segment, i, descriptor));
            updateMobileEventState(lastEvent);
            continue;
        }

        // Start new event
        let narrative: string;
        let narrativeSource: 'agent' | 'synthetic';
        if (pendingNarrative.length > 0) {
            narrative = pendingNarrative.join('\n\n');
            narrativeSource = 'agent';
            pendingNarrative = [];
        } else {
            narrative = descriptor.narrative;
            narrativeSource = 'synthetic';
        }

        // Stable id keyed by the lead toolUseId so remounts / open-state maps
        // survive stream growth. Positional `m-event-N` broke whenever narrative
        // inserted a new group ahead of existing ones.
        const event: MobileExecutionEvent = {
            id: `m-event-${segment.toolUseId}`,
            narrative,
            narrativeSource,
            kind: descriptor.kind,
            icon: descriptor.icon,
            verb: descriptor.verb,
            tools: [toMobileTool(segment, i, descriptor)],
            hasPending: !segment.finished,
            hasError: isToolError(segment),
        };
        events.push(event);
    }

    if (pendingNarrative.length > 0) {
        closingNarrative = pendingNarrative;
    }

    return { events, closingNarrative: closingNarrative.length > 0 ? closingNarrative.join('\n\n') : undefined };
}

function toMobileTool(
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    segmentIndex: number,
    descriptor: MobileToolDescriptor,
): MobileExecutionTool {
    return {
        segment,
        segmentIndex,
        kind: descriptor.kind,
        verb: descriptor.verb,
        detail: extractToolDetail(segment, descriptor.kind),
        filePath: resolveToolFilePath(segment),
        isTerminal: descriptor.kind === 'run' || descriptor.kind === 'verification',
        isVerification: descriptor.kind === 'verification',
        isError: isToolError(segment),
        isFinished: segment.finished,
    };
}

function updateMobileEventState(event: MobileExecutionEvent): void {
    event.hasPending = event.tools.some(t => !t.isFinished);
    event.hasError = event.tools.some(t => t.isError);
}

function isToolError(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): boolean {
    if (!segment.finished) {
        return false;
    }
    // Use the shared failure detector so substrings inside file paths
    // (e.g. css-syntax-error.js) and Read payloads don't trigger false positives.
    return isAgentToolResultFailure(segment.result, { toolName: segment.name });
}

// ─── Tool classification ─────────────────────────────────────────────────────

interface MobileToolDescriptor {
    kind: MobileEventKind;
    icon: string;
    verb: string;
    narrative: string;
}

function describeMobileTool(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): MobileToolDescriptor {
    const name = segment.name.toLowerCase();
    const activityKind = classifyTranscriptToolActivityKind(segment.name);

    if (isTranscriptWebSearchTool(segment.name)) {
        return {
            kind: 'explore',
            icon: 'codicon-globe',
            verb: segment.finished ? 'Searched' : 'Searching',
            narrative: "I'm searching the web.",
        };
    }
    if (isVerificationTool(segment, name)) {
        return { kind: 'verification', icon: 'codicon-checklist', verb: 'Verification', narrative: "I'm validating the implementation." };
    }
    if (activityKind === 'terminal' || matchesName(name, ['bash', 'shell', 'terminal', 'command', 'exec', 'run', 'npm', 'yarn', 'pnpm', 'node'])) {
        return { kind: 'run', icon: 'codicon-terminal', verb: 'Run', narrative: "I'm running commands." };
    }
    if (activityKind === 'searching' || matchesName(name, ['grep', 'glob', 'search', 'find', 'ripgrep', 'rg'])) {
        return { kind: 'explore', icon: 'codicon-search', verb: 'Explore', narrative: "I'm looking through the project structure." };
    }
    if (activityKind === 'reading' || matchesName(name, ['read', 'open', 'fetch', 'list', 'ls'])) {
        return { kind: 'read', icon: 'codicon-file', verb: 'Read', narrative: "I'm checking the relevant files." };
    }
    if (matchesName(name, ['write', 'create', 'new'])) {
        return { kind: 'write', icon: 'codicon-new-file', verb: 'Write', narrative: "I'm writing the implementation." };
    }
    if (activityKind === 'editing' || matchesName(name, ['edit', 'update', 'patch', 'replace', 'modify', 'multi'])) {
        return { kind: 'edit', icon: 'codicon-edit', verb: 'Update', narrative: "I'm updating the implementation." };
    }
    if (matchesName(name, ['delete', 'remove', 'rm'])) {
        return { kind: 'delete', icon: 'codicon-trash', verb: 'Delete', narrative: "I'm removing obsolete pieces." };
    }
    if (isTranscriptSubagentToolName(segment.name)) {
        const verb = segment.name.trim().toLowerCase() === 'agent' ? 'Agent' : 'Task';
        return {
            kind: 'other',
            icon: 'codicon-robot',
            verb,
            narrative: "I'm launching a subagent.",
        };
    }
    return { kind: 'other', icon: 'codicon-tools', verb: 'Use', narrative: "I'm applying the next step." };
}

function isVerificationTool(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>, name: string): boolean {
    if (matchesName(name, ['vitest', 'test', 'lint', 'typecheck', 'tsc'])) {
        return true;
    }
    if (!matchesName(name, ['bash', 'shell', 'terminal', 'command', 'exec', 'run', 'npm', 'yarn', 'pnpm', 'node'])) {
        return false;
    }
    return containsVerificationCommand(segment.args);
}

function containsVerificationCommand(args: string | undefined): boolean {
    if (!args) {
        return false;
    }
    return /(^|[\s"'`:,{[])(npm|yarn|pnpm|npx|node)?\s*(run\s+)?(test|vitest|lint|typecheck|tsc)(:|\b)/i.test(args);
}

function matchesName(name: string, tokens: string[]): boolean {
    const normalized = name.split(/[^a-z0-9]+|_/).filter(Boolean);
    return tokens.some(token => normalized.includes(token));
}

function extractToolDetail(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>, kind: MobileEventKind): string {
    if (isTranscriptWebSearchTool(segment.name)) {
        return parseTranscriptWebSearchQuery(segment.args) || segment.name;
    }
    if (kind === 'run' || kind === 'verification') {
        return extractCommand(segment.args) ?? segment.name;
    }
    if (kind === 'read' || kind === 'write' || kind === 'edit' || kind === 'delete') {
        // Prefer basename + optional line range (`auth.ts L10-40`) over the bare tool name.
        const readDetail = formatReadToolDetailFromArgs(segment.args);
        if (readDetail) {
            return readDetail;
        }
        const filePath = resolveToolFilePath(segment);
        if (filePath) {
            return fileBasename(filePath);
        }
        // Never fall back to "Read" — that looks like a missing filename in the group rows.
        return 'file';
    }
    if (kind === 'explore') {
        const exploreDetail = extractExploreDetail(segment.args);
        if (exploreDetail) {
            return exploreDetail;
        }
        const filePath = resolveToolFilePath(segment);
        if (filePath) {
            return fileBasename(filePath);
        }
        return 'workspace';
    }
    if (isTranscriptSubagentToolName(segment.name)) {
        return extractTranscriptTaskSummary(segment.args ?? '') ?? 'task';
    }
    const filePath = resolveToolFilePath(segment);
    if (filePath) {
        return fileBasename(filePath);
    }
    return segment.name;
}

function extractCommand(args: string | undefined): string | undefined {
    if (!args) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(args);
        if (typeof parsed === 'object' && parsed !== null) {
            const command = parsed.command ?? parsed.cmd ?? parsed.input;
            if (typeof command === 'string') {
                return command;
            }
        }
    } catch {
        return args;
    }
    return undefined;
}

/** Path from tool args, with `<path>` recovery from the result when args were wiped. */
function resolveToolFilePath(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): string | undefined {
    return extractToolArgFilePath(segment.args) ?? extractToolArgFilePath(segment.result);
}

function fileBasename(filePath: string): string {
    const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.pop() ?? filePath;
}

/** Glob tokens that are not useful as a standalone Explore row label. */
const TRIVIAL_EXPLORE_PATTERNS = new Set(['*', '**', '**/*', '**/**', '.']);

function isMeaningfulExplorePattern(value: string): boolean {
    const trimmed = value.trim();
    return trimmed.length > 0 && !TRIVIAL_EXPLORE_PATTERNS.has(trimmed);
}

/** Pattern / directory for Glob·Grep rows so the group does not just repeat the tool name. */
function extractExploreDetail(args: string | undefined): string | undefined {
    if (!args?.trim()) {
        return undefined;
    }
    const truncate = (value: string): string => (value.length > 48 ? `${value.slice(0, 45)}…` : value);
    try {
        const parsed = JSON.parse(args) as Record<string, unknown>;
        let pattern: string | undefined;
        for (const key of ['pattern', 'glob_pattern', 'glob', 'query'] as const) {
            const value = parsed[key];
            if (typeof value === 'string' && isMeaningfulExplorePattern(value)) {
                pattern = value.trim();
                break;
            }
        }
        let location: string | undefined;
        for (const key of ['path', 'target_directory', 'target_file'] as const) {
            const value = parsed[key];
            if (typeof value === 'string' && value.trim()) {
                location = value.trim();
                break;
            }
        }
        if (pattern && location) {
            const shortLocation = fileBasename(location);
            const combined = `${pattern} in ${shortLocation}`;
            return truncate(combined.length <= 48 ? combined : pattern);
        }
        if (pattern) {
            return truncate(pattern);
        }
        if (location) {
            return truncate(location);
        }
    } catch {
        const match = args.match(/"(?:pattern|glob_pattern|glob|query)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (match?.[1]) {
            const decoded = match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
            if (isMeaningfulExplorePattern(decoded)) {
                return truncate(decoded);
            }
        }
        const pathMatch = args.match(/"(?:path|target_directory|target_file)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (pathMatch?.[1]) {
            const decoded = pathMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
            if (decoded) {
                return truncate(decoded);
            }
        }
    }
    return undefined;
}

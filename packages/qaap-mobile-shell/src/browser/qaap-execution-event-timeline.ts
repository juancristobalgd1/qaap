// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// ─── Codex-style Execution Event Timeline (mobile) ───────────────────────────
//
// Replaces the old "tool log" rendering with an event-based tree:
//
//   AgentExecution
//     ExecutionEvent  (narrative + tool group)
//       Narrative     "I'm inspecting the project structure."
//       ToolGroup     (collapsed by default)
//         ToolSummary "3 searches ▶"
//         ToolDetails (hidden until expanded)
//     ExecutionEvent
//       Narrative     "I found the rendering pipeline."
//       ToolGroup     ...
//     DiffSummary     (the natural closing)
//
// Tools are CHILDREN of events, never siblings.
// The narrative is the primary element; tools are secondary.
// Only Terminal/Error/Diff get cards — everything else is text.
// ─────────────────────────────────────────────────────────────────────────────

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { destroyThinkingOrbIndicator } from './qaap-thinking-orb-indicator';
import { extractToolArgFilePath, formatReadToolDetailFromArgs } from '../common/qaap-agent-conversation-list-metrics';
import { classifyTranscriptToolActivityKind, extractTranscriptTaskSummary } from '../common/qaap-agent-transcript-segments';
import { isTranscriptSubagentToolName } from '../common/qaap-transcript-activity-nesting';
import { isAgentToolResultFailure, stripAnsiEscapes } from '../common/qaap-transcript-content-display';
import { getFileIconClass } from '../common/qaap-file-icon-utils';
import { canPatchToolSegmentGrowth, TRANSCRIPT_TOOL_USE_ID_ATTR } from '../common/qaap-transcript-incremental-update';
import { recordTranscriptRenderMetric } from '../common/qaap-transcript-render-metrics';
import { sharedElapsedTicker } from './qaap-shared-elapsed-ticker';
import { createTranscriptCodeView, patchTranscriptCodeView, resolveTranscriptCodeLanguage, type TranscriptCodeLanguage } from './qaap-transcript-code-view';
import {
    isTranscriptWebSearchTool,
    parseTranscriptWebSearchQuery,
    resolveTranscriptWebSearchPayload,
} from '../common/qaap-transcript-web-search-core';
import {
    createTranscriptWebSearchCard,
    patchTranscriptWebSearchCard,
    TRANSCRIPT_WEB_SEARCH_CARD_CLASS,
} from './qaap-transcript-web-search-ui';
import { syncActivityToolIconMotion } from './qaap-activity-tool-icon-motion';

/** Data attribute: stable id of the execution event a `section` element renders. */
const MOBILE_EVENT_ID_ATTR = 'data-mobile-event-id';

/** Caches the last-rendered event list for a timeline container so streaming
 *  patches can diff against it without re-parsing the DOM. */
const timelineEventCache = new WeakMap<HTMLElement, readonly MobileExecutionEvent[]>();

/** Latest raw (un-stripped) terminal result for a collapsed terminal `<details>`
 *  card, keyed by the details element. Terminal cards are collapsed by
 *  default, so building the highlighted output (which requires
 *  stripAnsiEscapes over the full — possibly large — result) is deferred
 *  until the card is first opened; this map lets the deferred render pick up
 *  whatever the latest streamed result was by then. */
const pendingTerminalOutputResult = new WeakMap<HTMLDetailsElement, string>();

/**
 * Global per-tool `<details>` open/closed state, keyed by a stable id: a
 * terminal card's {@link TRANSCRIPT_TOOL_USE_ID_ATTR} value, or a tool
 * group's key as derived by {@link resolveTimelineGroupStateKey} /
 * {@link resolveTimelineGroupCreationKey}. This is deliberately global and
 * long-lived (unlike {@link processAccordionTurnState}, scoped to a turn, or
 * {@link captureTimelineOpenStateById}, scoped to a single in-place rebuild):
 * a long transcript's virtual list fully removes rows that scroll out of
 * view (`row.remove()`) and builds a brand-new row from scratch when the
 * user scrolls back — there is no "existing" element to capture state from
 * at that point, only the stable tool-use id to look up. Capped with a
 * simple LRU eviction so a very long session doesn't grow this unbounded.
 *
 * Keys are namespaced with a `group:`/`terminal:` prefix (see
 * {@link timelineGroupOpenStateKey} / {@link timelineTerminalOpenStateKey}):
 * a tool group's derived key falls back to its *first tool row's* toolUseId,
 * which — for an event with exactly one terminal tool — is the very same
 * toolUseId as that terminal card itself. Without the prefix, toggling the
 * outer group would silently overwrite the independent remembered state of
 * the inner terminal card (and vice versa).
 */
const timelineDetailsOpenState = new Map<string, boolean>();
const TIMELINE_DETAILS_OPEN_STATE_MAX = 256;

const TIMELINE_GROUP_OPEN_STATE_PREFIX = 'group:';
const TIMELINE_TERMINAL_OPEN_STATE_PREFIX = 'terminal:';

function timelineGroupOpenStateKey(key: string): string {
    return TIMELINE_GROUP_OPEN_STATE_PREFIX + key;
}

function timelineTerminalOpenStateKey(toolUseId: string): string {
    return TIMELINE_TERMINAL_OPEN_STATE_PREFIX + toolUseId;
}

/** Records the latest user/programmatic open state for `key`, evicting the
 *  least-recently-touched entry once the cap is exceeded. */
function recordTimelineDetailsOpenState(key: string, open: boolean): void {
    timelineDetailsOpenState.delete(key);
    timelineDetailsOpenState.set(key, open);
    while (timelineDetailsOpenState.size > TIMELINE_DETAILS_OPEN_STATE_MAX) {
        const oldest = timelineDetailsOpenState.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        timelineDetailsOpenState.delete(oldest);
    }
}

/**
 * Test-only helper: clears {@link timelineDetailsOpenState}. This module-level
 * map is deliberately process-lifetime-scoped in production (see the doc
 * comment above), but that means specs that reuse tool-use ids (e.g.
 * `tool-read-page`) across `it()` blocks leak open/closed state between them.
 * Call this from `beforeEach()` in specs that assert default collapsed/open
 * state for a tool group or terminal card. Not for production use.
 */
export function resetTimelineDetailsOpenStateForTesting(): void {
    timelineDetailsOpenState.clear();
}

/** Stable content signature for the whole rendered event list. Used to avoid
 *  touching DOM at all on duplicate SSE frames. */
const timelineEventSignatureCache = new WeakMap<HTMLElement, string>();

// ─── Types ───────────────────────────────────────────────────────────────────

export type MobileEventKind = 'explore' | 'read' | 'write' | 'edit' | 'delete' | 'run' | 'verification' | 'other';

export interface MobileExecutionTool {
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
    segmentIndex: number;
    kind: MobileEventKind;
    verb: string;
    detail: string;
    filePath?: string;
    isTerminal: boolean;
    isVerification: boolean;
    isError: boolean;
    isFinished: boolean;
}

export interface MobileExecutionEvent {
    id: string;
    narrative: string;
    narrativeSource: 'agent' | 'synthetic';
    kind: MobileEventKind;
    icon: string;
    verb: string;
    tools: MobileExecutionTool[];
    hasPending: boolean;
    hasError: boolean;
}

export interface MobileExecutionTimeline {
    events: MobileExecutionEvent[];
    closingNarrative?: string;
}

export const MOBILE_TOOL_FILE_OPEN_EVENT = 'qaap-mobile-tool-file-open';

// ─── Builder ─────────────────────────────────────────────────────────────────

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

// ─── Summary formatting ──────────────────────────────────────────────────────

export function formatMobileEventSummary(event: MobileExecutionEvent): string {
    const count = event.tools.length;
    const noun = pluralize(count, mobileToolNoun(event));
    return `${count} ${noun}`;
}

/**
 * Resolves the Codex-style live activity verb for the process accordion
 * label: the {@link MobileExecutionEvent.verb} of the LAST event in
 * `events` that still has pending tools (i.e. whichever tool group is
 * actively spinning right now). Returns undefined when nothing is pending
 * (e.g. between tool groups, or before the first tool has arrived), in which
 * case the caller should fall back to the generic "Processing…" label.
 */
export function resolveMobileActivityVerb(events: readonly MobileExecutionEvent[]): string | undefined {
    for (let i = events.length - 1; i >= 0; i--) {
        if (events[i].hasPending) {
            return events[i].verb;
        }
    }
    return undefined;
}

function fingerprintMobileTool(tool: MobileExecutionTool): string {
    const segment = tool.segment;
    const args = segment.args;
    const result = segment.result;
    // Cheap fingerprint: these values are only ever compared for equality,
    // never displayed, so lengths (+ a short tail slice for same-length
    // paranoia) are enough to detect growth without embedding the full
    // args/result strings -- mirrors segmentToolFingerprint in
    // qaap-transcript-incremental-update.ts.
    return [
        tool.segmentIndex,
        segment.toolUseId,
        segment.name,
        tool.kind,
        tool.verb,
        tool.detail,
        tool.filePath ?? '',
        tool.isFinished ? '1' : '0',
        tool.isError ? '1' : '0',
        `${args?.length ?? 0}:${result?.length ?? 0}`,
        result?.slice(0, 16) ?? '',
        result?.slice(-32) ?? '',
    ].join('\u001f');
}

function fingerprintMobileExecutionEvent(event: MobileExecutionEvent): string {
    return [
        event.id,
        event.kind,
        event.verb,
        event.icon,
        event.narrativeSource,
        event.narrative,
        event.hasPending ? '1' : '0',
        event.hasError ? '1' : '0',
        event.tools.map(fingerprintMobileTool).join('\u001e'),
    ].join('\u001d');
}

function fingerprintMobileExecutionEvents(events: readonly MobileExecutionEvent[]): string {
    return events.map(fingerprintMobileExecutionEvent).join('\u001c');
}

function mobileToolNoun(event: MobileExecutionEvent): string {
    switch (event.kind) {
        case 'explore': return 'search';
        case 'read': return 'file';
        case 'write': return 'file';
        case 'edit': return 'file';
        case 'delete': return 'file';
        case 'run': return 'command';
        case 'verification': return 'check';
        default: return 'step';
    }
}

function pluralize(count: number, noun: string): string {
    if (count === 1) {
        return noun;
    }
    if (noun.endsWith('ch') || noun.endsWith('sh')) {
        return `${noun}es`;
    }
    return `${noun}s`;
}

// ─── DOM Rendering ───────────────────────────────────────────────────────────

/** CSS class on the top-level execution event timeline container. */
export const MOBILE_EXECUTION_TIMELINE_CLASS = 'theia-mobile-execution-timeline';

/** CSS class on the process accordion that wraps the timeline. */
export const MOBILE_PROCESS_ACCORDION_CLASS = 'theia-mobile-process-accordion';

/** Legacy ThinkingOrb host class — no longer mounted; kept for strip/cleanup. */
export const MOBILE_PROCESS_ACCORDION_LOGO_CLASS = 'theia-mobile-process-accordion-logo';

/** Data attribute: whether the user manually toggled the accordion. */
const PROCESS_ACCORDION_USER_TOGGLED_ATTR = 'data-user-toggled';

/**
 * Creates the Codex-style execution event timeline as a DOM element.
 * Replaces the old activity timeline + tool pills + diff/verification cards.
 *
 * Note: closing narrative (text after the last tool) is NOT rendered here.
 * The caller is responsible for rendering it as a rich content block so the
 * agent's final answer gets full markdown rendering.
 */
export function createMobileExecutionEventTimeline(
    segments: readonly QaapAgentMessageSegmentDTO[],
): HTMLElement {
    const timeline = buildMobileExecutionEvents(segments);
    const container = document.createElement('div');
    container.className = MOBILE_EXECUTION_TIMELINE_CLASS;

    const fragment = document.createDocumentFragment();
    for (const event of timeline.events) {
        fragment.append(createMobileExecutionEventElement(event));
    }
    container.append(fragment);

    timelineEventCache.set(container, timeline.events);
    timelineEventSignatureCache.set(container, fingerprintMobileExecutionEvents(timeline.events));
    return container;
}

/**
 * Returns true if the row already contains a Codex-style execution event timeline.
 * Used by streaming-patch methods to decide whether to rebuild the new timeline
 * instead of falling back to the legacy activity-timeline DOM.
 */
export function hasMobileExecutionEventTimeline(row: HTMLElement): boolean {
    return !!row.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);
}

// ─── Process Accordion ───────────────────────────────────────────────────────
// The single collapsible container for all agent process steps.
// Wraps the execution event timeline. The header shows "Processed in Xm Ys".
// Auto-expands while working, auto-collapses on success, stays open on error.
// A manual user toggle persists for the rest of the turn — the accordion
// never auto-expands during that active turn after that. Successful final
// settlement is the only automatic collapse and it also closes a manually
// expanded accordion.

export interface MobileProcessAccordionOptions {
    /** Whether the agent is currently working (streaming/incomplete). */
    readonly isWorking: boolean;
    /** Whether the agent ended in an error state. */
    readonly isError: boolean;
    /**
     * Codex-style live activity verb (e.g. `'Read'`, `'Run'`, `'Explore'`),
     * taken verbatim from the {@link MobileExecutionEvent.verb} of the LAST
     * event that still has pending tools. Only meaningful while `isWorking`
     * is true; ignored otherwise. When undefined (nothing pending yet, or
     * the caller couldn't resolve one), the label falls back to the generic
     * "Processing…" text.
     */
    readonly activityVerb?: string;
    /**
     * True when the turn was manually stopped by the user rather than ending
     * in a genuine failure (e.g. a `run_cancelled` AG-UI trace event). Takes
     * precedence over `isError` for the header label ("Stopped after {0}"
     * instead of "Processed in {0}") but is treated the same as `isError` for
     * expand/collapse — a stopped turn stays expanded so the partial work is
     * still visible, matching the "leave evidence visible" rule.
     */
    readonly isCancelled?: boolean;
    /** Elapsed execution time in milliseconds, or undefined if unknown. */
    readonly elapsedMs?: number;
    /**
     * Start timestamp (ms epoch) of the current turn, if known. When set and
     * `isWorking` is true, the header label ticks live (updated every 500ms
     * via {@link sharedElapsedTicker}) instead of only updating when a patch
     * happens to re-render it.
     */
    readonly turnStartMs?: number;
    /**
     * True only when the turn has definitively finished and the final content
     * is being committed. Auto-collapse happens exclusively with this flag; a
     * transient `isWorking === false` between tools must never collapse the
     * accordion, otherwise it visibly oscillates open/closed during the stream.
     */
    readonly settled?: boolean;
}

/**
 * Creates the process accordion `<details>` element that wraps the execution
 * event timeline. The timeline is rendered inside as a child.
 *
 * The accordion is auto-expanded when `isWorking` or `isError` is true, and
 * auto-collapsed only when a successful turn is finalized (`settled: true`).
 * Once the user manually toggles it (detected via the `data-user-toggled`
 * attribute), auto-expansion is suppressed for the remainder of the active
 * turn. A successful final settle still collapses the accordion so the final
 * response can take focus. The flag is never cleared programmatically; a new
 * turn renders a fresh accordion element or a fresh turn-state key.
 */
export function createMobileProcessAccordion(
    segments: readonly QaapAgentMessageSegmentDTO[],
    options: MobileProcessAccordionOptions,
): HTMLElement {
    const timeline = createMobileExecutionEventTimeline(segments);
    return wrapMobileProcessAccordion(timeline, options);
}

/**
 * Wraps an existing timeline element in a process accordion `<details>`.
 * Extracted so callers that already have a timeline (e.g. from
 * {@link createMobileExecutionEventTimeline}) can wrap it without rebuilding.
 */
export function wrapMobileProcessAccordion(
    timeline: HTMLElement,
    options: MobileProcessAccordionOptions,
): HTMLElement {
    const { isWorking, isError, isCancelled, elapsedMs, turnStartMs, activityVerb, settled } = options;
    const details = document.createElement('details');
    details.className =
        `${MOBILE_PROCESS_ACCORDION_CLASS} ${isWorking ? 'theia-mod-working' : ''} ${isError ? 'theia-mod-error' : ''}` +
        ` ${isCancelled ? 'theia-mod-cancelled' : ''} ${!isWorking && !isError && !isCancelled ? 'theia-mod-complete' : ''}`;
    // Auto-expand while working, on error, or when stopped by the user. When
    // this turn already rendered an accordion before (row rebuilt mid-stream
    // by a full re-render or a patch fallback), restore the previous element's
    // open/user-toggled state instead of recomputing it — a transient
    // `isWorking === false` snapshot at rebuild time must not create the new
    // accordion collapsed. A successful final settle is the only exception:
    // it always starts collapsed because the final response is now committed.
    const remembered = turnStartMs !== undefined ? processAccordionTurnState.get(turnStartMs) : undefined;
    if (settled === true && !isError && !isCancelled) {
        details.open = false;
    } else if (remembered) {
        // Keep mid-stream rebuilds expanded while the agent is active unless
        // the user explicitly collapsed — a detach-fired toggle can poison
        // remembered.open to false and flash the accordion closed.
        const autoShouldOpen = isWorking || isError || !!isCancelled;
        if (autoShouldOpen && !remembered.userToggled) {
            details.open = true;
        } else {
            details.open = remembered.open;
        }
        if (remembered.userToggled) {
            details.setAttribute(PROCESS_ACCORDION_USER_TOGGLED_ATTR, '1');
        }
    } else {
        details.open = isWorking || isError || !!isCancelled;
    }

    const header = document.createElement('summary');
    header.className = 'theia-mobile-process-accordion-header';

    const label = document.createElement('span');
    label.className = 'theia-mobile-process-accordion-label';
    label.textContent = formatMobileProcessLabel(elapsedMs, resolveMobileProcessOutcome(options), activityVerb);
    syncMobileProcessAccordionLabelTicker(label, isWorking, turnStartMs, activityVerb);

    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down theia-mobile-process-accordion-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    header.append(label, chevron);
    // Orb lives in the pinned stream footer — never in the accordion header.
    syncMobileProcessAccordionBrandLogo(header, false);
    details.append(header);

    // Content wrapper — children are only rendered when open (lazy).
    const content = document.createElement('div');
    content.className = 'theia-mobile-process-accordion-content';
    content.append(timeline);
    details.append(content);

    // Track user manual toggles — only on summary (header) clicks, not on
    // clicks inside the content (tool details, terminal output, etc.).
    header.addEventListener('click', () => {
        details.setAttribute(PROCESS_ACCORDION_USER_TOGGLED_ATTR, '1');
    });

    // Keep the per-turn sticky state in sync with EVERY open change (user
    // click, auto expand/collapse, deferred rAF collapse) so a rebuilt
    // accordion always starts from the freshest state.
    if (turnStartMs !== undefined) {
        details.addEventListener('toggle', () => {
            // Detaching an open <details> can fire toggle(open=false) while
            // disconnected — ignore that synthetic close so sticky state stays
            // stable across remounts.
            if (!details.isConnected && !details.open) {
                return;
            }
            recordProcessAccordionTurnState(turnStartMs, details);
        });
        recordProcessAccordionTurnState(turnStartMs, details);
    }

    return details;
}

/**
 * Per-turn sticky accordion state, keyed by the turn's start timestamp.
 * Survives full row rebuilds (re-render after refetch, patch fallback), which
 * create a brand-new `<details>` element — without this, each rebuild
 * recomputed the open state from a possibly-flickering `isWorking` snapshot
 * and the accordion visibly oscillated open/closed mid-stream.
 */
const processAccordionTurnState = new Map<number, { open: boolean; userToggled: boolean }>();
const PROCESS_ACCORDION_TURN_STATE_MAX = 32;

function recordProcessAccordionTurnState(turnStartMs: number, details: HTMLDetailsElement): void {
    processAccordionTurnState.delete(turnStartMs);
    processAccordionTurnState.set(turnStartMs, {
        open: details.open,
        userToggled: details.getAttribute(PROCESS_ACCORDION_USER_TOGGLED_ATTR) === '1',
    });
    while (processAccordionTurnState.size > PROCESS_ACCORDION_TURN_STATE_MAX) {
        const oldest = processAccordionTurnState.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        processAccordionTurnState.delete(oldest);
    }
}

/**
 * Strips any ThinkingOrb from the process accordion header. The orb belongs
 * only in the pinned stream footer above the composer.
 */
export function syncMobileProcessAccordionBrandLogo(
    header: HTMLElement,
    _show?: boolean,
    _activity?: {
        readonly activityVerb?: string;
        readonly isWorking?: boolean;
        readonly isError?: boolean;
        readonly isCancelled?: boolean;
    },
): void {
    for (const existing of header.querySelectorAll<HTMLElement>(`.${MOBILE_PROCESS_ACCORDION_LOGO_CLASS}`)) {
        destroyThinkingOrbIndicator(existing);
        existing.remove();
    }
}

/**
 * Registers (or unregisters) the shared elapsed-time ticker for a process
 * accordion's header label, so the "Processing… Xs" / "<Verb>… Xs" label
 * keeps ticking even during quiet stretches with no tool-segment patches.
 * Only active while `isWorking` is true and a `turnStartMs` is known;
 * unregistered otherwise (settled, error, or when the caller doesn't know the
 * turn start).
 *
 * `activityVerb` is captured in the render closure, so calling this again
 * with a different verb (as the caller does on every sync tick, re-deriving
 * it from the latest pending event) transparently re-registers with the new
 * label text — {@link QaapSharedElapsedTicker.register} keys its targets map
 * by `element`, so the previous closure for this label is simply replaced.
 */
function syncMobileProcessAccordionLabelTicker(
    label: HTMLElement,
    isWorking: boolean,
    turnStartMs: number | undefined,
    activityVerb: string | undefined,
): void {
    const nextKey = isWorking && turnStartMs !== undefined
        ? `${turnStartMs}:${activityVerb ?? ''}`
        : '';
    const prevKey = label.dataset.qaapProcessTickerKey ?? '';
    if (nextKey === prevKey) {
        return;
    }
    label.dataset.qaapProcessTickerKey = nextKey;
    sharedElapsedTicker.unregister(label);
    if (isWorking && turnStartMs !== undefined) {
        sharedElapsedTicker.register({
            element: label,
            render: now => {
                label.textContent = formatMobileProcessLabel(Math.max(0, now - turnStartMs), 'processing', activityVerb);
            },
        });
    }
}

/**
 * Updates the process accordion's auto-expand/collapse state and header label
 * based on the current agent status. Called during streaming patches and
 * finalization.
 *
 * Rules:
 * - If the user has manually toggled (`data-user-toggled="1"`), the auto
 *   expansion logic below is skipped while the turn is active — the flag is
 *   never cleared by this function, so the user's choice persists until the
 *   turn really settles. A new turn renders a fresh accordion element/state
 *   key, so the flag naturally starts clear again.
 * - Working or error → expanded. Completed successfully → collapsed, but only
 *   on a `settled` sync. A transient `isWorking === false` during streaming
 *   leaves the accordion exactly as-is, so it never oscillates mid-stream.
 * - The header label is always updated to reflect the current elapsed time,
 *   even when the user has manually toggled the accordion.
 */
export function syncMobileProcessAccordionState(
    accordion: HTMLElement,
    options: MobileProcessAccordionOptions,
): void {
    if (!accordion.classList.contains(MOBILE_PROCESS_ACCORDION_CLASS)) {
        return;
    }
    const details = accordion as HTMLDetailsElement;
    const { isWorking, isError, isCancelled, elapsedMs, turnStartMs, activityVerb } = options;

    // Update the label regardless of toggle state.
    const label = details.querySelector<HTMLElement>('.theia-mobile-process-accordion-label');
    if (label) {
        if (!(isWorking && turnStartMs !== undefined)) {
            // While working with a known turn start, registering on the ticker
            // below renders immediately — skip the redundant direct write.
            label.textContent = formatMobileProcessLabel(elapsedMs, resolveMobileProcessOutcome(options), activityVerb);
        }
        syncMobileProcessAccordionLabelTicker(label, isWorking, turnStartMs, activityVerb);
    }

    const header = details.querySelector<HTMLElement>('.theia-mobile-process-accordion-header');
    if (header) {
        syncMobileProcessAccordionBrandLogo(header, false);
    }

    // Update modifier classes.
    details.classList.toggle('theia-mod-working', isWorking);
    details.classList.toggle('theia-mod-error', isError);
    details.classList.toggle('theia-mod-cancelled', !!isCancelled);
    details.classList.toggle('theia-mod-complete', !isWorking && !isError && !isCancelled);

    const finalSuccessfulSettle = options.settled === true && !isError && !isCancelled;

    // If the user manually toggled, respect their choice while the turn is
    // active — never fight the user by auto-expanding during intermediate
    // transitions. Final successful settlement is allowed to collapse.
    if (!finalSuccessfulSettle && details.getAttribute(PROCESS_ACCORDION_USER_TOGGLED_ATTR) === '1') {
        return;
    }

    // Auto-expand/collapse.
    //
    // Expansion happens whenever the agent is working, errored, or was
    // stopped by the user. Collapse only happens on final successful settle.
    // Any other `!isWorking` sync (streaming flicker, quiet pause between
    // tools, finalizing transition before the response is committed) leaves
    // the current open state unchanged.
    const shouldOpen = isWorking || isError || !!isCancelled;
    if (shouldOpen) {
        if (!details.open) {
            details.open = true;
            if (turnStartMs !== undefined) {
                recordProcessAccordionTurnState(turnStartMs, details);
            }
        }
        return;
    }
    if (finalSuccessfulSettle && details.open) {
        details.open = false;
        if (turnStartMs !== undefined) {
            recordProcessAccordionTurnState(turnStartMs, details);
        }
    }
}

/**
 * Returns true if the row contains a process accordion.
 */
export function hasMobileProcessAccordion(row: HTMLElement): boolean {
    return !!row.querySelector(`.${MOBILE_PROCESS_ACCORDION_CLASS}`);
}

/**
 * Finds the process accordion element within a segments body, if present.
 */
export function findMobileProcessAccordion(segmentsBody: HTMLElement): HTMLDetailsElement | undefined {
    return segmentsBody.querySelector<HTMLDetailsElement>(`.${MOBILE_PROCESS_ACCORDION_CLASS}`) ?? undefined;
}

/**
 * The process accordion header conveys one of four outcomes for the turn.
 * `processing` while streaming; once settled, exactly one of `processed`
 * (success), `stopped` (user cancelled), or `failed` (genuine error) — never
 * "Processed" for a turn the user manually stopped.
 */
type MobileProcessOutcome = 'processing' | 'processed' | 'stopped' | 'failed';

function resolveMobileProcessOutcome(
    options: Pick<MobileProcessAccordionOptions, 'isWorking' | 'isError' | 'isCancelled'>,
): MobileProcessOutcome {
    if (options.isWorking) {
        return 'processing';
    }
    if (options.isCancelled) {
        return 'stopped';
    }
    if (options.isError) {
        return 'failed';
    }
    return 'processed';
}

/**
 * Formats the process accordion header label. While `outcome === 'processing'`
 * and an `activityVerb` is known (the Codex-style live activity verb, e.g.
 * `'Read'` / `'Run'` / `'Explore'` — see {@link resolveMobileActivityVerb}),
 * the label reads `'<Verb>… Xs'` instead of the generic `'Processing… Xs'`.
 * The verb is reused verbatim from {@link MobileExecutionEvent.verb} — never
 * conjugated (e.g. no invented `'Reading'` from `'Read'`) — so this never
 * introduces a new display string beyond what the timeline already shows.
 */
function formatMobileProcessLabel(elapsedMs: number | undefined, outcome: MobileProcessOutcome, activityVerb?: string): string {
    if (elapsedMs === undefined) {
        switch (outcome) {
            case 'processing':
                if (activityVerb) {
                    return nls.localize('theia/qaap-mobile-shell/processTimeline/workingOnNoElapsed', '{0}…', activityVerb);
                }
                return nls.localize('theia/qaap-mobile-shell/processTimeline/processing', 'Processing…');
            case 'stopped':
                return nls.localize('theia/qaap-mobile-shell/processTimeline/stopped', 'Stopped');
            case 'failed':
                return nls.localize('theia/qaap-mobile-shell/processTimeline/failed', 'Failed');
            default:
                return nls.localize('theia/qaap-mobile-shell/processTimeline/processed', 'Processed');
        }
    }
    const formatted = formatMobileElapsed(elapsedMs);
    switch (outcome) {
        case 'processing':
            if (activityVerb) {
                return nls.localize('theia/qaap-mobile-shell/processTimeline/workingOn', '{0}… {1}', activityVerb, formatted);
            }
            return nls.localize('theia/qaap-mobile-shell/processTimeline/processingElapsed', 'Processing… {0}', formatted);
        case 'stopped':
            return nls.localize('theia/qaap-mobile-shell/processTimeline/stoppedAfter', 'Stopped after {0}', formatted);
        case 'failed':
            return nls.localize('theia/qaap-mobile-shell/processTimeline/failedAfter', 'Failed after {0}', formatted);
        default:
            return nls.localize('theia/qaap-mobile-shell/processTimeline/processedIn', 'Processed in {0}', formatted);
    }
}

function formatMobileElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) {
        return `${totalSeconds}s`;
    }
    const totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60) {
        return `${totalMinutes}m ${totalSeconds % 60}s`;
    }
    return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}

/**
 * Attempts to patch an existing timeline `container` in place so that it
 * matches `nextEvents`, given it currently reflects `prevEvents`. Returns
 * `false` (without mutating the DOM) whenever the shapes have diverged too
 * much to patch safely — callers should then fall back to a full rebuild.
 *
 * This only ever needs to handle streaming growth: events keep their ids in
 * order, tools are appended (never removed/reordered), and in-flight tool
 * segments only grow their `args`/`result` or flip from unfinished to
 * finished. Anything else (e.g. an event or tool being edited/removed)
 * returns `false` so the caller rebuilds instead of risking a stale DOM.
 */
export function tryPatchMobileExecutionEventTimeline(
    container: HTMLElement,
    prevEvents: readonly MobileExecutionEvent[],
    nextEvents: readonly MobileExecutionEvent[],
): boolean {
    if (nextEvents.length < prevEvents.length) {
        return false;
    }
    for (let i = 0; i < prevEvents.length; i++) {
        const prevEvent = prevEvents[i];
        const nextEvent = nextEvents[i];
        if (prevEvent.id !== nextEvent.id) {
            return false;
        }
        // Event `kind` can flip while args stream in (e.g. a `run` command
        // turning out to be a `verification` command once the full args are
        // in), and a synthetic narrative can be replaced by agent-authored
        // text. Both used to force a full rebuild here, which recreated every
        // node and visibly restarted the shimmer/spinner animations mid-edit.
        // patchMobileExecutionEventSection now patches the kind-derived chrome
        // (section class, group icon/verb, tool rows) and inserts/removes the
        // narrative <p> in place instead. Tool-row `kind` can flip the same way
        // (run → verification); patchMobileToolDetail replaces that one row.
        if (nextEvent.tools.length < prevEvent.tools.length) {
            return false;
        }
        for (let j = 0; j < prevEvent.tools.length; j++) {
            const prevTool = prevEvent.tools[j];
            const nextTool = nextEvent.tools[j];
            const p = prevTool.segment;
            const n = nextTool.segment;
            if (p.toolUseId !== n.toolUseId) {
                return false;
            }
            if (p.finished && !n.finished) {
                return false;
            }
            if ((p.finished !== n.finished || p.args !== n.args || p.result !== n.result) && !canPatchToolSegmentGrowth(p, n)) {
                return false;
            }
        }
    }

    // Structural validation — every section that patching would touch must
    // already have the exact DOM shape createMobileExecutionEventElement
    // produces. This must run to completion BEFORE any mutation below: either
    // every check passes and the whole patch proceeds, or one fails and we
    // return false having written nothing, so the caller's full-rebuild
    // fallback never has to reconcile a half-patched DOM.
    const sections = container.querySelectorAll<HTMLElement>(':scope > section.theia-mobile-execution-event');
    if (sections.length !== prevEvents.length) {
        return false;
    }
    for (let i = 0; i < prevEvents.length; i++) {
        const group = sections[i].querySelector<HTMLDetailsElement>(':scope > details.theia-mobile-tool-group');
        if (!group) {
            return false;
        }
        const detailsContainer = group.querySelector<HTMLElement>(':scope > div.theia-mobile-tool-group-details');
        if (!detailsContainer || detailsContainer.children.length !== prevEvents[i].tools.length) {
            return false;
        }
    }

    for (let i = 0; i < prevEvents.length; i++) {
        if (fingerprintMobileExecutionEvent(prevEvents[i]) === fingerprintMobileExecutionEvent(nextEvents[i])) {
            recordTranscriptRenderMetric('timeline_event_item_sync_skipped');
            continue;
        }
        patchMobileExecutionEventSection(sections[i], prevEvents[i], nextEvents[i]);
    }
    const fragment = document.createDocumentFragment();
    for (let i = prevEvents.length; i < nextEvents.length; i++) {
        fragment.append(createMobileExecutionEventElement(nextEvents[i]));
    }
    if (fragment.childNodes.length > 0) {
        container.append(fragment);
    }
    return true;
}

/** Patches a single `section.theia-mobile-execution-event` element in place. */
function patchMobileExecutionEventSection(
    section: HTMLElement,
    prev: MobileExecutionEvent,
    next: MobileExecutionEvent,
): void {
    // A synthetic narrative renders no <p> at all (see
    // createMobileExecutionEventElement), so a synthetic↔agent transition
    // inserts or removes the narrative element in place.
    const existingNarrative = section.querySelector<HTMLElement>(':scope > p.theia-mobile-execution-event-narrative');
    if (next.narrativeSource === 'synthetic') {
        existingNarrative?.remove();
    } else {
        let narrativeEl = existingNarrative;
        if (!narrativeEl) {
            narrativeEl = document.createElement('p');
            narrativeEl.className = 'theia-mobile-execution-event-narrative theia-mod-agent';
            narrativeEl.textContent = next.narrative;
            section.prepend(narrativeEl);
        } else if (prev.narrative !== next.narrative) {
            narrativeEl.textContent = next.narrative;
        }
    }

    if (prev.kind !== next.kind) {
        section.classList.remove(`theia-mod-${prev.kind}`);
        section.classList.add(`theia-mod-${next.kind}`);
    }
    section.classList.toggle('theia-mod-error', next.hasError);
    section.classList.toggle('theia-mod-running', next.hasPending);

    const group = section.querySelector<HTMLDetailsElement>(':scope > details.theia-mobile-tool-group');
    if (!group) {
        // Unreachable: tryPatchMobileExecutionEventTimeline validates that
        // every section it patches already has a tool group before this
        // function is ever called.
        throw new Error('patchMobileExecutionEventSection: missing tool group despite passing validation');
    }
    group.classList.toggle('failed', next.hasError);
    group.classList.toggle('running', next.hasPending);
    group.classList.toggle('finished', !next.hasPending);
    // Preserve classes added at create time (e.g. theia-mod-web-search).

    const icon = group.querySelector<HTMLElement>('.theia-mobile-tool-group-icon');
    if (icon && prev.icon !== next.icon) {
        icon.className = `codicon ${next.icon} theia-mobile-tool-group-icon`;
    }
    if (icon) {
        syncActivityToolIconMotion(icon, next.hasPending && !next.hasError, next.kind);
    }
    const meta = group.querySelector<HTMLElement>('.theia-mobile-tool-group-meta');
    if (meta) {
        meta.classList.toggle('theia-mod-shimmer', next.hasPending);
        const summaryText = formatMobileEventSummary(next);
        if (meta.textContent !== summaryText) {
            meta.textContent = summaryText;
        }
    }
    const verb = group.querySelector<HTMLElement>('.theia-mobile-tool-group-verb');
    if (verb) {
        verb.classList.toggle('theia-mod-shimmer', next.hasPending);
        if (prev.verb !== next.verb) {
            verb.textContent = next.verb;
        }
    }

    const state = group.querySelector<HTMLElement>('.theia-mobile-tool-group-state');
    if (state && (prev.hasPending !== next.hasPending || prev.hasError !== next.hasError)) {
        state.classList.toggle('failed', next.hasError);
        state.classList.toggle('running', next.hasPending && !next.hasError);
        state.classList.toggle('complete', !next.hasPending && !next.hasError);
        const stateIcon = state.querySelector<HTMLElement>('.codicon');
        if (stateIcon) {
            stateIcon.className = `codicon ${next.hasError ? 'codicon-error' : next.hasPending ? 'codicon-loading theia-animation-spin' : 'codicon-check'}`;
        }
    }

    const detailsContainer = group.querySelector<HTMLElement>(':scope > div.theia-mobile-tool-group-details');
    if (!detailsContainer) {
        // Unreachable: validated alongside the tool group above.
        throw new Error('patchMobileExecutionEventSection: missing tool group details container despite passing validation');
    }
    for (let j = 0; j < prev.tools.length; j++) {
        const el = detailsContainer.children.item(j) as HTMLElement | null;
        if (el) {
            patchMobileToolDetail(el, prev.tools[j], next.tools[j], prev, next, j);
        }
    }
    for (let j = prev.tools.length; j < next.tools.length; j++) {
        detailsContainer.append(createMobileToolDetailElement(next, next.tools[j], j));
    }
}

/**
 * Builds (or refreshes) the terminal output from `result`, replacing the
 * pending placeholder if present. Shared by the eager render path (terminal
 * created/patched while open) and the lazy first-open handler below.
 */
function renderMobileTerminalOutput(content: HTMLElement, result: string): void {
    const clean = stripAnsiEscapes(result);
    const existing = content.querySelector<HTMLElement>('.theia-mobile-terminal-output-pre, .theia-mobile-terminal-output-code-view');
    const language = resolveMobileTerminalOutputLanguage(clean);
    const placeholder = content.querySelector('.theia-mobile-terminal-output-pending');
    if (placeholder) {
        placeholder.remove();
    }
    // Streaming output grows tick by tick — patch the existing view so only
    // changed/new lines are re-tokenized, instead of rebuilding (and
    // re-highlighting) the entire output on every tick.
    if (existing && patchTranscriptCodeView(existing, clean, language)) {
        return;
    }
    const next = createMobileTerminalCodeView(clean, language);
    if (existing) {
        existing.replaceWith(next);
    } else {
        content.append(next);
    }
}

type MobileTerminalOutputLanguage = Exclude<TranscriptCodeLanguage, 'plain'>;

function resolveMobileTerminalOutputLanguage(output: string): MobileTerminalOutputLanguage {
    const inferred = resolveTranscriptCodeLanguage(undefined, output);
    if (inferred !== 'plain') {
        return inferred;
    }
    return 'log';
}

function createMobileTerminalCodeView(output: string, language: MobileTerminalOutputLanguage): HTMLElement {
    const view = createTranscriptCodeView(output, language);
    view.classList.add('theia-mobile-terminal-output-code-view');
    return view;
}

/**
 * Renders deferred terminal stdout/stderr when a card opens. Programmatic
 * `details.open = …` does not reliably fire `toggle`, so callers that flip
 * `open` themselves must invoke this (summary click handler, restore paths).
 * When no result is available for a finished card, paints an explicit empty
 * state so the expanded body is never a blank void.
 */
function flushMobileTerminalOutputIfPending(details: HTMLDetailsElement, content: HTMLElement): void {
    const latest = pendingTerminalOutputResult.get(details);
    if (latest !== undefined && latest.trim()) {
        renderMobileTerminalOutput(content, latest);
        return;
    }
    // Only paint empty-state when the card is finished (complete/failed).
    // While running, keep the existing "Running…" placeholder.
    if (details.classList.contains('complete') || details.classList.contains('failed')) {
        ensureMobileTerminalEmptyOutputState(content);
    }
}

/** Explicit empty body for a completed terminal card with no stdout/stderr. */
function ensureMobileTerminalEmptyOutputState(content: HTMLElement): void {
    content.querySelector('.theia-mobile-terminal-output-pending')?.remove();
    if (content.querySelector(
        '.theia-mobile-terminal-output-code-view, .theia-mobile-terminal-output-pre, .theia-mobile-terminal-output-empty',
    )) {
        return;
    }
    const empty = document.createElement('span');
    empty.className = 'theia-mobile-terminal-output-empty';
    empty.textContent = nls.localize('qaap/mobileProjects/terminalOutputEmpty', 'No output');
    content.append(empty);
}

/**
 * Defers building terminal output until the `<details>` is first opened,
 * so collapsed terminal cards never pay the stripAnsiEscapes + DOM cost while
 * streaming. Reads whatever the latest result is from
 * {@link pendingTerminalOutputResult} at open time, not just what was known
 * when the handler was attached.
 */
function attachMobileTerminalLazyOpenHandler(details: HTMLDetailsElement, content: HTMLElement): void {
    details.addEventListener('toggle', function onFirstOpen() {
        if (!details.open) {
            return;
        }
        details.removeEventListener('toggle', onFirstOpen);
        flushMobileTerminalOutputIfPending(details, content);
    });
}

/** Patches a single tool-detail row (terminal card or plain/error line) in place. */
function patchMobileToolDetail(
    el: HTMLElement,
    prevTool: MobileExecutionTool,
    nextTool: MobileExecutionTool,
    prevEvent: MobileExecutionEvent,
    event: MobileExecutionEvent,
    index: number,
): void {
    if (el instanceof HTMLDetailsElement && el.classList.contains('theia-mobile-terminal-output')) {
        el.classList.toggle('failed', nextTool.isError);
        el.classList.toggle('complete', nextTool.isFinished && !nextTool.isError);
        el.classList.toggle('running', !nextTool.isFinished);

        if (prevTool.isError !== nextTool.isError || prevTool.isFinished !== nextTool.isFinished) {
            const stateIcon = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-state');
            if (stateIcon) {
                stateIcon.className =
                    `codicon ${nextTool.isError ? 'codicon-error' : nextTool.isFinished ? 'codicon-check' : 'codicon-loading theia-animation-spin'} theia-mobile-terminal-output-state`;
            }
        }

        if (prevTool.detail !== nextTool.detail) {
            const detailEl = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-detail');
            if (detailEl) {
                renderMobileShellCommandDetail(detailEl, nextTool.detail);
            }
        }

        const content = el.querySelector<HTMLElement>('.theia-mobile-terminal-output-content');
        if (content) {
            const nextResult = nextTool.segment.result;
            // Always remember the latest result so a deferred (lazy) open
            // later picks up fresh content, even if it streamed in while
            // the card was collapsed.
            if (nextResult) {
                pendingTerminalOutputResult.set(el, nextResult);
            }
            const latestResult = nextResult || pendingTerminalOutputResult.get(el);
            if (!el.open) {
                // Collapsed: skip the stripAnsiEscapes + code-view DOM work
                // entirely — the lazy open handler attached at creation
                // covers it once the user expands the card. Still clear a
                // stale pending placeholder so a later open doesn't show
                // "Running…" for a tool that already finished empty.
                if (!latestResult && nextTool.isFinished) {
                    const placeholder = content.querySelector('.theia-mobile-terminal-output-pending');
                    if (placeholder) {
                        placeholder.remove();
                    }
                }
            } else if (latestResult) {
                renderMobileTerminalOutput(content, latestResult);
            } else if (nextTool.isFinished) {
                ensureMobileTerminalEmptyOutputState(content);
            }
        }
        return;
    }

    if (el.classList.contains(TRANSCRIPT_WEB_SEARCH_CARD_CLASS)
        || isTranscriptWebSearchTool(nextTool.segment.name)) {
        const payload = resolveTranscriptWebSearchPayload(nextTool.segment);
        if (el.classList.contains(TRANSCRIPT_WEB_SEARCH_CARD_CLASS)
            && patchTranscriptWebSearchCard(el, payload)) {
            return;
        }
        el.replaceWith(createMobileToolDetailElement(event, nextTool, index));
        return;
    }

    // Structural transitions (error flip adds an error icon, a kind flip
    // changes icon/link semantics) are rare one-shot changes and plain rows
    // carry no animations, so a targeted row replace is safe there.
    if (prevTool.isError !== nextTool.isError
        || prevEvent.kind !== event.kind
        || prevTool.kind !== nextTool.kind) {
        el.replaceWith(createMobileToolDetailElement(event, nextTool, index));
        return;
    }
    if (prevTool.detail === nextTool.detail && prevTool.filePath === nextTool.filePath) {
        return;
    }

    // Hot path — the detail (usually a file path) keeps changing while args
    // stream in. Mutate the row in place instead of replacing it so nothing
    // repaints beyond the changed text.
    const kindIsFile = isMobileFileDetailKind(event.kind);
    const shouldHaveIcon = kindIsFile && !!nextTool.detail;
    const existingIcon = el.querySelector<HTMLElement>(':scope > .theia-mobile-tool-detail-file-icon');
    if (!shouldHaveIcon) {
        existingIcon?.remove();
    } else if (existingIcon) {
        const iconClass = `codicon ${getFileIconClass(nextTool.detail)} theia-mobile-tool-detail-file-icon`;
        if (existingIcon.className !== iconClass) {
            existingIcon.className = iconClass;
        }
    } else {
        el.prepend(createMobileFileIconSpan(nextTool.detail));
    }

    const detailSpan = el.querySelector<HTMLElement>(':scope > .theia-mobile-tool-detail-detail');
    if (!detailSpan) {
        el.replaceWith(createMobileToolDetailElement(event, nextTool, index));
        return;
    }
    const canOpenFile = kindIsFile && event.kind !== 'delete' && !!nextTool.filePath;
    const couldOpenFile = kindIsFile && event.kind !== 'delete' && !!prevTool.filePath;
    if (canOpenFile !== couldOpenFile || prevTool.filePath !== nextTool.filePath) {
        // The file-link wiring captures `filePath` in its listeners — swap
        // just the span (no animations attached) instead of the whole row.
        detailSpan.replaceWith(createMobileToolFileDetailSpan(nextTool, canOpenFile));
    } else if (prevTool.detail !== nextTool.detail) {
        detailSpan.textContent = nextTool.detail;
    }
    el.classList.toggle('theia-mod-clickable', canOpenFile);
}

/** Open/closed `<details>` state captured before a fallback full rebuild, keyed
 *  by stable ids so a rebuild that shifts DOM indices doesn't lose state. */
interface MobileTimelineOpenState {
    readonly groups: Map<string, boolean>;
    readonly terminals: Map<string, boolean>;
}

/**
 * Key used to remember a tool group's open state across a full rebuild.
 * `m-event-<index>` ids are positional — an insertion or split upstream can
 * shift them onto a different event — so prefer the (globally stable)
 * `toolUseId` of the group's first tool row, falling back to the section's
 * event id only when no tool row is present yet.
 */
function resolveTimelineGroupStateKey(section: HTMLElement, group: HTMLDetailsElement): string | undefined {
    const detailsContainer = group.querySelector<HTMLElement>(':scope > div.theia-mobile-tool-group-details');
    const firstToolUseId = detailsContainer?.firstElementChild?.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR);
    if (firstToolUseId) {
        return firstToolUseId;
    }
    return section.getAttribute(MOBILE_EVENT_ID_ATTR) ?? undefined;
}

/**
 * Same key derivation as {@link resolveTimelineGroupStateKey} (first tool
 * row's stable `toolUseId`, falling back to the event id), but computed at
 * element-creation time directly from the `detailsContainer` being built
 * rather than by querying an already-mounted `section` — used by
 * {@link timelineDetailsOpenState} lookups/records, which run before the
 * group is ever attached to a section. The event-id fallback is positional
 * per-timeline (stable within one render, not across renders with a
 * different event shape), which is acceptable here for the same reason it is
 * acceptable for {@link resolveTimelineGroupStateKey}.
 */
function resolveTimelineGroupCreationKey(event: MobileExecutionEvent, detailsContainer: HTMLElement): string {
    const firstToolUseId = detailsContainer.firstElementChild?.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR);
    return firstToolUseId ?? event.id;
}

function captureTimelineOpenStateById(existing: HTMLElement): MobileTimelineOpenState {
    const groups = new Map<string, boolean>();
    const terminals = new Map<string, boolean>();
    existing.querySelectorAll<HTMLElement>(`section[${MOBILE_EVENT_ID_ATTR}]`).forEach(section => {
        const group = section.querySelector<HTMLDetailsElement>(':scope > details.theia-mobile-tool-group');
        if (group) {
            const key = resolveTimelineGroupStateKey(section, group);
            if (key) {
                groups.set(key, group.open);
            }
        }
    });
    existing.querySelectorAll<HTMLDetailsElement>('details.theia-mobile-terminal-output').forEach(details => {
        const toolUseId = details.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR);
        if (toolUseId) {
            terminals.set(toolUseId, details.open);
        }
    });
    return { groups, terminals };
}

function restoreTimelineOpenStateById(fresh: HTMLElement, captured: MobileTimelineOpenState): void {
    fresh.querySelectorAll<HTMLElement>(`section[${MOBILE_EVENT_ID_ATTR}]`).forEach(section => {
        const group = section.querySelector<HTMLDetailsElement>(':scope > details.theia-mobile-tool-group');
        if (group) {
            const key = resolveTimelineGroupStateKey(section, group);
            if (key && captured.groups.get(key)) {
                group.open = true;
            }
        }
    });
    fresh.querySelectorAll<HTMLDetailsElement>('details.theia-mobile-terminal-output').forEach(details => {
        const toolUseId = details.getAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR);
        if (toolUseId && captured.terminals.get(toolUseId)) {
            details.open = true;
            // Programmatic `open` does not fire `toggle` synchronously, so the
            // lazy first-open handler will not run here — render the deferred
            // output eagerly to avoid an open-but-empty terminal card.
            const content = details.querySelector<HTMLElement>('.theia-mobile-terminal-output-content');
            if (content) {
                flushMobileTerminalOutputIfPending(details, content);
            }
        }
    });
}

/**
 * Replaces the existing execution event timeline inside `segmentsBody` with a
 * fresh one built from `segments`.
 *
 * First tries {@link tryPatchMobileExecutionEventTimeline} to patch the
 * existing DOM in place — the common streaming case where events/tools only
 * grow — which avoids losing scroll position, focus, and `<details>` open
 * state. If that isn't safe (structure diverged too much), falls back to a
 * full rebuild, preserving open/closed `<details>` state by event id / tool
 * id rather than DOM position.
 *
 * If the timeline is wrapped in a process accordion, the accordion itself is
 * preserved — only the inner timeline is swapped.
 */
export function refreshMobileExecutionEventTimeline(
    segmentsBody: HTMLElement,
    segments: readonly QaapAgentMessageSegmentDTO[],
): HTMLElement {
    const existing = segmentsBody.querySelector<HTMLElement>(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);
    const nextEvents = buildMobileExecutionEvents(segments).events;
    const nextSignature = fingerprintMobileExecutionEvents(nextEvents);

    if (existing) {
        if (timelineEventSignatureCache.get(existing) === nextSignature) {
            recordTranscriptRenderMetric('timeline_event_sync_skipped');
            return existing;
        }
        const prevEvents = timelineEventCache.get(existing);
        if (prevEvents && tryPatchMobileExecutionEventTimeline(existing, prevEvents, nextEvents)) {
            timelineEventCache.set(existing, nextEvents);
            timelineEventSignatureCache.set(existing, nextSignature);
            recordTranscriptRenderMetric('timeline_event_patch');
            return existing;
        }
    }

    // Fallback: full rebuild.
    recordTranscriptRenderMetric('timeline_event_rebuild');
    const captured = existing ? captureTimelineOpenStateById(existing) : undefined;
    const fresh = createMobileExecutionEventTimeline(segments);
    timelineEventSignatureCache.set(fresh, nextSignature);
    if (captured) {
        restoreTimelineOpenStateById(fresh, captured);
    }
    if (existing) {
        // If the timeline is inside a process accordion, replace only the
        // timeline and keep the accordion wrapper intact.
        const accordion = existing.closest(`.${MOBILE_PROCESS_ACCORDION_CLASS}`);
        if (accordion) {
            const content = accordion.querySelector(`.${MOBILE_EXECUTION_TIMELINE_CLASS}`);
            if (content) {
                content.replaceWith(fresh);
                return fresh;
            }
        }
        existing.replaceWith(fresh);
    } else {
        segmentsBody.append(fresh);
    }
    return fresh;
}

function createMobileExecutionEventElement(
    event: MobileExecutionEvent,
): HTMLElement {
    const section = document.createElement('section');
    section.className = `theia-mobile-execution-event theia-mod-${event.kind}`;
    section.setAttribute(MOBILE_EVENT_ID_ATTR, event.id);
    if (event.hasError) {
        section.classList.add('theia-mod-error');
    }
    if (event.hasPending) {
        section.classList.add('theia-mod-running');
    }

    // Narrative — synthetic filler ("I'm checking the relevant files.") is
    // suppressed: the tool-group summary already conveys verb + count, so a
    // generic placeholder sentence above it is just noise. Agent-authored
    // narrative (actual reasoning text) is always kept.
    if (event.narrativeSource !== 'synthetic') {
        const narrative = document.createElement('p');
        narrative.className = 'theia-mobile-execution-event-narrative theia-mod-agent';
        narrative.textContent = event.narrative;
        section.append(narrative);
    }

    // Tool group (collapsed by default)
    section.append(createMobileToolGroupElement(event));

    return section;
}

function createMobileToolGroupElement(
    event: MobileExecutionEvent,
): HTMLElement {
    const webSearchOnly = event.tools.length > 0
        && event.tools.every(tool => isTranscriptWebSearchTool(tool.segment.name));
    const details = document.createElement('details');
    details.className = `theia-mobile-tool-group ${event.hasError ? 'failed' : ''} ${event.hasPending ? 'running' : 'finished'}`;
    if (webSearchOnly) {
        details.classList.add('theia-mod-web-search');
        // AIcss-style cards are the primary chrome — keep the group open.
        details.open = true;
    }
    // Collapsed by default — Codex never auto-expands tool groups.

    // Summary line: icon + verb + count + state + chevron
    const summary = document.createElement('summary');
    summary.className = 'theia-mobile-tool-group-summary';
    if (webSearchOnly) {
        summary.classList.add('theia-mod-web-search-hidden');
    }

    const icon = document.createElement('span');
    icon.className = `codicon ${event.icon} theia-mobile-tool-group-icon`;
    icon.setAttribute('aria-hidden', 'true');
    syncActivityToolIconMotion(icon, event.hasPending && !event.hasError, event.kind);

    const verb = document.createElement('span');
    verb.className = `theia-mobile-tool-group-verb ${event.hasPending ? 'theia-mod-shimmer' : ''}`;
    verb.textContent = event.verb;

    const meta = document.createElement('span');
    meta.className = `theia-mobile-tool-group-meta ${event.hasPending ? 'theia-mod-shimmer' : ''}`;
    meta.textContent = formatMobileEventSummary(event);

    const state = document.createElement('span');
    state.className = `theia-mobile-tool-group-state ${event.hasError ? 'failed' : event.hasPending ? 'running' : 'complete'}`;
    const stateIcon = document.createElement('span');
    stateIcon.className = `codicon ${event.hasError ? 'codicon-error' : event.hasPending ? 'codicon-loading theia-animation-spin' : 'codicon-check'}`;
    state.append(stateIcon);

    const chevron = document.createElement('span');
    chevron.className = 'codicon codicon-chevron-down theia-mobile-tool-group-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    summary.append(icon, verb, meta, state, chevron);
    details.append(summary);

    // Details: individual tools
    const detailsContainer = document.createElement('div');
    detailsContainer.className = 'theia-mobile-tool-group-details';

    event.tools.forEach((tool, index) => {
        detailsContainer.append(createMobileToolDetailElement(event, tool, index));
    });

    details.append(detailsContainer);

    // Restore a user-opened state that survives full row rematerialization
    // (virtual-list scroll-out/scroll-back builds this element from scratch,
    // with no "existing" element around to capture/restore from) and keep
    // recording every subsequent toggle so later rematerializations stay in
    // sync.
    const groupStateKey = timelineGroupOpenStateKey(resolveTimelineGroupCreationKey(event, detailsContainer));
    if (webSearchOnly) {
        details.open = true;
    } else if (timelineDetailsOpenState.get(groupStateKey)) {
        details.open = true;
    }
    details.addEventListener('toggle', () => {
        if (webSearchOnly) {
            // Premium WebSearch cards own expand/collapse; keep the group shell open.
            details.open = true;
            return;
        }
        // Detaching an open group fires toggle(open=false) while disconnected —
        // don't poison sticky open state (that would collapse on remount).
        if (!details.isConnected && !details.open) {
            return;
        }
        recordTimelineDetailsOpenState(groupStateKey, details.open);
    });

    return details;
}

function createMobileToolDetailElement(
    event: MobileExecutionEvent,
    tool: MobileExecutionTool,
    index: number,
): HTMLElement {
    // Terminal tools get a collapsible output card
    if (tool.isTerminal) {
        return createMobileTerminalOutputElement(event, tool, index);
    }

    if (isTranscriptWebSearchTool(tool.segment.name)) {
        const payload = resolveTranscriptWebSearchPayload(tool.segment);
        const card = createTranscriptWebSearchCard(payload, {
            open: !tool.isFinished || payload.sites.length > 0,
        });
        card.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, tool.segment.toolUseId);
        return card;
    }

    // File-related tools (read/write/edit/delete) get a file-type icon before
    // the filename detail, per the Codex-style file display requirement.
    const fileIcon = isMobileFileDetailKind(event.kind) && tool.detail
        ? createMobileFileIconSpan(tool.detail)
        : undefined;
    const canOpenFile = isMobileFileDetailKind(event.kind) && event.kind !== 'delete' && !!tool.filePath;

    // Error tools get a simple error line
    if (tool.isError) {
        const row = document.createElement('div');
        row.className = `theia-mobile-tool-detail theia-mod-error theia-mod-${event.kind}${canOpenFile ? ' theia-mod-clickable' : ''}`;
        row.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, tool.segment.toolUseId);
        const detail = createMobileToolFileDetailSpan(tool, canOpenFile);
        const errorIcon = document.createElement('span');
        errorIcon.className = 'codicon codicon-error theia-mobile-tool-detail-error-icon';
        if (fileIcon) {
            row.append(fileIcon, detail, errorIcon);
        } else {
            row.append(detail, errorIcon);
        }
        return row;
    }

    // Everything else: plain text line, no card
    const row = document.createElement('div');
    row.className = `theia-mobile-tool-detail theia-mod-text theia-mod-${event.kind}${canOpenFile ? ' theia-mod-clickable' : ''}`;
    row.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, tool.segment.toolUseId);
    const detail = createMobileToolFileDetailSpan(tool, canOpenFile);
    if (fileIcon) {
        row.append(fileIcon, detail);
    } else {
        row.append(detail);
    }
    return row;
}

/**
 * Returns true when the event kind operates on files, so the tool detail is a
 * filename that should be shown with a file-type icon.
 */
function isMobileFileDetailKind(kind: MobileEventKind): boolean {
    return kind === 'read' || kind === 'write' || kind === 'edit' || kind === 'delete';
}

function createMobileToolFileDetailSpan(tool: MobileExecutionTool, canOpenFile: boolean): HTMLElement {
    const detail = document.createElement('span');
    detail.className = `theia-mobile-tool-detail-detail${canOpenFile ? ' theia-mod-file-link' : ''}`;
    detail.textContent = tool.detail;
    if (canOpenFile && tool.filePath) {
        const filePath = tool.filePath;
        detail.setAttribute('role', 'link');
        detail.tabIndex = 0;
        detail.dataset.qaapToolFilePath = filePath;
        detail.title = filePath;
        const open = (event: Event): void => {
            event.preventDefault();
            event.stopPropagation();
            const EventCtor = detail.ownerDocument.defaultView?.CustomEvent ?? CustomEvent;
            detail.dispatchEvent(new EventCtor(MOBILE_TOOL_FILE_OPEN_EVENT, {
                bubbles: true,
                composed: true,
                detail: { filePath },
            }));
        };
        detail.addEventListener('click', open);
        detail.addEventListener('keydown', event => {
            if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
                open(event);
            }
        });
    }
    return detail;
}

function createMobileFileIconSpan(filename: string): HTMLElement {
    const icon = document.createElement('span');
    icon.className = `codicon ${getFileIconClass(filename)} theia-mobile-tool-detail-file-icon`;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function createMobileTerminalOutputElement(
    event: MobileExecutionEvent,
    tool: MobileExecutionTool,
    index: number,
): HTMLElement {
    const details = document.createElement('details');
    details.className = `theia-mobile-terminal-output ${tool.isError ? 'failed' : tool.isFinished ? 'complete' : 'running'}`;
    details.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, tool.segment.toolUseId);

    // Restore a user-opened state that survives full row rematerialization
    // (see the matching comment in createMobileToolGroupElement) — setting
    // `open` here (rather than after the lazy-render wiring below) lets the
    // existing `if (details.open) { ... }` branch further down render the
    // pending output eagerly, exactly as it already does for the "created
    // already open" case.
    const terminalStateKey = timelineTerminalOpenStateKey(tool.segment.toolUseId);
    if (timelineDetailsOpenState.get(terminalStateKey)) {
        details.open = true;
    }
    details.addEventListener('toggle', () => {
        // Same detach guard as tool groups — synthetic close must not wipe
        // a user-opened terminal card across rematerialization.
        if (!details.isConnected && !details.open) {
            return;
        }
        recordTimelineDetailsOpenState(terminalStateKey, details.open);
    });

    const summary = document.createElement('summary');
    summary.className = 'theia-mobile-terminal-output-summary';

    const detail = document.createElement('span');
    detail.className = 'theia-mobile-terminal-output-detail';
    renderMobileShellCommandDetail(detail, tool.detail);

    const state = document.createElement('span');
    state.className = `codicon ${tool.isError ? 'codicon-error' : tool.isFinished ? 'codicon-check' : 'codicon-loading theia-animation-spin'} theia-mobile-terminal-output-state`;

    summary.append(detail, state);
    details.append(summary);

    // Output content — show the tool result. Terminal cards are collapsed by
    // default (details.open starts false), so building the rendered output is
    // deferred until the card is first opened. Strip ANSI escape sequences
    // (color codes, OSC titles, etc.) before syntax highlighting.
    // Mirrors the cleaning done by cleanTranscriptDisplayText in the content
    // UI layer.
    const content = document.createElement('div');
    content.className = 'theia-mobile-terminal-output-content';
    const result = tool.segment.result;
    if (result) {
        pendingTerminalOutputResult.set(details, result);
    }
    if (!result && !tool.isFinished) {
        const placeholder = document.createElement('span');
        placeholder.className = 'theia-mobile-terminal-output-pending';
        placeholder.textContent = nls.localize('qaap/mobileProjects/terminalOutputPending', 'Running...');
        content.append(placeholder);
    }
    if (details.open) {
        // Created already open (rare) — render eagerly as before.
        if (result) {
            renderMobileTerminalOutput(content, result);
        } else if (tool.isFinished) {
            ensureMobileTerminalEmptyOutputState(content);
        }
    } else {
        attachMobileTerminalLazyOpenHandler(details, content);
    }
    details.append(content);

    // The command detail inside <summary> uses overflow-x:auto + touch-action:pan-x
    // so long commands can scroll. Chromium/WebKit skip the native <details>
    // toggle when the click lands on that scroller — own the toggle so a tap on
    // the command always expands and reveals stdout/stderr. stopPropagation
    // also keeps nested process-accordion / tool-group parents from reacting.
    summary.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const nextOpen = !details.open;
        details.open = nextOpen;
        recordTimelineDetailsOpenState(terminalStateKey, nextOpen);
        if (nextOpen) {
            flushMobileTerminalOutputIfPending(details, content);
        }
    });

    return details;
}

function renderMobileShellCommandDetail(host: HTMLElement, command: string): void {
    host.replaceChildren();
    const codeView = createTranscriptCodeView(command, 'shell');
    const code = codeView.querySelector<HTMLElement>('.theia-mobile-agent-code-text');
    if (!code) {
        host.textContent = command;
        return;
    }
    host.append(...[...code.childNodes].map(child => child.cloneNode(true)));
}

// ─── Closing Error Card ──────────────────────────────────────────────────────
// A single, styled outcome card for a failed turn's closing narrative — the
// codex-style equivalent of the old repeated raw "Error: ..." text blocks.
// Rendered OUTSIDE the process accordion (it's a final outcome, like the diff
// summary), and only once per distinct message: callers are responsible for
// deduplicating identical/duplicate error text before calling this.

/** CSS class on the compact closing error card. */
export const MOBILE_CLOSING_ERROR_CARD_CLASS = 'theia-mobile-closing-error-card';

/**
 * Creates the compact closing error card, optionally with a quiet "Retry"
 * action when `onRetry` is provided. The button disables itself after the
 * first click so a slow/failed retry attempt can't be triggered twice from
 * the same card.
 */
export function createMobileClosingErrorCardElement(message: string, onRetry?: () => void): HTMLElement {
    const card = document.createElement('div');
    card.className = `${MOBILE_CLOSING_ERROR_CARD_CLASS} theia-mod-error`;

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-error theia-mobile-closing-error-card-icon';
    icon.setAttribute('aria-hidden', 'true');

    const content = document.createElement('div');
    content.className = 'theia-mobile-closing-error-card-content';

    const text = document.createElement('span');
    text.className = 'theia-mobile-closing-error-card-message';
    text.textContent = message;
    content.append(text);

    if (onRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'theia-mobile-closing-error-card-retry';
        retry.textContent = nls.localizeByDefault('Retry');
        retry.addEventListener('click', () => {
            // Disable immediately so a double-click (or a slow retry that
            // hasn't settled yet) can't fire the callback a second time.
            retry.disabled = true;
            onRetry();
        }, { once: true });
        content.append(retry);
    }

    card.append(icon, content);
    return card;
}

// ─── Diff Summary (closing of the story) ─────────────────────────────────────

export interface MobileDiffFileEntry {
    name: string;
    type?: string;
    /** Lines added in this file, when known. */
    added?: number;
    /** Lines removed in this file, when known. */
    removed?: number;
}

/** Short language/type badge shown beside filenames in the files-changed card. */
export function resolveMobileDiffFileLanguageBadge(fileName: string): string | undefined {
    const base = fileName.includes('/') ? fileName.slice(fileName.lastIndexOf('/') + 1) : fileName;
    const dot = base.lastIndexOf('.');
    if (dot <= 0) {
        return undefined;
    }
    switch (base.slice(dot + 1).toLowerCase()) {
        case 'ts':
        case 'tsx':
            return 'TS';
        case 'js':
        case 'jsx':
        case 'mjs':
        case 'cjs':
            return 'JS';
        case 'css':
        case 'scss':
        case 'sass':
        case 'less':
            return '#';
        case 'json':
        case 'jsonc':
            return '{}';
        case 'md':
        case 'mdx':
            return 'MD';
        case 'html':
        case 'htm':
            return '<>';
        case 'py':
            return 'PY';
        case 'go':
            return 'GO';
        case 'rs':
            return 'RS';
        default:
            return undefined;
    }
}

export function createMobileDiffSummaryElement(
    fileCount: number,
    _added: number,
    _modified: number,
    _deleted: number,
    files?: MobileDiffFileEntry[],
    onReview?: () => void,
): HTMLElement {
    const summary = document.createElement('div');
    summary.className = 'theia-mobile-diff-summary theia-mod-files';

    const header = document.createElement('div');
    header.className = 'theia-mobile-diff-summary-header';

    const title = document.createElement('span');
    title.className = 'theia-mobile-diff-summary-title';
    title.textContent = fileCount === 1
        ? nls.localize('qaap/mobileProjects/transcriptDiffSummaryOneFile', '1 File Changed')
        : nls.localize('qaap/mobileProjects/transcriptDiffSummaryFiles', '{0} Files Changed', String(fileCount));
    header.append(title);

    if (onReview) {
        const review = document.createElement('button');
        review.type = 'button';
        review.className = 'theia-mobile-diff-summary-review';
        review.textContent = nls.localize('qaap/mobileProjects/transcriptChangedFilesReview', 'Review');
        review.addEventListener('click', onReview);
        header.append(review);
    }

    summary.append(header);

    if (files && files.length > 0) {
        const fileList = document.createElement('div');
        fileList.className = 'theia-mobile-diff-summary-files';
        for (const file of files.slice(0, 6)) {
            const row = document.createElement('div');
            row.className = 'theia-mobile-diff-summary-file';
            const main = document.createElement('span');
            main.className = 'theia-mobile-diff-summary-file-main';
            const badgeLabel = resolveMobileDiffFileLanguageBadge(file.name);
            const fileIcon = document.createElement('span');
            if (badgeLabel) {
                fileIcon.className = 'theia-mobile-diff-summary-file-badge';
                fileIcon.textContent = badgeLabel;
            } else {
                fileIcon.className = `codicon ${getFileIconClass(file.name)} theia-mobile-diff-summary-file-icon`;
            }
            fileIcon.setAttribute('aria-hidden', 'true');
            const name = document.createElement('span');
            name.className = 'theia-mobile-diff-summary-file-name';
            name.textContent = file.name;
            name.title = file.name;
            main.append(fileIcon, name);
            row.append(main);

            const tail = document.createElement('span');
            tail.className = 'theia-mobile-diff-summary-file-tail';
            let hasStats = false;
            if (typeof file.added === 'number' && file.added > 0) {
                const addedStat = document.createElement('span');
                addedStat.className = 'theia-mobile-diff-summary-file-stat theia-mod-added';
                addedStat.textContent = `+${file.added}`;
                tail.append(addedStat);
                hasStats = true;
            }
            if (typeof file.removed === 'number' && file.removed > 0) {
                const removedStat = document.createElement('span');
                removedStat.className = 'theia-mobile-diff-summary-file-stat theia-mod-deleted';
                // Unicode minus matches composer / changed-files rows (+12 −3).
                removedStat.textContent = `−${file.removed}`;
                tail.append(removedStat);
                hasStats = true;
            }
            if (!hasStats && file.type) {
                const type = document.createElement('span');
                type.className = `theia-mobile-diff-summary-file-type theia-mod-${file.type}`;
                type.textContent = file.type === 'add'
                    ? nls.localize('qaap/mobileProjects/transcriptDiffFileAdded', 'added')
                    : file.type === 'delete'
                        ? nls.localize('qaap/mobileProjects/transcriptDiffFileDeleted', 'deleted')
                        : nls.localize('qaap/mobileProjects/transcriptDiffFileModified', 'modified');
                tail.append(type);
            }
            if (tail.childElementCount > 0) {
                row.append(tail);
            }
            fileList.append(row);
        }
        if (files.length > 6) {
            const more = document.createElement('div');
            more.className = 'theia-mobile-diff-summary-more';
            more.textContent = `+${files.length - 6} more`;
            fileList.append(more);
        }
        summary.append(fileList);
    }

    return summary;
}

/**
 * Creates a line-level diff summary for the case where we have aggregate
 * added/removed line counts but no per-file change set (e.g. when the change
 * set is inferred from diff stats embedded in tool output rather than from
 * Write/Edit tool invocations).
 *
 * Unlike {@link createMobileDiffSummaryElement}, this does NOT claim a file
 * count — it renders only the "+N / -N" line stats with a generic "Changes"
 * title, avoiding the misleading "1 file changed" label that would otherwise
 * result from passing line counts into the file-count API.
 */
export function createMobileLineDiffSummaryElement(
    linesAdded: number,
    linesRemoved: number,
): HTMLElement {
    const summary = document.createElement('div');
    summary.className = 'theia-mobile-diff-summary';

    const header = document.createElement('div');
    header.className = 'theia-mobile-diff-summary-header';

    const icon = document.createElement('span');
    icon.className = 'codicon codicon-diff theia-mobile-diff-summary-icon';
    icon.setAttribute('aria-hidden', 'true');

    const title = document.createElement('span');
    title.className = 'theia-mobile-diff-summary-title';
    title.textContent = nls.localize('qaap/mobileProjects/transcriptDiffSummary', 'Change summary');

    header.append(icon, title);

    if (linesAdded > 0) {
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-diff-summary-stat theia-mod-added';
        stat.textContent = `+${linesAdded}`;
        header.append(stat);
    }
    if (linesRemoved > 0) {
        const stat = document.createElement('span');
        stat.className = 'theia-mobile-diff-summary-stat theia-mod-deleted';
        stat.textContent = `−${linesRemoved}`;
        header.append(stat);
    }

    summary.append(header);
    return summary;
}

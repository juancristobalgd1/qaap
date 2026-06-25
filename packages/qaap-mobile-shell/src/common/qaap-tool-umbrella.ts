// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/* Ported from Robrusi/CloudCode:
   - components/chat/tool-details.ts          → bundleByUmbrella, summarizeBundle
   - components/chat/tool-detail-classify.ts   → classifyDetail, inferCommandIntent, unwrapShellCommand
   - components/chat/tool-detail-coalesce.ts   → coalesceToolDetails

   Adapted to qaap's QaapAgentMessageSegmentDTO tool segment type and
   qaap's existing classifyTranscriptToolActivityKind buckets. */

import { classifyTranscriptToolActivityKind } from './qaap-agent-transcript-segments';
import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';

export type ToolUmbrella = 'explore' | 'modify';

export type ToolDetailKind = 'read' | 'search' | 'command' | 'edit' | 'create' | 'other';

/* --- Shell command unwrapping (from CloudCode tool-detail-classify.ts) ------ */

const READ_PROGRAMS = new Set(['bat', 'cat', 'head', 'less', 'more', 'sed', 'tail', 'view']);
const SEARCH_PROGRAMS = new Set(['ack', 'ag', 'egrep', 'fgrep', 'find', 'grep', 'ripgrep', 'rg']);

export function unwrapShellCommand(cmd: string): string {
    let current = cmd;
    for (let i = 0; i < 4; i++) {
        const envMatch = current.match(/^env(?:\s+\w+=\S+)+\s+([\s\S]*)$/);
        if (envMatch) {
            current = envMatch[1]!.trim();
            continue;
        }
        const shellMatch = current.match(
            /^(?:\/[\w/]*\/)?(?:bash|sh|zsh)(?:\s+-[a-z]+)*\s+(['"])([\s\S]*)\1\s*$/,
        );
        if (shellMatch) {
            current = shellMatch[2]!.trim();
            continue;
        }
        const shellNoQuote = current.match(
            /^(?:\/[\w/]*\/)?(?:bash|sh|zsh)\s+-[a-z]*c\s+([\s\S]*)$/,
        );
        if (shellNoQuote) {
            current = shellNoQuote[1]!.trim().replace(/^['"]|['"]$/g, '');
            continue;
        }
        break;
    }
    return current || cmd;
}

function tokenizeShell(cmd: string): string[] {
    return cmd.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g) ?? [];
}

function stripQuotes(token: string): string {
    if (token.length >= 2) {
        const first = token[0];
        const last = token[token.length - 1];
        if ((first === '"' || first === "'") && first === last) {
            return token.slice(1, -1);
        }
    }
    return token;
}

type CommandIntent = { kind: 'command' } | { kind: 'read'; target: string } | { kind: 'search'; query: string };

export function inferCommandIntent(rawCmd: string): CommandIntent {
    if (!rawCmd) {
        return { kind: 'command' };
    }
    const firstSegment = rawCmd.split(/\||&&|;|\n/)[0]!.trim();
    const tokens = tokenizeShell(firstSegment);
    if (tokens.length === 0) {
        return { kind: 'command' };
    }
    const program = stripQuotes(tokens[0]!).split('/').pop() ?? '';
    const args = tokens.slice(1).map(stripQuotes);

    if (READ_PROGRAMS.has(program)) {
        const target = pickReadTarget(program, args);
        if (target) {
            return { kind: 'read', target };
        }
    }
    if (SEARCH_PROGRAMS.has(program)) {
        const query = pickSearchQuery(program, args);
        if (query) {
            return { kind: 'search', query };
        }
    }
    return { kind: 'command' };
}

function pickReadTarget(program: string, args: string[]): string | null {
    const skipNext = new Set<number>();
    if (program === 'head' || program === 'tail') {
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '-n' || args[i] === '-c') {
                skipNext.add(i + 1);
            }
        }
    }
    if (program === 'sed') {
        for (let i = 0; i < args.length; i++) {
            if (args[i] === '-e' || args[i] === '-f') {
                skipNext.add(i + 1);
            }
        }
    }
    for (let i = args.length - 1; i >= 0; i--) {
        if (skipNext.has(i)) {
            continue;
        }
        const arg = args[i]!;
        if (!arg || arg.startsWith('-')) {
            continue;
        }
        return arg;
    }
    return null;
}

function pickSearchQuery(program: string, args: string[]): string | null {
    if (program === 'find') {
        for (let i = 0; i < args.length - 1; i++) {
            if (args[i] === '-name' || args[i] === '-iname' || args[i] === '-path') {
                return args[i + 1] ?? null;
            }
        }
        return null;
    }
    for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '-e' || arg === '--regexp') {
            return args[i + 1] ?? null;
        }
        if (arg && !arg.startsWith('-')) {
            return arg;
        }
    }
    return null;
}

/* --- Tool detail classification (adapted to qaap segment types) ------------- */

export interface ToolSegmentDetail {
    readonly segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
    readonly kind: ToolDetailKind;
    readonly umbrella: ToolUmbrella;
}

/** Classifies a tool segment into a fine-grained detail kind. */
export function classifyToolSegmentDetail(
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
): ToolDetailKind {
    const activityKind = classifyTranscriptToolActivityKind(segment.name ?? '');
    switch (activityKind) {
        case 'editing':
            return 'edit';
        case 'reading':
            return 'read';
        case 'searching':
            return 'search';
        case 'terminal': {
            const args = segment.args?.trim() ?? '';
            const cmd = unwrapShellCommand(args);
            const intent = inferCommandIntent(cmd);
            return intent.kind;
        }
        case 'todo':
            return 'other';
        case 'mcp':
            return 'other';
        default:
            return 'other';
    }
}

/** Classifies a tool segment into the explore/modify umbrella. */
export function umbrellaForToolSegment(
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
): ToolUmbrella {
    const activityKind = classifyTranscriptToolActivityKind(segment.name ?? '');
    if (activityKind === 'editing') {
        return 'modify';
    }
    if (activityKind === 'terminal') {
        const detail = classifyToolSegmentDetail(segment);
        return detail === 'edit' || detail === 'create' ? 'modify' : 'explore';
    }
    return 'explore';
}

/* --- Bundling (from CloudCode tool-details.ts bundleByUmbrella) ------------- */

export interface ToolSegmentBundle {
    readonly umbrella: ToolUmbrella;
    readonly items: ReadonlyArray<Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>>;
}

/** Groups consecutive tool segments by their umbrella (explore/modify). */
export function bundleToolSegmentsByUmbrella(
    segments: ReadonlyArray<Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>>,
): ToolSegmentBundle[] {
    const bundles: ToolSegmentBundle[] = [];
    for (const segment of segments) {
        const umbrella = umbrellaForToolSegment(segment);
        const last = bundles[bundles.length - 1];
        if (last && last.umbrella === umbrella) {
            bundles[bundles.length - 1] = {
                umbrella,
                items: [...last.items, segment],
            };
        } else {
            bundles.push({ umbrella, items: [segment] });
        }
    }
    return bundles;
}

/* --- Coalescing (from CloudCode tool-detail-coalesce.ts) -------------------- */

function isStartLikeSegment(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): boolean {
    return !segment.finished;
}

function isTerminalSegment(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): boolean {
    return segment.finished;
}

function segmentCompleteness(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): number {
    let score = 0;
    if (segment.result?.trim()) {
        score += 4;
    }
    if (segment.finished) {
        score += 2;
    }
    return score;
}

function shouldMergeSegments(
    previous: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> | undefined,
    next: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
): boolean {
    if (!previous) {
        return false;
    }
    if (previous.toolUseId !== next.toolUseId) {
        return false;
    }
    return isStartLikeSegment(previous) && isTerminalSegment(next);
}

function mergeSegments(
    previous: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    next: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
): Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> {
    const preferNext = segmentCompleteness(next) >= segmentCompleteness(previous);
    const primary = preferNext ? next : previous;
    const fallback = preferNext ? previous : next;
    return {
        ...fallback,
        ...primary,
        args: primary.args ?? fallback.args,
        result: primary.result ?? fallback.result,
        finished: primary.finished || fallback.finished,
    };
}

/** Coalesces start+completion pairs of the same tool call into single segments. */
export function coalesceToolSegments(
    segments: ReadonlyArray<Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>>,
): Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>[] {
    const coalesced: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>[] = [];
    for (const segment of segments) {
        const previous = coalesced[coalesced.length - 1];
        if (shouldMergeSegments(previous, segment)) {
            coalesced[coalesced.length - 1] = mergeSegments(previous!, segment);
        } else {
            coalesced.push(segment);
        }
    }
    return coalesced;
}

/* --- Summary labels (from CloudCode tool-details.ts summarizeBundle) -------- */

function pluralize(count: number, singular: string, plural: string): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

function basename(filePath: string): string {
    const parts = filePath.split('/');
    return parts[parts.length - 1] ?? filePath;
}

function extractToolPath(argsJson: string): string | undefined {
    try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        const path = [args.file_path, args.filePath, args.path, args.file]
            .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
        return path?.trim();
    } catch {
        return undefined;
    }
}

/** Produces a one-line human-readable summary for a bundle of tool segments. */
export function summarizeToolBundle(
    umbrella: ToolUmbrella,
    items: ReadonlyArray<Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>>,
): string {
    const counts: Record<ToolDetailKind, number> = {
        read: 0,
        search: 0,
        command: 0,
        edit: 0,
        create: 0,
        other: 0,
    };

    for (const item of items) {
        const detail = classifyToolSegmentDetail(item);
        counts[detail] += 1;
    }

    if (umbrella === 'explore') {
        if (items.length > 0 && counts.search > 0 && counts.read === 0 && counts.command === 0) {
            if (items.length === 1) {
                return 'Searched codebase';
            }
            return `Searched ${pluralize(items.length, 'time', 'times')}`;
        }
        if (counts.read > 0 && counts.search === 0 && counts.command === 0) {
            if (items.length === 1) {
                const path = extractToolPath(items[0]!.args ?? '');
                return path ? `Read ${basename(path)}` : 'Read file';
            }
            return `Read ${pluralize(items.length, 'file', 'files')}`;
        }
        if (counts.command > 0 && counts.read === 0 && counts.search === 0) {
            if (items.length === 1) {
                return 'Ran command';
            }
            return `Ran ${pluralize(items.length, 'command', 'commands')}`;
        }
        if (items.length === 1) {
            return 'Explored';
        }
        return `Explored ${pluralize(items.length, 'step', 'steps')}`;
    }

    // umbrella === 'modify'
    const allPaths = items
        .map(item => extractToolPath(item.args ?? ''))
        .filter((p): p is string => !!p);

    if (allPaths.length === 1) {
        const name = classifyToolSegmentDetail(items[0]!) === 'create' ? 'Created' : 'Edited';
        return `${name} ${basename(allPaths[0]!)}`;
    }

    const parts: string[] = [];
    if (counts.create > 0) {
        parts.push(`Created ${pluralize(counts.create, 'file', 'files')}`);
    }
    if (counts.edit > 0) {
        const verb = parts.length === 0 ? 'Edited' : 'edited';
        parts.push(`${verb} ${pluralize(counts.edit, 'file', 'files')}`);
    }
    if (parts.length === 0) {
        return 'Made changes';
    }
    return parts.join(', ');
}

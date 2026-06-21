// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import {
    classifyTranscriptToolActivityKind,
    isTranscriptTodoTool,
    parseTranscriptTodoChecklist,
    type QaapTranscriptTodoItem,
} from './qaap-agent-transcript-segments';
import type { TranscriptActivityNavigationItem } from './qaap-transcript-activity-navigation';
import { parseTranscriptSearchMatches, type TranscriptSearchMatch } from './qaap-transcript-search-matches-core';

export interface TranscriptActivityExpandDeps {
    extractToolPath(argsJson: string): string | undefined;
    extractToolCommand(argsJson: string): string | undefined;
    formatToolLabel(toolName: string, argsJson: string): string;
}

export interface TranscriptActivityTerminalExpandEntry {
    readonly command?: string;
    readonly output?: string;
    readonly finished?: boolean;
    readonly failed?: boolean;
    readonly exitCode?: number;
}

export interface TranscriptActivityReadExpandEntry {
    readonly path?: string;
    readonly text: string;
}

export interface TranscriptActivityEditExpandEntry {
    readonly path: string;
    readonly added?: number;
    readonly removed?: number;
}

export type TranscriptActivityExpandContent =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'search-matches'; readonly matches: readonly TranscriptSearchMatch[] }
    | { readonly kind: 'read'; readonly entry: TranscriptActivityReadExpandEntry }
    | { readonly kind: 'read-group'; readonly entries: readonly TranscriptActivityReadExpandEntry[] }
    | { readonly kind: 'edit'; readonly entry: TranscriptActivityEditExpandEntry }
    | { readonly kind: 'edit-group'; readonly entries: readonly TranscriptActivityEditExpandEntry[] }
    | { readonly kind: 'terminal'; readonly entry: TranscriptActivityTerminalExpandEntry }
    | { readonly kind: 'terminal-group'; readonly entries: readonly TranscriptActivityTerminalExpandEntry[] }
    | { readonly kind: 'todo'; readonly items: readonly QaapTranscriptTodoItem[] };

export function normalizeTranscriptTerminalToolOutput(result: string | undefined): string | undefined {
    const raw = result?.trim();
    if (!raw || /^ok$/i.test(raw)) {
        return undefined;
    }
    return raw;
}

export function resolveTranscriptReadExpandEntry(
    segment: QaapAgentMessageSegmentDTO | undefined,
    deps: TranscriptActivityExpandDeps,
): TranscriptActivityReadExpandEntry | undefined {
    if (!segment || segment.type !== 'tool') {
        return undefined;
    }
    const result = segment.result?.trim();
    if (!result || /^ok$/i.test(result)) {
        return undefined;
    }
    return {
        path: deps.extractToolPath(segment.args),
        text: result,
    };
}

export function resolveTranscriptEditExpandEntry(
    segment: QaapAgentMessageSegmentDTO | undefined,
    deps: TranscriptActivityExpandDeps,
): TranscriptActivityEditExpandEntry | undefined {
    if (!segment || segment.type !== 'tool') {
        return undefined;
    }
    const path = deps.extractToolPath(segment.args)?.trim();
    return path ? { path } : undefined;
}

export function resolveTranscriptTerminalExpandEntry(
    segment: QaapAgentMessageSegmentDTO | undefined,
    deps: TranscriptActivityExpandDeps,
): TranscriptActivityTerminalExpandEntry | undefined {
    if (!segment || segment.type !== 'tool') {
        return undefined;
    }
    if (classifyTranscriptToolActivityKind(segment.name) !== 'terminal') {
        return undefined;
    }
    const command = deps.extractToolCommand(segment.args)?.trim();
    const output = normalizeTranscriptTerminalToolOutput(segment.result);
    if (!command && !output) {
        return undefined;
    }
    return {
        command,
        output,
        finished: segment.finished,
    };
}

export function formatTranscriptActivityExpandSegmentLine(
    segment: QaapAgentMessageSegmentDTO | undefined,
    deps: TranscriptActivityExpandDeps,
): string | undefined {
    if (!segment || segment.type !== 'tool') {
        return undefined;
    }
    const kind = classifyTranscriptToolActivityKind(segment.name);
    if (kind === 'terminal') {
        return deps.extractToolCommand(segment.args) ?? deps.formatToolLabel(segment.name, segment.args);
    }
    const path = deps.extractToolPath(segment.args);
    if (path) {
        return path;
    }
    return deps.formatToolLabel(segment.name, segment.args);
}

export function resolveTranscriptActivityExpandContent(
    item: TranscriptActivityNavigationItem,
    segments: readonly QaapAgentMessageSegmentDTO[] | undefined,
    deps: TranscriptActivityExpandDeps,
): TranscriptActivityExpandContent | undefined {
    if (!segments?.length || item.thinkingContent || item.navigate === 'thought') {
        return undefined;
    }
    if (item.grouped && item.segmentIndices && item.segmentIndices.length >= 2) {
        const groupedSegments = item.segmentIndices
            .map(index => segments[index])
            .filter((segment): segment is QaapAgentMessageSegmentDTO => !!segment);
        const terminalEntries = groupedSegments
            .map(segment => resolveTranscriptTerminalExpandEntry(segment, deps))
            .filter((entry): entry is TranscriptActivityTerminalExpandEntry => !!entry);
        if (item.toolKind === 'terminal' && terminalEntries.length >= 2) {
            return { kind: 'terminal-group', entries: terminalEntries };
        }
        const readEntries = groupedSegments
            .map(segment => resolveTranscriptReadExpandEntry(segment, deps))
            .filter((entry): entry is TranscriptActivityReadExpandEntry => !!entry);
        if (item.toolKind === 'reading' && readEntries.length >= 2) {
            return { kind: 'read-group', entries: readEntries };
        }
        const editEntries = groupedSegments
            .map(segment => resolveTranscriptEditExpandEntry(segment, deps))
            .filter((entry): entry is TranscriptActivityEditExpandEntry => !!entry);
        if (item.toolKind === 'editing' && editEntries.length >= 2) {
            return { kind: 'edit-group', entries: editEntries };
        }
        const lines = item.segmentIndices
            .map(index => formatTranscriptActivityExpandSegmentLine(segments[index], deps))
            .filter((line): line is string => !!line?.trim());
        return lines.length >= 2 ? { kind: 'text', text: lines.join('\n') } : undefined;
    }
    if (item.segmentIndex === undefined) {
        return undefined;
    }
    const segment = segments[item.segmentIndex];
    if (!segment || segment.type !== 'tool') {
        return undefined;
    }
    const kind = item.toolKind ?? classifyTranscriptToolActivityKind(segment.name);
    if (kind === 'todo' || isTranscriptTodoTool(segment.name)) {
        const items = parseTranscriptTodoChecklist(segment.args);
        return items?.length ? { kind: 'todo', items } : undefined;
    }
    if (kind === 'terminal') {
        const entry = resolveTranscriptTerminalExpandEntry(segment, deps);
        return entry ? { kind: 'terminal', entry } : undefined;
    }
    if (kind === 'reading') {
        const entry = resolveTranscriptReadExpandEntry(segment, deps);
        return entry ? { kind: 'read', entry } : undefined;
    }
    if (kind === 'searching') {
        const result = segment.result?.trim();
        if (!result || /^ok$/i.test(result)) {
            return undefined;
        }
        const matches = parseTranscriptSearchMatches(result);
        if (matches?.length) {
            return { kind: 'search-matches', matches };
        }
        return { kind: 'text', text: result };
    }
    if (kind === 'editing') {
        const entry = resolveTranscriptEditExpandEntry(segment, deps);
        if (entry) {
            return { kind: 'edit', entry };
        }
        const result = segment.result?.trim();
        return result ? { kind: 'text', text: result } : undefined;
    }
    const fallback = segment.result?.trim();
    return fallback && !/^ok$/i.test(fallback) ? { kind: 'text', text: fallback } : undefined;
}

/** @deprecated Use {@link resolveTranscriptActivityExpandContent} */
export function resolveTranscriptActivityExpandBody(
    item: TranscriptActivityNavigationItem,
    segments: readonly QaapAgentMessageSegmentDTO[] | undefined,
    deps: TranscriptActivityExpandDeps,
): string | undefined {
    const content = resolveTranscriptActivityExpandContent(item, segments, deps);
    if (!content) {
        return undefined;
    }
    if (content.kind === 'text') {
        return content.text;
    }
    if (content.kind === 'search-matches') {
        return content.matches.map(match => `${match.file}:${match.line}: ${match.snippet}`).join('\n');
    }
    if (content.kind === 'read') {
        return content.entry.text;
    }
    if (content.kind === 'read-group') {
        return content.entries.map(entry => entry.text).join('\n\n');
    }
    if (content.kind === 'edit') {
        return content.entry.path;
    }
    if (content.kind === 'edit-group') {
        return content.entries.map(entry => entry.path).join('\n');
    }
    if (content.kind === 'terminal') {
        return [content.entry.command, content.entry.output].filter(Boolean).join('\n\n');
    }
    if (content.kind === 'todo') {
        return content.items.map(item => item.label).join('\n');
    }
    return content.entries
        .map(entry => [entry.command, entry.output].filter(Boolean).join('\n'))
        .join('\n\n');
}

export function shouldShowTranscriptActivityExpandContent(
    item: TranscriptActivityNavigationItem,
    content: TranscriptActivityExpandContent | undefined,
): boolean {
    if (!content || item.thinkingContent || item.navigate === 'thought' || item.errorSummary) {
        return false;
    }
    if (content.kind === 'terminal-group') {
        return content.entries.length >= 2;
    }
    if (content.kind === 'search-matches') {
        return content.matches.length >= 1;
    }
    if (content.kind === 'todo') {
        return content.items.length >= 1;
    }
    if (content.kind === 'read-group') {
        return content.entries.length >= 2;
    }
    if (content.kind === 'edit-group') {
        return content.entries.length >= 2;
    }
    if (content.kind === 'edit') {
        return !!content.entry.path.trim();
    }
    if (content.kind === 'read') {
        const text = content.entry.text.trim();
        if (!text) {
            return false;
        }
        const collapsedPreview = item.resultPreview?.trim();
        if (collapsedPreview && text === collapsedPreview) {
            return false;
        }
        if (collapsedPreview && !text.includes('\n') && text.length <= collapsedPreview.length + 4) {
            return false;
        }
        return text.includes('\n') || text.length > 96;
    }
    if (content.kind === 'terminal') {
        return !!(content.entry.command?.trim() || content.entry.output?.trim());
    }
    const text = content.text.trim();
    if (!text) {
        return false;
    }
    if (item.grouped && item.segmentIndices && item.segmentIndices.length >= 2) {
        return true;
    }
    const collapsedPreview = item.resultPreview?.trim();
    if (collapsedPreview && text === collapsedPreview) {
        return false;
    }
    if (collapsedPreview && !text.includes('\n') && text.length <= collapsedPreview.length + 4) {
        return false;
    }
    return text.includes('\n') || text.length > 96;
}

export function shouldShowTranscriptActivityExpand(
    item: TranscriptActivityNavigationItem,
    expandBody: string | undefined,
): boolean {
    if (!expandBody?.trim() || item.thinkingContent || item.navigate === 'thought' || item.errorSummary) {
        return false;
    }
    if (item.grouped && item.segmentIndices && item.segmentIndices.length >= 2) {
        return true;
    }
    const collapsedPreview = item.resultPreview?.trim();
    if (collapsedPreview && expandBody === collapsedPreview) {
        return false;
    }
    if (collapsedPreview && !expandBody.includes('\n') && expandBody.length <= collapsedPreview.length + 4) {
        return false;
    }
    if (item.toolKind === 'terminal' && expandBody.trim().length > 0) {
        return true;
    }
    return expandBody.includes('\n') || expandBody.length > 96;
}

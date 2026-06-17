// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import type { QaapTranscriptTraceEventDTO } from './qaap-transcript-trace-model';
import {
    classifyTranscriptToolActivityKind,
    extractTranscriptDiffCard,
    type QaapTranscriptToolActivityKind,
} from './qaap-agent-transcript-segments';
import {
    resolveTranscriptCursorTraceLabel,
    splitTranscriptCursorGroupedLabel,
} from './qaap-transcript-cursor-trace-label';
import {
    detectTranscriptToolRetryHint,
    excerptTranscriptToolError,
    type TranscriptActivityStepState,
} from './qaap-transcript-activity-step-state';
import {
    hasActiveTranscriptToolSegment,
    isTranscriptShortTextPreamble,
    resolveTranscriptAgentTextChars,
} from './qaap-transcript-stream-status';

export type { TranscriptActivityStepState };

export type TranscriptActivityNavigateTarget = 'file' | 'terminal' | 'thought';

export interface TranscriptActivityNavigationItem {
    readonly label: string;
    readonly state: TranscriptActivityStepState;
    readonly navigate?: TranscriptActivityNavigateTarget;
    readonly filePath?: string;
    readonly segmentIndex?: number;
    readonly toolKind?: QaapTranscriptToolActivityKind;
    readonly grouped?: boolean;
    readonly groupCount?: number;
    readonly segmentIndices?: readonly number[];
    readonly durationMs?: number;
    readonly timestamp?: number;
    readonly errorSummary?: string;
    readonly retryHint?: boolean;
    /** Cursor-style row parts — verb emphasis + muted tail tags. */
    readonly verb?: string;
    readonly detail?: string;
    readonly tail?: string;
    readonly editAdded?: number;
    readonly editRemoved?: number;
    /** Nested child-agent trace metadata (stream-json parent_tool_use_id). */
    readonly parentToolUseId?: string;
    readonly nestDepth?: number;
    readonly subagentRoot?: boolean;
}

export interface TranscriptActivityNavigationDeps {
    readonly localizeActivityLabel: (label: string) => string;
    readonly formatToolActivityLabel: (toolName: string, argsJson: string) => string;
    readonly localizePlanningLabel: () => string;
    readonly localizeWritingLabel: () => string;
    readonly localizeFailedLabel: (detail: string) => string;
    readonly extractToolPath: (argsJson: string) => string | undefined;
    readonly extractToolCommand?: (argsJson: string) => string | undefined;
    readonly resolveToolKind: (toolName: string) => string;
    readonly isToolResultFailed: (result?: string) => boolean;
    readonly resolveStepDurationMs?: (
        segmentIndex: number,
        segment: QaapAgentMessageSegmentDTO,
    ) => number | undefined;
    readonly resolveStepTimestamp?: (
        segmentIndex: number,
        segment: QaapAgentMessageSegmentDTO,
    ) => number | undefined;
}

export interface TranscriptActivityNavigationOptions {
    readonly streaming?: boolean;
    readonly stalled?: boolean;
    readonly pendingToolUseIds?: ReadonlySet<string>;
    readonly messageCancelled?: boolean;
}

function resolveToolStepState(
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    options: TranscriptActivityNavigationOptions | undefined,
    deps: TranscriptActivityNavigationDeps,
    previousFailed: boolean,
): TranscriptActivityStepState {
    if (options?.messageCancelled) {
        return 'cancelled';
    }
    if (options?.pendingToolUseIds?.has(segment.toolUseId)) {
        return 'waiting';
    }
    if (!segment.finished) {
        if (previousFailed) {
            return 'retrying';
        }
        if (options?.stalled) {
            return 'warning';
        }
        return 'running';
    }
    if (deps.isToolResultFailed(segment.result)) {
        return 'error';
    }
    if (detectTranscriptToolRetryHint(segment.result)) {
        return 'success';
    }
    return 'success';
}

function resolveToolStepLabel(
    baseLabel: string,
    state: TranscriptActivityStepState,
    errorSummary: string | undefined,
    deps: TranscriptActivityNavigationDeps,
): string {
    if (state === 'error' && errorSummary) {
        return deps.localizeFailedLabel(errorSummary);
    }
    if (state === 'retrying') {
        return nls.localize('qaap/mobileProjects/transcriptActivityRetrying', 'Retrying: {0}', baseLabel);
    }
    if (state === 'waiting') {
        return nls.localize('qaap/mobileProjects/transcriptActivityWaiting', 'Waiting for approval: {0}', baseLabel);
    }
    if (state === 'cancelled') {
        return nls.localize('qaap/mobileProjects/transcriptActivityCancelled', 'Cancelled: {0}', baseLabel);
    }
    return baseLabel;
}

function resolveWritingStepState(
    segments: readonly QaapAgentMessageSegmentDTO[],
    options: TranscriptActivityNavigationOptions | undefined,
): TranscriptActivityStepState {
    if (!options?.streaming) {
        return 'success';
    }
    if (hasActiveTranscriptToolSegment(segments, options.pendingToolUseIds)) {
        return 'waiting';
    }
    if (isTranscriptShortTextPreamble(segments)) {
        return 'waiting';
    }
    return 'streaming';
}

export function resolveTranscriptActivityNavigationItems(
    segments: readonly QaapAgentMessageSegmentDTO[],
    deps: TranscriptActivityNavigationDeps,
    includeThinkingSteps = true,
    options?: TranscriptActivityNavigationOptions,
): TranscriptActivityNavigationItem[] {
    const items: TranscriptActivityNavigationItem[] = [];
    let previousFailed = false;
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        const segment = segments[segmentIndex]!;
        if (segment.type === 'thinking' && segment.content.trim()) {
            if (includeThinkingSteps) {
                items.push({
                    label: deps.localizePlanningLabel(),
                    state: options?.streaming ? 'thinking' : 'success',
                    navigate: 'thought',
                    segmentIndex,
                    durationMs: deps.resolveStepDurationMs?.(segmentIndex, segment),
                    timestamp: deps.resolveStepTimestamp?.(segmentIndex, segment),
                });
            }
            previousFailed = false;
            continue;
        }
        if (segment.type !== 'tool') {
            if (segment.type === 'text' && segment.content.trim()) {
                continue;
            }
            previousFailed = false;
            continue;
        }
        const kind = deps.resolveToolKind(segment.name);
        const filePath = deps.extractToolPath(segment.args);
        let navigate: TranscriptActivityNavigateTarget | undefined;
        if (kind === 'terminal') {
            navigate = 'terminal';
        } else if ((kind === 'reading' || kind === 'editing' || kind === 'searching') && filePath) {
            navigate = 'file';
        }
        const errorSummary = deps.isToolResultFailed(segment.result)
            ? excerptTranscriptToolError(segment.result)
            : undefined;
        const state = resolveToolStepState(segment, options, deps, previousFailed);
        const baseLabel = deps.localizeActivityLabel(deps.formatToolActivityLabel(segment.name, segment.args));
        const command = deps.extractToolCommand?.(segment.args);
        const cursorParts = resolveTranscriptCursorTraceLabel(segment.name, segment.args, {
            path: filePath,
            command,
        });
        const diffCard = kind === 'editing' && segment.result?.trim()
            ? extractTranscriptDiffCard(segment.result)
            : undefined;
        items.push({
            label: resolveToolStepLabel(baseLabel, state, errorSummary, deps),
            state,
            navigate,
            filePath,
            segmentIndex,
            toolKind: kind as QaapTranscriptToolActivityKind,
            durationMs: deps.resolveStepDurationMs?.(segmentIndex, segment),
            timestamp: deps.resolveStepTimestamp?.(segmentIndex, segment),
            errorSummary,
            retryHint: detectTranscriptToolRetryHint(segment.result),
            verb: cursorParts.verb,
            detail: cursorParts.detail,
            tail: cursorParts.tail,
            editAdded: diffCard?.added,
            editRemoved: diffCard?.removed,
            parentToolUseId: segment.parentToolUseId,
        });
        previousFailed = state === 'error';
    }
    const textChars = resolveTranscriptAgentTextChars(segments);
    if (options?.streaming && isTranscriptShortTextPreamble(segments)) {
        items.push({
            label: deps.localizePlanningLabel(),
            verb: 'Planning',
            detail: 'next moves',
            state: 'running',
        });
    } else if (textChars > 0) {
        items.push({
            label: deps.localizeWritingLabel(),
            verb: 'Writing',
            detail: 'response',
            state: resolveWritingStepState(segments, options),
            durationMs: undefined,
        });
    }
    return items;
}

const GROUPABLE_TOOL_KINDS = new Set<QaapTranscriptToolActivityKind>([
    'reading',
    'searching',
    'terminal',
]);

function formatGroupedActivityLabel(kind: QaapTranscriptToolActivityKind, count: number): string {
    switch (kind) {
        case 'reading':
            return count === 1
                ? nls.localize('qaap/mobileProjects/transcriptActivityReadOne', 'Read 1 file')
                : nls.localize('qaap/mobileProjects/transcriptActivityReadMany', 'Read {0} files', String(count));
        case 'searching':
            return count === 1
                ? nls.localize('qaap/mobileProjects/transcriptActivitySearchOne', 'Searched once')
                : nls.localize('qaap/mobileProjects/transcriptActivitySearchMany', 'Searched {0} times', String(count));
        case 'terminal':
            return count === 1
                ? nls.localize('qaap/mobileProjects/transcriptActivityCommandOne', 'Ran 1 command')
                : nls.localize('qaap/mobileProjects/transcriptActivityCommandMany', 'Ran {0} commands', String(count));
        case 'editing':
            return count === 1
                ? nls.localize('qaap/mobileProjects/transcriptActivityEditOne', 'Edited 1 file')
                : nls.localize('qaap/mobileProjects/transcriptActivityEditMany', 'Edited {0} files', String(count));
        default:
            return count === 1
                ? nls.localize('qaap/mobileProjects/transcriptActivityToolOne', 'Used 1 tool')
                : nls.localize('qaap/mobileProjects/transcriptActivityToolMany', 'Used {0} tools', String(count));
    }
}

function resolveGroupedNavigationAnchor(
    group: readonly TranscriptActivityNavigationItem[],
): Pick<TranscriptActivityNavigationItem, 'navigate' | 'filePath' | 'segmentIndex'> {
    for (let index = group.length - 1; index >= 0; index--) {
        const item = group[index]!;
        if (item.navigate) {
            return {
                navigate: item.navigate,
                filePath: item.filePath,
                segmentIndex: item.segmentIndex,
            };
        }
    }
    return {};
}

function resolveGroupedDurationMs(group: readonly TranscriptActivityNavigationItem[]): number | undefined {
    let total = 0;
    let found = false;
    for (const item of group) {
        if (item.durationMs !== undefined) {
            total += item.durationMs;
            found = true;
        }
    }
    return found ? total : undefined;
}

const GROUPABLE_RUNNING_KINDS = new Set<QaapTranscriptToolActivityKind>(['terminal']);
const MIN_GROUPED_RUNNING_COUNT = 3;

/** Collapse consecutive finished tool steps of the same kind (e.g. "Read 6 files"). */
/** Timeline rows for AG-UI lifecycle events that are not represented as tool segments. */
export function resolveTranscriptLifecycleActivityItems(
    traceEvents: readonly QaapTranscriptTraceEventDTO[] | undefined,
): TranscriptActivityNavigationItem[] {
    if (!traceEvents?.length) {
        return [];
    }
    return traceEvents.flatMap((event): TranscriptActivityNavigationItem[] => {
        if (event.type === 'checkpoint') {
            const stats = event.added !== undefined || event.removed !== undefined
                ? `+${event.added ?? 0}/-${event.removed ?? 0}`
                : undefined;
            return [{
                label: stats ? `Checkpoint: ${event.label} (${stats})` : `Checkpoint: ${event.label}`,
                state: 'success',
                verb: 'Checkpoint',
                detail: event.label,
                tail: stats,
                timestamp: event.capturedAt,
            }];
        }
        if (event.type === 'run_cancelled') {
            return [{
                label: event.message.trim() || 'Turn cancelled.',
                state: 'cancelled',
                timestamp: event.startedAt,
            }];
        }
        return [];
    });
}

export function groupTranscriptActivityNavigationItems(
    items: readonly TranscriptActivityNavigationItem[],
): TranscriptActivityNavigationItem[] {
    const grouped: TranscriptActivityNavigationItem[] = [];
    let index = 0;
    while (index < items.length) {
        const item = items[index]!;
        const kind = item.toolKind;
        if (!kind) {
            grouped.push(item);
            index += 1;
            continue;
        }
        if (GROUPABLE_RUNNING_KINDS.has(kind) && item.state === 'running') {
            let end = index + 1;
            while (end < items.length) {
                const next = items[end]!;
                if (next.toolKind !== kind || next.state !== 'running') {
                    break;
                }
                end += 1;
            }
            const slice = items.slice(index, end);
            if (slice.length >= MIN_GROUPED_RUNNING_COUNT) {
                const navigation = resolveGroupedNavigationAnchor(slice);
                grouped.push({
                    label: formatGroupedActivityLabel(kind, slice.length),
                    state: 'running',
                    toolKind: kind,
                    grouped: true,
                    groupCount: slice.length,
                    segmentIndices: slice
                        .map(entry => entry.segmentIndex)
                        .filter((segmentIndex): segmentIndex is number => segmentIndex !== undefined),
                    durationMs: resolveGroupedDurationMs(slice),
                    timestamp: slice[slice.length - 1]?.timestamp,
                    ...splitTranscriptCursorGroupedLabel(kind, slice.length),
                    ...navigation,
                });
                index = end;
                continue;
            }
        }
        if (!GROUPABLE_TOOL_KINDS.has(kind) || item.state !== 'success') {
            grouped.push(item);
            index += 1;
            continue;
        }
        let end = index + 1;
        while (end < items.length) {
            const next = items[end]!;
            if (next.toolKind !== kind || next.state !== 'success') {
                break;
            }
            end += 1;
        }
        const slice = items.slice(index, end);
        if (slice.length < 2) {
            grouped.push(item);
            index += 1;
            continue;
        }
        const navigation = resolveGroupedNavigationAnchor(slice);
        grouped.push({
            label: formatGroupedActivityLabel(kind, slice.length),
            state: 'success',
            toolKind: kind,
            grouped: true,
            groupCount: slice.length,
            segmentIndices: slice
                .map(entry => entry.segmentIndex)
                .filter((segmentIndex): segmentIndex is number => segmentIndex !== undefined),
            durationMs: resolveGroupedDurationMs(slice),
            timestamp: slice[slice.length - 1]?.timestamp,
            ...splitTranscriptCursorGroupedLabel(kind, slice.length),
            ...navigation,
        });
        index = end;
    }
    return grouped;
}

export function classifyTranscriptActivityToolKind(toolName: string): ReturnType<typeof classifyTranscriptToolActivityKind> {
    return classifyTranscriptToolActivityKind(toolName);
}

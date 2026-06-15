// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { classifyTranscriptToolActivityKind, type QaapTranscriptToolActivityKind } from './qaap-agent-transcript-segments';

export type TranscriptActivityNavigateTarget = 'file' | 'terminal' | 'thought';

export interface TranscriptActivityNavigationItem {
    readonly label: string;
    readonly state: 'done' | 'running' | 'thinking';
    readonly navigate?: TranscriptActivityNavigateTarget;
    readonly filePath?: string;
    readonly segmentIndex?: number;
    readonly toolKind?: QaapTranscriptToolActivityKind;
    readonly grouped?: boolean;
    readonly groupCount?: number;
    readonly segmentIndices?: readonly number[];
}

export interface TranscriptActivityNavigationDeps {
    readonly localizeActivityLabel: (label: string) => string;
    readonly formatToolActivityLabel: (toolName: string, argsJson: string) => string;
    readonly localizePlanningLabel: () => string;
    readonly localizeWritingLabel: () => string;
    readonly extractToolPath: (argsJson: string) => string | undefined;
    readonly resolveToolKind: (toolName: string) => string;
}

export function resolveTranscriptActivityNavigationItems(
    segments: readonly QaapAgentMessageSegmentDTO[],
    deps: TranscriptActivityNavigationDeps,
    includeThinkingSteps = true,
): TranscriptActivityNavigationItem[] {
    const items: TranscriptActivityNavigationItem[] = [];
    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        const segment = segments[segmentIndex]!;
        if (segment.type === 'thinking' && segment.content.trim()) {
            if (includeThinkingSteps) {
                items.push({
                    label: deps.localizePlanningLabel(),
                    state: 'thinking',
                    navigate: 'thought',
                    segmentIndex,
                });
            }
            continue;
        }
        if (segment.type !== 'tool') {
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
        items.push({
            label: deps.localizeActivityLabel(deps.formatToolActivityLabel(segment.name, segment.args)),
            state: segment.finished ? 'done' : 'running',
            navigate,
            filePath,
            segmentIndex,
            toolKind: kind as QaapTranscriptToolActivityKind,
        });
    }
    if (segments.some(segment => segment.type === 'text' && segment.content.trim())) {
        items.push({
            label: deps.localizeWritingLabel(),
            state: 'done',
        });
    }
    return items;
}

const GROUPABLE_TOOL_KINDS = new Set<QaapTranscriptToolActivityKind>([
    'reading',
    'searching',
    'terminal',
    'editing',
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

/** Collapse consecutive finished tool steps of the same kind (e.g. "Read 6 files"). */
export function groupTranscriptActivityNavigationItems(
    items: readonly TranscriptActivityNavigationItem[],
): TranscriptActivityNavigationItem[] {
    const grouped: TranscriptActivityNavigationItem[] = [];
    let index = 0;
    while (index < items.length) {
        const item = items[index]!;
        const kind = item.toolKind;
        if (!kind || !GROUPABLE_TOOL_KINDS.has(kind) || item.state !== 'done') {
            grouped.push(item);
            index += 1;
            continue;
        }
        let end = index + 1;
        while (end < items.length) {
            const next = items[end]!;
            if (next.toolKind !== kind || next.state !== 'done') {
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
            state: 'done',
            toolKind: kind,
            grouped: true,
            groupCount: slice.length,
            segmentIndices: slice
                .map(entry => entry.segmentIndex)
                .filter((segmentIndex): segmentIndex is number => segmentIndex !== undefined),
            ...navigation,
        });
        index = end;
    }
    return grouped;
}

export function classifyTranscriptActivityToolKind(toolName: string): ReturnType<typeof classifyTranscriptToolActivityKind> {
    return classifyTranscriptToolActivityKind(toolName);
}

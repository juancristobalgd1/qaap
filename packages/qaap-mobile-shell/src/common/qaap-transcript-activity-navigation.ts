// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentMessageSegmentDTO } from './qaap-agent-conversation-client';
import { classifyTranscriptToolActivityKind } from './qaap-agent-transcript-segments';

export type TranscriptActivityNavigateTarget = 'file' | 'terminal' | 'thought';

export interface TranscriptActivityNavigationItem {
    readonly label: string;
    readonly state: 'done' | 'running' | 'thinking';
    readonly navigate?: TranscriptActivityNavigateTarget;
    readonly filePath?: string;
    readonly segmentIndex?: number;
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

export function classifyTranscriptActivityToolKind(toolName: string): ReturnType<typeof classifyTranscriptToolActivityKind> {
    return classifyTranscriptToolActivityKind(toolName);
}

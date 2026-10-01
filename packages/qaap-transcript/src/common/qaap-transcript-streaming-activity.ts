// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { QaapAgentConversationTurnPhaseDTO, QaapAgentMessageSegmentDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { formatToolActivityLabel } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-list-metrics';
import { classifyTranscriptToolActivityKind } from './qaap-agent-transcript-segments';

export interface TranscriptStreamingActivityView {
    readonly kind: string;
    readonly title: string;
    readonly detail: string;
}

/** Shared live-activity resolver for transcript footer rows and composer chrome. */
export function resolveTranscriptStreamingActivityFromSegments(
    segments: readonly QaapAgentMessageSegmentDTO[],
    options?: {
        readonly stalled?: boolean;
        readonly timedOut?: boolean;
        readonly stallTitle?: string;
        readonly localizeToolTitle?: (label: string) => string;
        /** Live turn phase from the conversation; `'verifying'` wins over stall/timeout and segments. */
        readonly turnPhase?: QaapAgentConversationTurnPhaseDTO;
    },
): TranscriptStreamingActivityView {
    const verifying = resolveTranscriptVerifyingActivity(options?.turnPhase);
    if (verifying) {
        return verifying;
    }
    if (options?.timedOut) {
        return {
            kind: 'timeout',
            title: nls.localize('qaap/mobileProjects/transcriptStreamTimedOut', 'The agent didn’t respond in time'),
            detail: nls.localize(
                'qaap/mobileProjects/transcriptStreamTimedOutDetail',
                'Cancel or retry to continue.',
            ),
        };
    }
    if (options?.stalled && segments.length === 0) {
        return {
            kind: 'stall',
            title: nls.localize('qaap/mobileProjects/transcriptActivityStillStarting', 'Still starting the agent'),
            detail: nls.localize(
                'qaap/mobileProjects/transcriptActivityStillStartingDetail',
                'The first run in a while can take a minute while the workspace and model warm up.',
            ),
        };
    }
    if (options?.stalled) {
        return {
            kind: 'stall',
            title: options.stallTitle ?? nls.localize('qaap/mobileProjects/transcriptStreamStalled', 'Taking longer than expected'),
            detail: nls.localize(
                'qaap/mobileProjects/transcriptStreamStalledDetail',
                'The agent is still working in the background.',
            ),
        };
    }
    const activeTool = [...segments].reverse().find((segment): segment is Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> =>
        segment.type === 'tool' && !segment.finished);
    if (activeTool) {
        const rawTitle = formatToolActivityLabel(activeTool.name, activeTool.args);
        const title = options?.localizeToolTitle?.(rawTitle) ?? rawTitle;
        return {
            kind: classifyTranscriptToolActivityKind(activeTool.name),
            title,
            detail: resolveTranscriptStreamingToolDetail(activeTool),
        };
    }
    const hasText = segments.some(segment => segment.type === 'text' && (segment.content?.trim() ?? '').length > 0);
    if (hasText) {
        return {
            kind: 'writing',
            title: nls.localize('qaap/mobileProjects/transcriptActivityWriting', 'Preparing the response'),
            detail: nls.localize('qaap/mobileProjects/transcriptActivityWritingDetail', 'Composing the next visible update.'),
        };
    }
    const planningTitle = nls.localize('qaap/mobileProjects/transcriptActivityPlanningMoves', 'Planning next moves');
    const thinkingSnippet = extractLatestThinkingSnippet(segments);
    if (thinkingSnippet) {
        // Surface the agent's own reasoning during the (often long) thinking-only phase before the
        // first tool call — a live snippet reads as real progress where a static label reads as a hang.
        return {
            kind: 'planning',
            title: planningTitle,
            detail: thinkingSnippet,
        };
    }
    const hasThinking = segments.some(segment => segment.type === 'thinking' && (segment.content?.trim() ?? '').length > 0);
    if (hasThinking) {
        return {
            kind: 'planning',
            title: planningTitle,
            detail: nls.localize('qaap/mobileProjects/transcriptActivityThinkingDetail', 'Planning the next step before changing anything.'),
        };
    }
    if (segments.length === 0) {
        // Nothing from the agent yet: the backend is still waking the workspace / starting the CLI.
        // "Planning next moves" with 0 tokens read as a hang.
        return {
            kind: 'planning',
            title: nls.localize('qaap/mobileProjects/transcriptActivityStartingAgent', 'Starting the agent'),
            detail: nls.localize('qaap/mobileProjects/transcriptActivityStartingAgentDetail', 'Getting the workspace and model ready.'),
        };
    }
    return {
        kind: 'planning',
        title: planningTitle,
        detail: nls.localize('qaap/mobileProjects/transcriptActivityStartingDetail', 'Preparing context and selecting the next action.'),
    };
}

/**
 * Activity row for the runner's automatic post-turn verification, or `undefined` when the turn is
 * not verifying. The agent output is complete at this point, so segments cannot describe it.
 */
export function resolveTranscriptVerifyingActivity(
    turnPhase: QaapAgentConversationTurnPhaseDTO | undefined,
): TranscriptStreamingActivityView | undefined {
    if (turnPhase?.kind !== 'verifying') {
        return undefined;
    }
    const base = nls.localize('qaap/mobileProjects/transcriptActivityVerifying', 'Automatic verification in progress');
    const fixing = turnPhase.status === 'fixing' && turnPhase.attempt > 0;
    const title = fixing
        ? base + nls.localize('qaap/mobileProjects/transcriptActivityVerifyingFixAttempt', ' (fix attempt {0}/{1})', turnPhase.attempt, turnPhase.maxAttempts)
        : base;
    const detail = fixing
        ? nls.localize('qaap/mobileProjects/transcriptActivityVerifyingFixDetail', 'A check failed; the agent is repairing it before finishing.')
        : nls.localize('qaap/mobileProjects/transcriptActivityVerifyingDetail', 'Running the project checks on the changes before finishing.');
    return { kind: 'verifying', title, detail };
}

/** Max characters of live thinking text surfaced as the activity detail (roughly one sentence). */
const THINKING_SNIPPET_MAX_CHARS = 96;

/**
 * A short, single-line snippet of the most recent thinking segment, or `undefined` when there is no
 * thinking text yet. Collapses whitespace and cuts at a sentence/word boundary so the footer detail
 * stays one clean line while the agent is reasoning.
 */
function extractLatestThinkingSnippet(segments: readonly QaapAgentMessageSegmentDTO[]): string | undefined {
    let latest: string | undefined;
    for (const segment of segments) {
        if (segment.type === 'thinking') {
            const content = segment.content?.trim();
            if (content) {
                latest = content;
            }
        }
    }
    if (!latest) {
        return undefined;
    }
    const collapsed = latest.replace(/\s+/g, ' ').trim();
    if (collapsed.length <= THINKING_SNIPPET_MAX_CHARS) {
        return collapsed;
    }
    const clipped = collapsed.slice(0, THINKING_SNIPPET_MAX_CHARS);
    const lastSpace = clipped.lastIndexOf(' ');
    return `${(lastSpace > THINKING_SNIPPET_MAX_CHARS / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

function resolveTranscriptStreamingToolDetail(
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
): string {
    const name = (segment.name ?? 'tool').replace(/_/g, ' ');
    const shortArgs = extractTranscriptStreamingToolShortArg(segment.args);
    return shortArgs
        ? nls.localize('qaap/mobileProjects/transcriptActivityToolDetailWithArgs', '{0}: {1}', name, shortArgs)
        : nls.localize('qaap/mobileProjects/transcriptActivityToolDetail', 'Calling {0}', name);
}

function extractTranscriptStreamingToolShortArg(argsJson: string): string | undefined {
    try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        const value = typeof args.command === 'string' ? args.command
            : typeof args.path === 'string' ? args.path
                : typeof args.file_path === 'string' ? args.file_path
                    : typeof args.pattern === 'string' ? args.pattern
                        : typeof args.query === 'string' ? args.query
                            : undefined;
        if (!value?.trim()) {
            return undefined;
        }
        const clean = value.trim().replace(/\s+/g, ' ');
        return clean.length > 56 ? `${clean.slice(0, 53)}…` : clean;
    } catch {
        const clean = (argsJson ?? '').trim().replace(/\s+/g, ' ');
        if (!clean || clean === '{}') {
            return undefined;
        }
        return clean.length > 56 ? `${clean.slice(0, 53)}…` : clean;
    }
}

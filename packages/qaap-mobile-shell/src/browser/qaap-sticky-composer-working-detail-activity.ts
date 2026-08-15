// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type {
    QaapAgentConversationDTO,
    QaapAgentMessageSegmentDTO,
} from '../common/qaap-agent-conversation-client';
import {
    extractToolArgFilePath,
    formatToolActivityLabel,
} from '../common/qaap-agent-conversation-list-metrics';
import {
    classifyTranscriptToolActivityKind,
    excerptTranscriptThought,
    hasTranscriptActivityStats,
    resolveTranscriptActivityStats,
    resolveTranscriptThinkingContent,
    type QaapTranscriptActivityStats,
} from '../common/qaap-agent-transcript-segments';
import { isAgentToolResultFailure } from '../common/qaap-transcript-content-display';
import {
    groupTranscriptActivityNavigationItems,
    resolveTranscriptActivityNavigationItems,
    type TranscriptActivityNavigationDeps,
    type TranscriptActivityNavigationItem,
} from '../common/qaap-transcript-activity-navigation';
import { resolveTranscriptStreamingActivityFromSegments } from '../common/qaap-transcript-streaming-activity';
import { resolveAgentMessageSegments } from '../common/qaap-transcript-trace-model';
import type { WorkHubTeamMember } from '../common/qaap-work-hub-team';

/** Compact Cursor-style activity model for the Working DETAIL expand panel. */
export interface WorkingAgentDetailActivityFeed {
    readonly thoughtTitle?: string;
    readonly thoughtText?: string;
    readonly exploredSummary?: string;
    readonly liveLabel?: string;
    readonly liveDetail?: string;
    readonly items: readonly TranscriptActivityNavigationItem[];
    readonly emptyFallbackLabel?: string;
}

const MAX_DETAIL_FEED_ITEMS = 16;

export function createWorkingDetailActivityNavDeps(): TranscriptActivityNavigationDeps {
    return {
        localizeActivityLabel: label => localizeWorkingDetailActivityLabel(label),
        formatToolActivityLabel,
        localizePlanningLabel: () => nls.localize(
            'qaap/mobileProjects/transcriptActivityPlanningMoves',
            'Planning next moves',
        ),
        localizeWritingLabel: () => nls.localize(
            'qaap/mobileProjects/transcriptActivityResponseReady',
            'Preparing the response',
        ),
        localizeFailedLabel: detail => nls.localize(
            'qaap/mobileProjects/transcriptActivityFailed',
            'Failed: {0}',
            detail,
        ),
        extractToolPath: args => extractToolArgFilePath(args),
        extractToolCommand: args => extractWorkingDetailToolCommand(args),
        resolveToolKind: name => classifyTranscriptToolActivityKind(name),
        isToolResultFailed: (result, toolName) => isAgentToolResultFailure(result, { toolName }),
    };
}

export function formatWorkingDetailExploredSummary(stats: QaapTranscriptActivityStats): string {
    const parts: string[] = [];
    if (stats.fileReads > 0) {
        parts.push(stats.fileReads === 1
            ? nls.localize('qaap/mobileProjects/transcriptMetaOneFile', '1 file')
            : nls.localize('qaap/mobileProjects/transcriptMetaFiles', '{0} files', String(stats.fileReads)));
    }
    if (stats.searches > 0) {
        parts.push(stats.searches === 1
            ? nls.localize('qaap/mobileProjects/transcriptMetaOneSearch', '1 search')
            : nls.localize('qaap/mobileProjects/transcriptMetaSearches', '{0} searches', String(stats.searches)));
    }
    if (stats.shells > 0) {
        parts.push(stats.shells === 1
            ? nls.localize('qaap/mobileProjects/transcriptMetaRanOneCommand', 'ran 1 command')
            : nls.localize('qaap/mobileProjects/transcriptMetaRanCommands', 'ran {0} commands', String(stats.shells)));
    }
    if (stats.edits > 0) {
        parts.push(stats.edits === 1
            ? nls.localize('qaap/mobileProjects/transcriptMetaOneEdit', '1 edit')
            : nls.localize('qaap/mobileProjects/transcriptMetaEdits', '{0} edits', String(stats.edits)));
    }
    if (stats.otherTools > 0) {
        parts.push(stats.otherTools === 1
            ? nls.localize('qaap/mobileProjects/transcriptMetaOneTool', '1 tool')
            : nls.localize('qaap/mobileProjects/transcriptMetaTools', '{0} tools', String(stats.otherTools)));
    }
    return nls.localize('qaap/mobileProjects/transcriptThoughtMeta', 'Explored {0}', parts.join(', '));
}

/** Build the DETAIL activity feed from agent message segments (Cursor Working panel). */
export function buildWorkingAgentDetailActivityFeed(
    segments: readonly QaapAgentMessageSegmentDTO[],
    options?: {
        readonly streaming?: boolean;
        readonly activityLabelFallback?: string;
    },
): WorkingAgentDetailActivityFeed {
    const streaming = !!options?.streaming;
    const deps = createWorkingDetailActivityNavDeps();
    const rawItems = resolveTranscriptActivityNavigationItems(segments, deps, true, { streaming });
    const grouped = groupTranscriptActivityNavigationItems(rawItems);

    const thinkingContent = resolveTranscriptThinkingContent(segments);
    const thoughtText = thinkingContent
        ? excerptTranscriptThought(thinkingContent, 220)
        : undefined;
    const thoughtLive = streaming && grouped.some(item =>
        (item.navigate === 'thought' || item.verb === 'Thinking') && isLiveActivityState(item.state));
    const thoughtTitle = thoughtText
        ? (thoughtLive
            ? nls.localize('qaap/mobileProjects/transcriptThinking', 'Thinking')
            : nls.localize('qaap/workHubChrome/workingDetailThoughtBriefly', 'Thought briefly'))
        : undefined;

    const stats = resolveTranscriptActivityStats(segments);
    const exploredSummary = hasTranscriptActivityStats(stats)
        ? formatWorkingDetailExploredSummary(stats)
        : undefined;

    const feedItems = grouped
        .filter(item => item.navigate !== 'thought' && item.verb !== 'Thinking')
        .slice(-MAX_DETAIL_FEED_ITEMS);

    let liveLabel: string | undefined;
    let liveDetail: string | undefined;
    if (streaming) {
        const live = resolveTranscriptStreamingActivityFromSegments(segments, {
            localizeToolTitle: label => localizeWorkingDetailActivityLabel(label),
        });
        liveLabel = live.title;
        liveDetail = live.detail;
    } else if (!thoughtText && feedItems.length === 0) {
        const fallback = options?.activityLabelFallback?.trim();
        if (fallback) {
            liveLabel = fallback;
        }
    }

    const emptyFallbackLabel = (!thoughtText && !exploredSummary && feedItems.length === 0 && !liveLabel)
        ? (options?.activityLabelFallback?.trim()
            || nls.localize('qaap/mobileProjects/status/working', 'Working'))
        : undefined;

    return {
        thoughtTitle,
        thoughtText,
        exploredSummary,
        liveLabel,
        liveDetail,
        items: feedItems,
        emptyFallbackLabel,
    };
}

export interface ResolveWorkingAgentDetailActivityFeedOptions {
    /** Live AG-UI trace segments when the cached document is still empty / stale. */
    readonly liveSegments?: readonly QaapAgentMessageSegmentDTO[];
    /**
     * Parsed VPS task-log segments (OpenCode NDJSON, etc.) when the member has no
     * conversation document yet — drives the Cursor-style DETAIL feed.
     */
    readonly taskLogSegments?: readonly QaapAgentMessageSegmentDTO[];
}

/**
 * Resolve DETAIL feed from a cached conversation document (and optional live trace).
 * When segments are missing (VPS tasks, pre-hydration), build a Cursor-style fallback
 * from command / activityLabel / command-like title — never a lone generic "Working"
 * when the member already exposes something more specific.
 */
export function resolveWorkingAgentDetailActivityFeedFromConversation(
    document: QaapAgentConversationDTO | undefined,
    member: WorkHubTeamMember,
    options?: ResolveWorkingAgentDetailActivityFeedOptions,
): WorkingAgentDetailActivityFeed | undefined {
    const documentSegments = document ? resolveLatestAgentSegments(document) : [];
    const liveSegments = options?.liveSegments ?? [];
    const taskLogSegments = options?.taskLogSegments ?? [];
    const segments = documentSegments.length > 0
        ? documentSegments
        : (liveSegments.length > 0 ? [...liveSegments] : [...taskLogSegments]);
    if (segments.length > 0) {
        const streaming = document?.status === 'streaming'
            || document?.status === 'settled'
            || isWorkingMemberLive(member);
        return buildWorkingAgentDetailActivityFeed(segments, {
            streaming,
            activityLabelFallback: resolveMeaningfulActivityLabel(member),
        });
    }
    return buildWorkingAgentDetailActivityFallback(member);
}

/**
 * Cursor-style DETAIL feed when transcript segments are unavailable.
 * Covers VPS leader-task/subtask (command) and conversations still hydrating.
 */
export function buildWorkingAgentDetailActivityFallback(
    member: WorkHubTeamMember,
): WorkingAgentDetailActivityFeed | undefined {
    const command = resolveWorkingMemberCommand(member);
    if (command) {
        return buildRunningCommandActivityFeed(command);
    }

    const activity = resolveMeaningfulActivityLabel(member);
    if (activity) {
        return {
            items: [],
            liveLabel: activity,
        };
    }

    const title = member.title?.trim();
    if (isWorkingMemberLive(member) && title && !isGenericWorkingLabel(title)) {
        // Title alone is still more useful than a static "Working" (e.g. task name).
        return {
            items: [],
            liveLabel: nls.localize(
                'qaap/workHubChrome/workingOnTask',
                'Working on {0}',
                title,
            ),
            liveDetail: title,
        };
    }

    if (isWorkingMemberLive(member)) {
        return {
            items: [],
            liveLabel: nls.localize('qaap/mobileProjects/status/working', 'Working'),
        };
    }
    return undefined;
}

/** Shell command for a working member — VPS `command`, else command-like title. */
export function resolveWorkingMemberCommand(member: WorkHubTeamMember): string | undefined {
    const fromCommand = member.command?.trim();
    if (fromCommand) {
        return fromCommand;
    }
    const title = member.title?.trim();
    if (title && looksLikeShellCommand(title)) {
        return title;
    }
    // activityLabel sometimes carries the raw command for VPS rows.
    const activity = member.activityLabel?.trim();
    if (activity && looksLikeShellCommand(activity)) {
        return activity;
    }
    return undefined;
}

export function buildRunningCommandActivityFeed(command: string): WorkingAgentDetailActivityFeed {
    const liveLabel = nls.localize('qaap/mobileProjects/activityRunningCommand', 'Running command');
    const summary = summarizeVpsCommand(command);
    const item: TranscriptActivityNavigationItem = {
        label: `${liveLabel} ${summary}`,
        verb: liveLabel,
        detail: summary,
        state: 'running',
        navigate: 'terminal',
        toolKind: 'terminal',
    };
    return {
        liveLabel,
        liveDetail: summary,
        items: [item],
    };
}

/**
 * Reduce a potentially long VPS command/prompt to a single-line human-readable summary.
 * Strips delegation instructions and keeps only the actual task (last meaningful line).
 */
function summarizeVpsCommand(command: string): string {
    const trimmed = command.trim();
    if (!trimmed) {
        return '';
    }
    // If it's already a short single-line command, keep it as-is.
    if (trimmed.length <= 120 && !trimmed.includes('\n')) {
        return trimmed;
    }
    // For multi-line prompts, find the last non-empty paragraph that looks like the actual task.
    // Skip instruction blocks like "[Team delegation — qaap-task]" and helper text.
    const lines = trimmed.split('\n');
    const meaningfulLines = lines
        .map(l => l.trim())
        .filter(l => l.length > 0
            && !l.startsWith('---')
            && !l.startsWith('[')
            && !l.startsWith('qaap-task')
            && !l.startsWith('Sub-tasks')
            && !l.startsWith('Use delegation')
            && !l.startsWith('For a broad')
            && !l.startsWith('Do not repeat')
            && !l.startsWith('When sub-tasks')
            && !l.startsWith('Available --agent'));
    // Take the last meaningful line (usually the actual task prompt).
    const last = meaningfulLines[meaningfulLines.length - 1] ?? lines[0]?.trim() ?? trimmed;
    if (last.length <= 140) {
        return last;
    }
    return `${last.slice(0, 137).trimEnd()}…`;
}

function resolveMeaningfulActivityLabel(member: WorkHubTeamMember): string | undefined {
    const activity = member.activityLabel?.trim();
    if (!activity || isGenericWorkingLabel(activity)) {
        return undefined;
    }
    return activity;
}

function isGenericWorkingLabel(label: string | undefined): boolean {
    if (!label) {
        return true;
    }
    const normalized = label.trim().toLowerCase().replace(/[.…]+$/u, '');
    return normalized === 'working' || normalized === 'working…' || normalized === 'working...';
}

/** Best-effort detect shell / package-manager commands used as task titles. */
export function looksLikeShellCommand(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 200) {
        return false;
    }
    if (/^(npm|pnpm|yarn|bun|npx|node|python3?|pip|cargo|go|make|cmake|docker|podman|git|bash|sh|zsh|curl|wget)\b/i.test(trimmed)) {
        return true;
    }
    if (/^(npm|pnpm|yarn|bun)\s+run\b/i.test(trimmed)) {
        return true;
    }
    if (/^\.\//.test(trimmed) || /^[A-Za-z0-9_./-]+\.(sh|bash|py|js|mjs|cjs|ts)\b/.test(trimmed)) {
        return true;
    }
    return false;
}

/** Render the Cursor-style activity feed DOM for Working DETAIL. */
export function renderWorkingAgentDetailActivityFeed(feed: WorkingAgentDetailActivityFeed): HTMLElement {
    const root = document.createElement('div');
    root.className = 'qaap-working-agents-detail-activity';

    if (feed.thoughtTitle && feed.thoughtText) {
        const thought = document.createElement('div');
        thought.className = 'qaap-working-agents-detail-thought';

        const title = document.createElement('div');
        title.className = 'qaap-working-agents-detail-thought-title';
        title.textContent = feed.thoughtTitle;

        const text = document.createElement('div');
        text.className = 'qaap-working-agents-detail-thought-text';
        text.textContent = feed.thoughtText;

        thought.append(title, text);
        root.append(thought);
    }

    if (feed.exploredSummary) {
        const explored = document.createElement('div');
        explored.className = 'qaap-working-agents-detail-explored';
        explored.textContent = feed.exploredSummary;
        root.append(explored);
    }

    if (feed.liveLabel) {
        const live = document.createElement('div');
        live.className = 'qaap-working-agents-detail-live';
        live.classList.add('theia-mod-shimmer');
        live.setAttribute('aria-live', 'polite');

        const label = document.createElement('div');
        label.className = 'qaap-working-agents-detail-live-label';
        label.textContent = feed.liveLabel;
        live.append(label);

        const detail = feed.liveDetail?.trim();
        if (detail && detail !== feed.liveLabel) {
            const detailEl = document.createElement('div');
            detailEl.className = 'qaap-working-agents-detail-live-detail';
            detailEl.textContent = detail;
            live.append(detailEl);
        }
        root.append(live);
    }

    if (feed.items.length > 0) {
        const list = document.createElement('div');
        list.className = 'qaap-working-agents-detail-activity-feed';
        list.setAttribute('role', 'list');
        for (const item of feed.items) {
            list.append(renderWorkingDetailActivityFeedRow(item));
        }
        root.append(list);
    } else if (feed.emptyFallbackLabel && !feed.liveLabel) {
        const empty = document.createElement('div');
        empty.className = 'qaap-working-agents-detail-activity-empty';
        empty.textContent = feed.emptyFallbackLabel;
        root.append(empty);
    }

    return root;
}

function renderWorkingDetailActivityFeedRow(item: TranscriptActivityNavigationItem): HTMLElement {
    const row = document.createElement('div');
    row.className = 'qaap-working-agents-detail-activity-row';
    row.setAttribute('role', 'listitem');
    row.dataset.state = item.state;
    if (item.grouped) {
        row.classList.add('theia-mod-grouped');
    }
    if (isLiveActivityState(item.state)) {
        row.classList.add('theia-mod-live');
    }
    if (item.nestDepth && item.nestDepth > 0) {
        row.classList.add('theia-mod-nested');
        row.style.setProperty('--qaap-working-detail-nest', String(Math.min(item.nestDepth, 3)));
    }
    if (item.subagentRoot) {
        row.classList.add('theia-mod-subagent-root');
    }

    const main = document.createElement('div');
    main.className = 'qaap-working-agents-detail-activity-row-main';

    if (item.verb || item.detail) {
        if (item.verb) {
            const verb = document.createElement('span');
            verb.className = 'qaap-working-agents-detail-activity-verb';
            verb.textContent = item.verb;
            main.append(verb);
        }
        if (item.detail) {
            const detail = document.createElement('span');
            detail.className = 'qaap-working-agents-detail-activity-detail';
            detail.textContent = item.detail;
            main.append(detail);
        }
    } else {
        const label = document.createElement('span');
        label.className = 'qaap-working-agents-detail-activity-label';
        label.textContent = item.label;
        main.append(label);
    }
    row.append(main);

    if (item.tail) {
        const tail = document.createElement('div');
        tail.className = 'qaap-working-agents-detail-activity-tail';
        tail.textContent = item.tail;
        row.append(tail);
    } else if (item.resultPreview) {
        const preview = document.createElement('div');
        preview.className = 'qaap-working-agents-detail-activity-tail';
        preview.textContent = item.resultPreview;
        row.append(preview);
    }

    return row;
}

function resolveLatestAgentSegments(document: QaapAgentConversationDTO): QaapAgentMessageSegmentDTO[] {
    for (let index = document.messages.length - 1; index >= 0; index--) {
        const message = document.messages[index]!;
        if (message.role !== 'agent') {
            continue;
        }
        return [...resolveAgentMessageSegments(message)];
    }
    return [];
}

function isWorkingMemberLive(member: WorkHubTeamMember): boolean {
    return member.state === 'streaming' || member.state === 'running';
}

function isLiveActivityState(state: TranscriptActivityNavigationItem['state']): boolean {
    return state === 'running' || state === 'streaming' || state === 'thinking'
        || state === 'waiting' || state === 'retrying' || state === 'warning';
}

function localizeWorkingDetailActivityLabel(label: string): string {
    switch (label) {
        case 'Searching':
            return nls.localize('qaap/mobileProjects/activitySearching', 'Searching');
        case 'Thinking':
            return nls.localize('qaap/mobileProjects/activityThinking', 'Thinking');
        case 'Reading files':
            return nls.localize('qaap/mobileProjects/activityReading', 'Reading files');
        case 'Running command':
            return nls.localize('qaap/mobileProjects/activityRunningCommand', 'Running command');
        case 'Editing':
            return nls.localize('qaap/mobileProjects/activityEditing', 'Editing');
        case 'Working':
            return nls.localize('qaap/mobileProjects/taskPreviewWorking', 'Working…');
        default:
            return label;
    }
}

function extractWorkingDetailToolCommand(argsJson: string): string | undefined {
    try {
        const args = JSON.parse(argsJson) as Record<string, unknown>;
        const command = [args.command, args.cmd, args.script]
            .find((value): value is string => typeof value === 'string' && value.trim().length > 0);
        return command?.trim();
    } catch {
        const match = argsJson.match(/<(?:command|cmd|script)>\s*([\s\S]+?)\s*<\/(?:command|cmd|script)>/i)
            ?? argsJson.match(/<(?:command|cmd|script)>\s*([^\n\r<]+)/i);
        return match?.[1]?.replace(/\s+/g, ' ').trim() || undefined;
    }
}

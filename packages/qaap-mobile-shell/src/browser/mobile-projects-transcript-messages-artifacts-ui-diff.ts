import type { TranscriptActivityTimelineOptions } from './mobile-projects-transcript-messages-artifacts-ui';
import type { MobileProjectsTranscriptMessagesArtifactsUiContext } from './mobile-projects-transcript-messages-artifacts-ui-context';
import { lazyTranscriptToolPillBodies } from './mobile-projects-transcript-messages-artifacts-ui-constants';
// Extracted from mobile-projects-transcript-messages-artifacts-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationDTO, type QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { conversationUsesInteractiveApprovals } from '../common/qaap-agent-interactive-approvals';
import { extractTranscriptMcpServerLabel, isTranscriptTodoTool, parseTranscriptTodoChecklist, resolveTranscriptToolPillDescriptors, shouldOpenTranscriptToolDetails } from '../common/qaap-agent-transcript-segments';
import {
    resolveTranscriptActivityTimelineSummaryText,
} from '../common/qaap-transcript-activity-timeline-summary';
import { isPendingTranscriptToolSegment } from '../common/qaap-transcript-approval-inline';
import { buildTranscriptApprovalCard } from './qaap-transcript-approval-card-ui';
import { respondToTranscriptApproval } from './qaap-transcript-approval-respond';
import { buildTranscriptToolUiPayloadElement } from './qaap-transcript-rich-content-ui';
import { resolveTranscriptToolUiPayloadFromSegment } from '../common/qaap-transcript-tool-ui-payloads';
import { TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, TRANSCRIPT_MESSAGE_ID_ATTR, TRANSCRIPT_TOOL_USE_ID_ATTR } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-incremental-update';
import { bindTranscriptActivityListKeyboard } from '../common/qaap-transcript-activity-keyboard';
import {
    isTranscriptExecutionTimelineNarrative,
    buildTranscriptExecutionTimelineItems,
} from './mobile-projects-transcript-timeline-utils';

export function createTranscriptToolPillExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    conv?: QaapAgentConversationDTO,
    options?: { readonly deferHeavyContent?: boolean },): HTMLDetailsElement {
    const manualApproval = !!conv && conversationUsesInteractiveApprovals(conv);
    const descriptors = resolveTranscriptToolPillDescriptors([segment], {
        resolvePath: args => ctx.resolversUi.extractTranscriptToolFullPath(args),
    });
    const descriptor = descriptors[0];
    const kind = descriptor?.kind ?? ctx.resolversUi.resolveTranscriptToolKind(segment.name);
    const pill = document.createElement('details');
    pill.className = `theia-mobile-agent-tool-pill theia-mod-${kind}`;
    pill.setAttribute(TRANSCRIPT_TOOL_USE_ID_ATTR, segment.toolUseId);
    pill.classList.toggle('theia-mod-running', !(descriptor?.finished ?? segment.finished));
    pill.classList.toggle('theia-mod-done', descriptor?.finished ?? segment.finished);
    pill.classList.toggle('theia-mod-failed', descriptor?.resultFailed ?? false);
    const pendingApproval = manualApproval
        && isPendingTranscriptToolSegment(segment)
        && ctx.host.transcriptLiveUi.hasPendingTranscriptToolApproval(conv!.id, segment.toolUseId);
    pill.classList.toggle('theia-mod-awaiting-approval', pendingApproval);
    const finished = descriptor?.finished ?? segment.finished;
    const failed = descriptor?.resultFailed ?? false;
    pill.open = shouldOpenTranscriptToolDetails({
        finished,
        resultFailed: failed,
    });
    const todoChecklist = isTranscriptTodoTool(segment.name) && !!parseTranscriptTodoChecklist(segment.args);
    if (todoChecklist) {
        // The live task checklist stays visible, Claude-Code-style.
        pill.open = true;
    }
    if (kind === 'terminal' && (!finished || !!segment.result?.trim())) {
        pill.open = true;
    }
    const rowParts = ctx.resolveToolRowParts(segment, kind);
    pill.append(ctx.toolUi.createTranscriptToolPillSummary({
        kind,
        verb: rowParts.verb,
        label: rowParts.detail,
        finished,
        failed,
        mcpServer: kind === 'mcp' ? extractTranscriptMcpServerLabel(segment.args) : undefined,
        startedAt: segment.startedAt,
        copyFrom: segment.result?.trim()
            ? () => ctx.resolversUi.formatTranscriptToolResult(segment.result!)
            : undefined,
    }));
    if (ctx.resolversUi.isTranscriptPureReadTool(segment.name)
        && !ctx.resolversUi.shouldShowTranscriptToolResultBody(segment, kind)) {
        return pill;
    }
    const lazyBody = ctx.shouldLazyHydrateTranscriptToolPillBody({
        segment,
        finished,
        failed,
        pendingApproval,
        todoChecklist: !!todoChecklist,
        deferHeavyContent: !!options?.deferHeavyContent,
        open: pill.open,
    });
    if (lazyBody) {
        lazyTranscriptToolPillBodies.set(pill, {
            segment,
            conv,
            kind,
            finished,
            resultFailed: failed,
        });
        ctx.attachLazyTranscriptToolPillHydration(pill);
        return pill;
    }
    pill.append(ctx.buildTranscriptToolPillBody(segment, conv, kind, {
        pendingApproval,
        finished,
        todoChecklist: !!todoChecklist,
    }));
    return pill;
}

export function shouldLazyHydrateTranscriptToolPillBodyExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, options: {
    readonly segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>;
    readonly finished: boolean;
    readonly failed: boolean;
    readonly pendingApproval: boolean;
    readonly todoChecklist: boolean;
    readonly deferHeavyContent: boolean;
    readonly open: boolean;
}): boolean {
    if (options.pendingApproval || options.todoChecklist || options.failed) {
        return false;
    }
    if (!options.finished || options.open) {
        return false;
    }
    if (!options.segment.result?.trim()) {
        return false;
    }
    return true;
}

export function attachLazyTranscriptToolPillHydrationExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, pill: HTMLDetailsElement): void {
    if (pill.dataset.transcriptLazyToolBound === '1') {
        return;
    }
    pill.dataset.transcriptLazyToolBound = '1';
    pill.addEventListener('toggle', () => {
        if (!pill.open || pill.querySelector('.theia-mobile-agent-tool-pill-body')) {
            return;
        }
        const payload = lazyTranscriptToolPillBodies.get(pill);
        if (!payload) {
            return;
        }
        lazyTranscriptToolPillBodies.delete(pill);
        pill.append(ctx.buildTranscriptToolPillBody(payload.segment, payload.conv, payload.kind, {
            pendingApproval: false,
            finished: payload.finished,
            todoChecklist: false,
        }));
    });
}

export function buildTranscriptToolPillBodyExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    conv: QaapAgentConversationDTO | undefined,
    kind: string,
    options: {
        readonly pendingApproval: boolean;
        readonly finished: boolean;
        readonly todoChecklist: boolean;
    },): HTMLElement {
    const body = document.createElement('div');
    body.className = 'theia-mobile-agent-tool-pill-body';
    if (options.pendingApproval && conv) {
        body.append(ctx.createTranscriptToolApprovalActions(conv.id, segment));
    }
    const richPayload = resolveTranscriptToolUiPayloadFromSegment(segment.name, segment.args, segment.result);
    if (richPayload && !segment.result?.trim()) {
        body.append(buildTranscriptToolUiPayloadElement(richPayload));
    }
    if (segment.result?.trim() || options.todoChecklist) {
        body.append(ctx.toolUi.createTranscriptToolResultBody(
            segment,
            kind,
            { streaming: !options.finished },
        ));
    } else if (!options.finished) {
        ctx.toolUi.ensureTranscriptToolSpeculativePlaceholder(body, segment);
    }
    return body;
}

export function createTranscriptToolApprovalActionsExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, conversationId: string,
    segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,): HTMLElement {
    const pending = ctx.host.transcriptLiveUi.getPendingTranscriptToolApproval(conversationId, segment.toolUseId);
    const onSettled = (): void => {
        void ctx.host.transcriptLiveUi.refreshTranscriptApprovals();
        ctx.host.transcriptLiveUi.ensureTranscriptConversationRefresh();
    };
    const pendingSummary = pending?.summary?.trim();
    return buildTranscriptApprovalCard({
        surface: 'pill',
        title: nls.localize(
            'qaap/mobileProjects/transcriptToolApprovalTitle',
            'Allow {0}?',
            segment.name,
        ),
        description: pendingSummary
            ? `${pendingSummary}\n${nls.localize(
                'qaap/mobileProjects/transcriptToolApprovalComposerHint',
                'Prefer the Allow button above the composer if this one does not respond.',
            )}`
            : nls.localize(
                'qaap/mobileProjects/transcriptToolApprovalComposerHint',
                'Prefer the Allow button above the composer if this one does not respond.',
            ),
    }, {
        onApprove: event => {
            if (!pending) {
                return;
            }
            void respondToTranscriptApproval(pending.id, 'approve', { fromEvent: event, callbacks: { onSettled } });
        },
        onReject: event => {
            if (!pending) {
                return;
            }
            void respondToTranscriptApproval(pending.id, 'reject', { fromEvent: event, callbacks: { onSettled } });
        },
    });
}

export function resolveTranscriptActivityTimelineSummaryExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segments: readonly QaapAgentMessageSegmentDTO[],
    hiddenCount = 0,
    options?: { readonly streaming?: boolean; readonly row?: HTMLElement },): string {
    return resolveTranscriptActivityTimelineSummaryText(hiddenCount, {
        streaming: options?.streaming,
        durationMs: ctx.resolveTranscriptTurnDurationMs(segments, options?.row),
    });
}

export function resolveTranscriptTurnDurationMsExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segments: readonly QaapAgentMessageSegmentDTO[],
    row: HTMLElement | undefined,): number | undefined {
    const messageId = row?.getAttribute(TRANSCRIPT_MESSAGE_ID_ATTR);
    return messageId
        ? ctx.activityTiming.resolveTurnDurationMs(messageId, segments)
        : undefined;
}

export function createTranscriptActivityTimelineExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segments: QaapAgentMessageSegmentDTO[],
    options?: TranscriptActivityTimelineOptions & { readonly includeThinkingSteps?: boolean },): HTMLElement | undefined {
    const includeThinkingSteps = options?.includeThinkingSteps ?? true;
    const items = ctx.resolveTranscriptActivityItemsForDisplay(segments, {
        stalled: options?.stalled,
        includeThinkingSteps,
        row: options?.row,
        conv: options?.conv,
        streaming: options?.streaming,
    });
    if (items.length === 0) {
        return undefined;
    }
    const timelineItems = buildTranscriptExecutionTimelineItems(items);
    const timelineOptions = { ...options, segments, includeThinkingSteps, cursorTrace: true };

    const timeline = document.createElement('details');
    timeline.className = 'theia-mobile-agent-activity-timeline theia-mod-inline theia-mod-collapsible theia-mod-cursor-trace theia-mobile-agent-lobe-workflow';
    timeline.setAttribute(TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, 'true');
    timeline.setAttribute(
        'aria-label',
        nls.localize('qaap/mobileProjects/transcriptActivityTimeline', 'Activity'),
    );
    timeline.setAttribute('aria-atomic', 'true');
    timeline.setAttribute('role', 'log');
    timeline.classList.toggle('theia-mod-stalled', !!options?.stalled);
    timeline.open = false;

    const summary = document.createElement('summary');
    summary.className = 'theia-mobile-agent-activity-timeline-summary theia-mobile-agent-lobe-workflow-summary';
    const summaryIcon = document.createElement('span');
    summaryIcon.className = 'theia-mobile-agent-trace-glyph theia-mobile-agent-activity-timeline-summary-icon';
    summaryIcon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'theia-mobile-agent-activity-timeline-summary-label';
    label.textContent = ctx.resolveTranscriptActivityTimelineSummary(segments, 0, {
        streaming: !!options?.streaming,
        row: options?.row,
    });
    const count = document.createElement('span');
    count.className = 'theia-mobile-agent-activity-timeline-summary-count';
    count.textContent = String(timelineItems.filter(item => !isTranscriptExecutionTimelineNarrative(item)).length);
    const chevron = document.createElement('span');
    chevron.className = 'theia-mobile-agent-activity-timeline-summary-chevron theia-mobile-agent-lobe-workflow-toggle codicon codicon-chevron-down';
    chevron.setAttribute('aria-hidden', 'true');
    summary.append(summaryIcon, label, count, chevron);
    const openPanel = document.createElement('div');
    openPanel.className = 'theia-mobile-agent-activity-timeline-open-panel';
    const stickyBar = document.createElement('button');
    stickyBar.type = 'button';
    stickyBar.className = 'theia-mobile-agent-activity-timeline-sticky-bar theia-mobile-agent-lobe-workflow-summary';
    stickyBar.setAttribute('aria-expanded', 'true');
    const stickyIcon = document.createElement('span');
    stickyIcon.className = 'theia-mobile-agent-trace-glyph theia-mobile-agent-activity-timeline-summary-icon';
    stickyIcon.setAttribute('aria-hidden', 'true');
    const stickyLabel = document.createElement('span');
    stickyLabel.className = 'theia-mobile-agent-activity-timeline-summary-label';
    const stickyCount = document.createElement('span');
    stickyCount.className = 'theia-mobile-agent-activity-timeline-summary-count';
    const stickyChevron = document.createElement('span');
    stickyChevron.className = 'theia-mobile-agent-activity-timeline-summary-chevron theia-mobile-agent-lobe-workflow-toggle codicon codicon-chevron-down';
    stickyChevron.setAttribute('aria-hidden', 'true');
    stickyBar.append(stickyIcon, stickyLabel, stickyCount, stickyChevron);
    const list = document.createElement('ol');
    list.className = 'theia-mobile-agent-activity-list';
    bindTranscriptActivityListKeyboard(list);
    openPanel.append(stickyBar, list);
    timeline.append(summary, openPanel);
    ctx.syncTranscriptActivityTimelineElement(timeline, timelineItems, timelineOptions);
    return timeline;
}


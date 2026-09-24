import type { MobileProjectsTranscriptMessagesArtifactsUiContext } from './mobile-projects-transcript-messages-artifacts-ui-context';
import { resolveAgentMessageTiming } from '../common/qaap-transcript-turn-status';
// Extracted from mobile-projects-transcript-messages-artifacts-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationDTO, type QaapAgentConversationSummaryDTO, type QaapAgentMessageSegmentDTO, conversationToSummary } from '../common/qaap-agent-conversation-client';
import { hasTranscriptActivityStats, resolveTranscriptActivityStats, resolveTranscriptThinkingContent } from '../common/qaap-agent-transcript-segments';
import { resolveLastUserPromptChars, shouldShowTranscriptThoughtBrief } from '../common/qaap-transcript-stream-status';
import type { TranscriptActivityNavigationItem } from '../common/qaap-transcript-activity-navigation';
import { TRANSCRIPT_ACTIVITY_TIMELINE_ATTR, TRANSCRIPT_SEGMENT_INDEX_ATTR, TRANSCRIPT_THOUGHT_BRIEF_ATTR } from '@theia/qaap-transcript-overlay/lib/common/qaap-transcript-incremental-update';
import type { MobileProjectEntry } from './mobile-projects-types';
import { MobileSnackbar } from './mobile-snackbar';
import {
    buildMobileExecutionEvents,
    createMobileDiffSummaryElement,
    createMobileLineDiffSummaryElement,
    findMobileProcessAccordion,
    hasMobileExecutionEventTimeline,
    MOBILE_CLOSING_ERROR_CARD_CLASS,
    refreshMobileExecutionEventTimeline,
    resolveMobileActivityVerb,
    syncMobileProcessAccordionState,
    syncTranscriptStandaloneTurnProvenance,
} from './qaap-execution-event-timeline';
import { ensureSlowTurnHint } from './qaap-slow-turn-hint';
import {
    resolveTranscriptChatHostFromNode,
} from '../common/qaap-transcript-live-status';
import {
    buildTranscriptExecutionTimelineItems,
} from './mobile-projects-transcript-timeline-utils';
import {
    resolveLobeVisibleTextSegmentIndexes as resolveLobeVisibleTextSegmentIndexesHelper,
    enrichChangedFilesWithComposerGitStats as enrichChangedFilesWithComposerGitStatsHelper,
} from './mobile-projects-transcript-messages-artifacts-helpers';
import {
    bindTranscriptActivityListActions as bindTranscriptActivityListActionsHelper,
} from './mobile-projects-transcript-messages-artifacts-helpers';

export function syncRowProcessAccordionExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO | undefined,
        streaming: boolean,): void {
        const accordion = findMobileProcessAccordion(row);
        if (!accordion) {
            return;
        }
        // `row` represents one specific agent message, not necessarily the
        // conversation's last one -- resolve it via the row's message-id
        // attribute so a historical (already-settled) turn's accordion isn't
        // mislabeled as cancelled just because a later turn ended up
        // cancelled.
        const message = ctx.resolveTranscriptRowAgentMessage(row, conv);
        const { isWorking, elapsedMs, turnStartMs } = resolveAgentMessageTiming(conv, message);
        const activityVerb = isWorking ? resolveMobileActivityVerb(buildMobileExecutionEvents(segments).events) : undefined;
        const provenance = ctx.resolveTurnProvenance(conv, message);
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (segmentsBody) {
            syncTranscriptStandaloneTurnProvenance(segmentsBody, provenance.turnAgentId, provenance.turnAgentModel);
        }
        syncMobileProcessAccordionState(accordion, {
            isWorking,
            isError: ctx.isConversationError(conv),
            isCancelled: ctx.isAgentMessageCancelled(message),
            elapsedMs,
            turnStartMs,
            activityVerb,
            onStopRun: ctx.resolveRunStopHandler(conv, message, isWorking),
            // Only the finalize path calls with streaming=false, and it does so
            // AFTER appending the closing narrative + diff summary — that is
            // the one moment auto-collapse is allowed. Streaming syncs must
            // never collapse, even if the working flag flickers between tools.
            settled: !isWorking,
        });
        // Re-ensure the slow-turn hint on every sync (runs on every streaming
        // tick): this is what lets the hint survive `accordion` being wholly
        // replaced by a full timeline rebuild mid-stream, and what removes it
        // promptly once the turn settles.
        ensureSlowTurnHint(accordion, {
            isWorking,
            turnStartMs,
            onStopTurn: ctx.resolveRunStopHandler(conv, message, isWorking) ?? (() => ctx.host.cancelOpenTranscriptStream?.()),
        });
}

export function upgradeToMobileExecutionEventTimelineExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        options: { readonly streaming: boolean; readonly conv?: QaapAgentConversationDTO },): void {
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
            return;
        }
        // Remove legacy elements: thought brief, activity timeline, artifacts,
        // and all text blocks (process-prose text blocks will be re-rendered
        // as narrative inside the timeline; closing-narrative text blocks will
        // be re-rendered after the timeline). Keep the standalone turn-provenance
        // badge — it stays ABOVE the accordion after upgrade (same visual slot
        // as before tools arrived); renderMobileExecutionEventTimeline re-syncs it.
        segmentsBody.querySelectorAll(
            `[${TRANSCRIPT_THOUGHT_BRIEF_ATTR}], [${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}], ` +
            `.theia-mobile-agent-transcript-artifacts, [${TRANSCRIPT_SEGMENT_INDEX_ATTR}]`,
        ).forEach(el => el.remove());
        // Remove any leftover trace status / live footer (re-added by the helper if streaming)
        segmentsBody.querySelector('.theia-mobile-agent-trace-status')?.remove();
        ctx.removeTranscriptLiveStatusWithOrb(segmentsBody);
        // Render the Codex-style timeline + closing narrative + diff summary.
        // Neither `error` nor the specific message are part of `options` here
        // (callers only have `conv`) — resolve the message `row` represents
        // (via its message-id attribute) so the same duplicate-error
        // suppression AND cancellation state that a fresh render would use
        // apply on this upgrade path too, instead of whichever agent message
        // happens to be last in the conversation.
        const message = ctx.resolveTranscriptRowAgentMessage(row, options.conv);
        ctx.renderMobileExecutionEventTimeline(segmentsBody, segments, {
            ...options,
            error: message?.error,
            message,
        });
}

export function resolveLobeVisibleTextSegmentIndexesExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segments: readonly QaapAgentMessageSegmentDTO[],
        activityTimelineShown: boolean,): ReadonlySet<number> {
        return resolveLobeVisibleTextSegmentIndexesHelper(segments, activityTimelineShown, content => ctx.isLobeWorkflowProcessText(content));
}

export function shouldRenderLobeTextSegmentExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segments: readonly QaapAgentMessageSegmentDTO[],
        segmentIndex: number,
        activityTimelineShown: boolean,): boolean {
        return ctx.resolveLobeVisibleTextSegmentIndexes(segments, activityTimelineShown).has(segmentIndex);
}

export function refreshMobileClosingNarrativeBlocksExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segmentsBody: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],): void {
        const lastToolIndex = segments.reduce(
            (last, segment, index) => segment.type === 'tool' ? index : last,
            -1,
        );
        for (let segmentIndex = lastToolIndex + 1; segmentIndex < segments.length; segmentIndex++) {
            const segment = segments[segmentIndex];
            if (segment.type !== 'text') {
                continue;
            }
            const text = segment.content?.trim() ?? '';
            if (!text) {
                continue;
            }
            if (ctx.isLobeWorkflowProcessText(segment.content)) {
                continue;
            }
            const host = segmentsBody.querySelector<HTMLElement>(
                `[${TRANSCRIPT_SEGMENT_INDEX_ATTR}="${segmentIndex}"]`,
            );
            // Closing error cards (see renderMobileExecutionEventTimeline) are
            // not markdown blocks — refreshing one here would clobber its
            // icon + message structure with the raw markdown renderer.
            if (host && !host.classList.contains(MOBILE_CLOSING_ERROR_CARD_CLASS)) {
                ctx.toolUi.renderTranscriptRichContent(host, segment.content ?? '', { streaming: false });
            }
        }
}

export function enrichChangedFilesWithComposerGitStatsExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, files: ReadonlyArray<{
            readonly path: string;
            readonly kind: 'edited' | 'created';
            readonly added?: number;
            readonly removed?: number;
        }>,): Array<{
        readonly path: string;
        readonly kind: 'edited' | 'created';
        readonly added?: number;
        readonly removed?: number;
    }> {
        const summaryId = ctx.host.transcriptComposerSummary?.id;
        const gitFiles = summaryId
            ? ctx.host.transcriptStickyComposerUi.peekComposerGitChangedFiles(summaryId)
            : undefined;
        return enrichChangedFilesWithComposerGitStatsHelper(files, gitFiles);
}

export function appendMobileDiffSummaryExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segmentsBody: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],): void {
        // Remove any existing diff summary or live footer so re-calling this is idempotent.
        segmentsBody.querySelector('.theia-mobile-diff-summary')?.remove();
        ctx.removeTranscriptLiveStatusWithOrb(segmentsBody);
        const mutableSegments = [...segments];
        const changedFiles = ctx.enrichChangedFilesWithComposerGitStats(
            ctx.resolversUi.resolveTranscriptChangedFiles(mutableSegments),
        );
        if (changedFiles.length > 0) {
            const diffSummary = createMobileDiffSummaryElement(
                changedFiles.length,
                changedFiles.filter(f => f.kind === 'created').length,
                changedFiles.filter(f => f.kind === 'edited').length,
                0,
                changedFiles.map(f => ({
                    name: f.path.split('/').pop() ?? f.path,
                    type: f.kind === 'created' ? 'add' : 'modify',
                    added: f.added,
                    removed: f.removed,
                })),
                () => {
                    const project = ctx.host.transcriptComposerProject;
                    const convSummary = ctx.host.transcriptComposerSummary;
                    if (project && convSummary) {
                        ctx.host.executionSurfaceTabsUi.selectTranscriptTab('review', project, convSummary);
                    }
                },
            );
            // Last child = below process accordion + closing narrative summary.
            segmentsBody.append(diffSummary);
        } else {
            // No per-file change set — fall back to aggregate line stats
            // (parsed from diff hunks embedded in tool output). Use the
            // line-level summary builder so we render "+N / -N" without
            // claiming a misleading file count.
            const diffStats = ctx.resolversUi.resolveTranscriptDiffStats(mutableSegments);
            if (diffStats && (diffStats.added > 0 || diffStats.removed > 0)) {
                const diffSummary = createMobileLineDiffSummaryElement(diffStats.added, diffStats.removed);
                segmentsBody.append(diffSummary);
            }
        }
}

export function finalizeStreamingAgentTraceExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, row: HTMLElement,
        segments: readonly QaapAgentMessageSegmentDTO[],
        conv: QaapAgentConversationDTO,): void {
        const segmentsBody = row.querySelector<HTMLElement>('.theia-mobile-agent-transcript-segments');
        if (!segmentsBody) {
            return;
        }
        // Codex-style execution event timeline: rebuild as a finalized (non-streaming) timeline.
        if (hasMobileExecutionEventTimeline(row)) {
            const hasTools = segments.some(s => s.type === 'tool');
            if (hasTools) {
                refreshMobileExecutionEventTimeline(segmentsBody, segments);
            }
            // Re-render closing narrative text blocks with final content as a
            // safety net — if the last streaming patch didn't apply (e.g. a
            // race between the final SSE frame and settle), the blocks could
            // have stale content. This ensures the final answer is complete.
            ctx.refreshMobileClosingNarrativeBlocks(segmentsBody, segments);
            // Mount Files Changed only once the backend has committed the final
            // response. Visual settle while status is still `streaming`/`settled`
            // must not show the card yet (agent still finalizing / VPS attached).
            if (ctx.shouldShowMobileDiffSummary(conv, false)) {
                ctx.appendMobileDiffSummary(segmentsBody, segments);
            } else {
                segmentsBody.querySelector('.theia-mobile-diff-summary')?.remove();
                ctx.removeTranscriptLiveStatusWithOrb(segmentsBody);
            }
            // Keep pinned status through finalize while the agent turn is still busy.
            if (ctx.shouldShowPinnedTranscriptLiveStatus(conv)) {
                ctx.ensurePinnedTranscriptLiveStatus(conv);
            } else {
                ctx.clearPinnedTranscriptStreamFooter(resolveTranscriptChatHostFromNode(segmentsBody));
            }
            // Sync the process accordion: collapse on success, stay open on error.
            ctx.syncRowProcessAccordion(row, segments, conv, false);
            row.classList.remove('theia-mod-stream-stalled');
            return;
        }
        // Upgrade path: if the row was never upgraded during streaming (e.g. it
        // was created during thinking and tools arrived but the streaming patch
        // didn't run), upgrade it now to the Codex-style timeline.
        if (segments.some(s => s.type === 'tool')) {
            ctx.upgradeToMobileExecutionEventTimeline(row, segments, { streaming: false, conv });
            row.classList.remove('theia-mod-stream-stalled');
            return;
        }
        const backendActive = ctx.isConversationWorking(conv, false);
        if (!shouldShowTranscriptThoughtBrief(segments, backendActive, {
            userPromptChars: resolveLastUserPromptChars(conv.messages),
            hasActivityStats: hasTranscriptActivityStats(resolveTranscriptActivityStats(segments)),
            thinkingContent: resolveTranscriptThinkingContent(segments),
        })) {
            segmentsBody.querySelector(`[${TRANSCRIPT_THOUGHT_BRIEF_ATTR}]`)?.remove();
        }
        const timeline = segmentsBody.querySelector<HTMLElement>(`[${TRANSCRIPT_ACTIVITY_TIMELINE_ATTR}]`);
        if (timeline) {
            timeline.removeAttribute('data-transcript-timeline-user-toggled');
            const items = buildTranscriptExecutionTimelineItems(ctx.resolveTranscriptActivityItemsForDisplay([...segments], { row, conv }));
            ctx.syncTranscriptActivityTimelineElement(timeline, items, {
                streaming: false,
                segments,
                expanded: false,
                conv,
                row,
            });
            segmentsBody.querySelectorAll('.theia-mobile-agent-tool-group, .theia-mobile-agent-tool-pill')
                .forEach(element => element.remove());
        }
        if (!timeline && !segmentsBody.querySelector('.theia-mobile-agent-tool-group, .theia-mobile-agent-tool-pill')) {
            const toolPills = ctx.createTranscriptToolPillsStrip([...segments], conv);
            if (toolPills) {
                let artifacts = segmentsBody.querySelector<HTMLElement>('.theia-mobile-agent-transcript-artifacts');
                if (!artifacts) {
                    artifacts = document.createElement('div');
                    artifacts.className = 'theia-mobile-agent-transcript-artifacts';
                    segmentsBody.append(artifacts);
                }
                artifacts.insertBefore(toolPills, artifacts.firstChild);
            }
        }
        row.classList.remove('theia-mod-stream-stalled');
}

export function handleTranscriptActivityNavigationExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, item: TranscriptActivityNavigationItem,
        ownerRow: HTMLElement,): void {
        if (item.navigate === 'file' && item.filePath) {
            ctx.toolUi.handleTranscriptFileOpen(item.filePath);
            return;
        }
        if (item.navigate === 'terminal') {
            const { project, summary } = ctx.resolveTranscriptActivityExecutionContext();
            if (project && summary) {
                ctx.host.executionSurfaceTabsUi.selectTranscriptTab('terminal', project, summary);
                return;
            }
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/transcriptOpenTerminalUnavailable', 'Terminal is unavailable for this session'),
                { kind: 'warning', duration: 2200 },
            );
            return;
        }
        if (item.navigate === 'thought') {
            const segmentIndex = item.segmentIndex;
            const thinkingDetails = ownerRow.querySelector<HTMLDetailsElement>(
                segmentIndex !== undefined
                    ? `.theia-mobile-agent-activity-thinking[data-transcript-thinking-segment="${segmentIndex}"]`
                    : '.theia-mobile-agent-activity-thinking',
            );
            if (thinkingDetails) {
                thinkingDetails.open = true;
                thinkingDetails.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                return;
            }
            const brief = ownerRow.querySelector('.theia-mobile-agent-thought-brief');
            if (brief instanceof HTMLDetailsElement) {
                brief.open = true;
                brief.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
}

export function resolveTranscriptActivityExecutionContextExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext): {
        project: MobileProjectEntry | undefined;
        summary: QaapAgentConversationSummaryDTO | undefined;
    } {
        let summary = ctx.host.transcriptOpenSummary ?? ctx.host.transcriptComposerSummary;
        let project = ctx.host.transcriptOpenProject ?? ctx.host.transcriptComposerProject;
        if (!summary && ctx.host.transcriptLastConv) {
            summary = conversationToSummary(ctx.host.transcriptLastConv);
        }
        if (!summary && ctx.host.transcriptOpenSummaryId) {
            summary = ctx.host.conversations?.findSummaryById(ctx.host.transcriptOpenSummaryId);
        }
        if (!project && summary) {
            const summaryCwd = summary.cwd?.trim().toLowerCase();
            project = ctx.host.projects.find(entry => {
                const projectCwd = ctx.host.projectsService.getProjectCwd(entry)?.trim().toLowerCase();
                return !!summaryCwd && !!projectCwd && projectCwd === summaryCwd;
            });
        }
        if (!project) {
            project = ctx.host.projects.find(entry => entry.isCurrent) ?? ctx.host.projects[0];
        }
        return { project, summary };
}

export function attachTranscriptActivityItemActionExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, li: HTMLElement,
        item: TranscriptActivityNavigationItem,
        _ownerRow: HTMLElement,): void {
        li.removeAttribute('data-transcript-activity-action');
        li.removeAttribute('data-transcript-activity-file-path');
        li.removeAttribute('data-transcript-activity-segment-index');
        li.classList.remove('theia-mod-clickable');
        if (!item.navigate || item.thinkingContent || item.navigate === 'thought') {
            li.removeAttribute('role');
            li.removeAttribute('tabindex');
            li.removeAttribute('aria-label');
            return;
        }
        li.classList.add('theia-mod-clickable');
        li.dataset.transcriptActivityAction = item.navigate;
        if (item.filePath) {
            li.dataset.transcriptActivityFilePath = item.filePath;
        }
        if (item.segmentIndex !== undefined) {
            li.dataset.transcriptActivitySegmentIndex = String(item.segmentIndex);
        }
        if (!li.hasAttribute('tabindex')) {
            li.tabIndex = 0;
        }
        li.setAttribute('role', 'button');
        const hint = item.navigate === 'file'
            ? nls.localize('qaap/mobileProjects/transcriptOpenFileInFiles', 'Open in Files preview')
            : item.navigate === 'terminal'
                ? nls.localize('qaap/mobileProjects/transcriptOpenTerminal', 'Open terminal')
                : nls.localize('qaap/mobileProjects/transcriptOpenThought', 'Show reasoning');
        li.setAttribute('aria-label', `${item.label}. ${hint}`);
}

export function bindTranscriptActivityListActionsExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, list: HTMLElement, ownerRow: HTMLElement): void {
        bindTranscriptActivityListActionsHelper(list, ownerRow, {
            handleTranscriptActivityNavigation: (item, row) => ctx.handleTranscriptActivityNavigation(item, row),
            handleTranscriptFileOpen: filePath => ctx.toolUi.handleTranscriptFileOpen(filePath),
        });
}


import type { MobileProjectsTranscriptMessagesArtifactsUiContext } from './mobile-projects-transcript-messages-artifacts-ui-context';
import { lazyTranscriptToolPillBodies,transcriptToolGroupItems,transcriptToolGroupUmbrella } from './mobile-projects-transcript-messages-artifacts-ui-constants';
// Extracted from mobile-projects-transcript-messages-artifacts-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { type QaapAgentConversationDTO, type QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import { conversationUsesInteractiveApprovals } from '../common/qaap-agent-interactive-approvals';
import { formatReadToolDetailFromArgs } from '../common/qaap-agent-conversation-list-metrics';
import { excerptTranscriptThought, extractTranscriptMcpServerLabel, hasTranscriptActivityStats, isTranscriptThoughtExcerptTruncated, isTranscriptTodoTool, parseTranscriptTodoChecklist, resolveTranscriptActivityStats, resolveTranscriptThinkingContent, resolveTranscriptToolPillDescriptors, resolveTranscriptToolRowParts, shouldOpenTranscriptToolDetails, type QaapTranscriptActivityStats } from '../common/qaap-agent-transcript-segments';
import { isTranscriptAgentThinkingPhase, resolveLastUserPromptChars, resolveTranscriptTurnElapsedMs, resolveTranscriptTurnStartMs, shouldShowTranscriptThoughtBrief } from '../common/qaap-transcript-stream-status';
import { isPendingTranscriptToolSegment } from '../common/qaap-transcript-approval-inline';
import { TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import { TRANSCRIPT_THOUGHT_BRIEF_ATTR } from '../common/qaap-transcript-incremental-update';
import {
    coalesceToolSegments,
    bundleToolSegmentsByUmbrella,
    summarizeToolBundle,
    type ToolUmbrella,
} from '../common/qaap-tool-umbrella';

export function patchTranscriptToolPillExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, pill: HTMLDetailsElement,
        previous: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        conv?: QaapAgentConversationDTO,): void {
        const manualApproval = !!conv && conversationUsesInteractiveApprovals(conv);
        const descriptors = resolveTranscriptToolPillDescriptors([segment], {
            resolvePath: args => ctx.resolversUi.extractTranscriptToolFullPath(args),
        });
        const descriptor = descriptors[0];
        if (!descriptor) {
            return;
        }
        const wasOpen = pill.open;
        const wasFailed = pill.classList.contains('theia-mod-failed');
        pill.className = `theia-mobile-agent-tool-pill theia-mod-${descriptor.kind}`;
        pill.classList.toggle('theia-mod-running', !descriptor.finished);
        pill.classList.toggle('theia-mod-done', descriptor.finished);
        pill.classList.toggle('theia-mod-failed', descriptor.resultFailed);
        const pendingApproval = manualApproval
            && isPendingTranscriptToolSegment(segment)
            && ctx.host.transcriptLiveUi.hasPendingTranscriptToolApproval(conv!.id, segment.toolUseId);
        pill.classList.toggle('theia-mod-awaiting-approval', pendingApproval);
        const rowParts = ctx.resolveToolRowParts(segment, descriptor.kind);
        const summary = pill.querySelector('summary');
        if (summary) {
            ctx.toolUi.syncTranscriptToolPillSummary(summary, {
                kind: descriptor.kind,
                verb: rowParts.verb,
                label: rowParts.detail,
                finished: descriptor.finished,
                failed: descriptor.resultFailed,
                startedAt: segment.startedAt,
                mcpServer: descriptor.kind === 'mcp'
                    ? extractTranscriptMcpServerLabel(segment.args)
                    : undefined,
                copyFrom: segment.result?.trim()
                    ? () => ctx.resolversUi.formatTranscriptToolResult(segment.result!)
                    : undefined,
            });
        }
        if (ctx.resolversUi.isTranscriptPureReadTool(segment.name)
            && !ctx.resolversUi.shouldShowTranscriptToolResultBody(segment, descriptor.kind)) {
            pill.querySelector('.theia-mobile-agent-tool-pill-body')?.remove();
            pill.open = wasOpen;
            return;
        }
        let body = pill.querySelector<HTMLElement>('.theia-mobile-agent-tool-pill-body');
        if (!body && lazyTranscriptToolPillBodies.has(pill)) {
            if (!pendingApproval
                && !descriptor.resultFailed
                && descriptor.finished
                && segment.result?.trim()
                && !pill.open) {
                lazyTranscriptToolPillBodies.set(pill, {
                    segment,
                    conv,
                    kind: descriptor.kind,
                    finished: descriptor.finished,
                    resultFailed: descriptor.resultFailed,
                });
                pill.open = wasOpen;
                return;
            }
            lazyTranscriptToolPillBodies.delete(pill);
        }
        if (!body) {
            body = document.createElement('div');
            body.className = 'theia-mobile-agent-tool-pill-body';
            pill.append(body);
        }
        const pendingApprovalChanged = pendingApproval !== !!body.querySelector(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`);
        if (!pendingApprovalChanged
            && ctx.toolUi.canPatchTranscriptToolResultStream(previous, segment)
            && ctx.toolUi.patchTranscriptToolResultStreamBody(body, segment)) {
            pill.open = wasOpen;
            return;
        }
        const speculativeOnly = !pendingApprovalChanged
            && !segment.result?.trim()
            && !segment.finished
            && previous.toolUseId === segment.toolUseId
            && previous.name === segment.name;
        if (speculativeOnly) {
            ctx.toolUi.ensureTranscriptToolSpeculativePlaceholder(body, segment);
            pill.open = wasOpen;
            return;
        }
        body.replaceChildren();
        if (pendingApproval) {
            body.append(ctx.createTranscriptToolApprovalActions(conv!.id, segment));
        }
        const todoChecklist = isTranscriptTodoTool(segment.name) && !!parseTranscriptTodoChecklist(segment.args);
        if (segment.result?.trim() || todoChecklist) {
            body.append(ctx.toolUi.createTranscriptToolResultBody(
                segment,
                descriptor.kind,
                { streaming: !descriptor.finished },
            ));
        } else if (!segment.finished) {
            ctx.toolUi.ensureTranscriptToolSpeculativePlaceholder(body, segment);
        }
        lazyTranscriptToolPillBodies.delete(pill);
        if (descriptor.resultFailed && !wasFailed) {
            pill.open = shouldOpenTranscriptToolDetails({
                finished: descriptor.finished,
                resultFailed: descriptor.resultFailed,
            });
        } else if (descriptor.kind === 'terminal' && !descriptor.finished) {
            pill.open = true;
        } else {
            pill.open = wasOpen;
        }
}

export function createTranscriptThoughtBriefIconExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, active: boolean): HTMLElement {
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-lobe-status-indicator theia-mod-thinking theia-mobile-agent-thought-brief-icon';
        icon.setAttribute('aria-hidden', 'true');
        const glyph = document.createElement('span');
        glyph.className = ctx.resolveTranscriptThoughtBriefIconClass(active);
        icon.append(glyph);
        return icon;
}

export function syncTranscriptThoughtBriefIconExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, icon: HTMLElement, active: boolean): void {
        const glyph = icon.querySelector('.codicon');
        if (!glyph) {
            return;
        }
        glyph.className = ctx.resolveTranscriptThoughtBriefIconClass(active);
}

export function createTranscriptThoughtBriefBlockExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segments: QaapAgentMessageSegmentDTO[],
        options?: { readonly streaming?: boolean; readonly conv?: QaapAgentConversationDTO },): HTMLElement | undefined {
        const thinking = resolveTranscriptThinkingContent(segments);
        const stats = resolveTranscriptActivityStats(segments);
        const hasStats = hasTranscriptActivityStats(stats);
        const streaming = !!options?.streaming;
        const turnStartMs = options?.conv ? resolveTranscriptTurnStartMs(options.conv.messages) : undefined;
        const backendActive = ctx.isConversationWorking(options?.conv, streaming);
        if (!shouldShowTranscriptThoughtBrief(segments, backendActive, {
            turnElapsedMs: resolveTranscriptTurnElapsedMs(turnStartMs),
            userPromptChars: options?.conv ? resolveLastUserPromptChars(options.conv.messages) : undefined,
            hasActivityStats: hasStats,
            thinkingContent: thinking,
        })) {
            return undefined;
        }
        const thinkingActive = isTranscriptAgentThinkingPhase(segments, backendActive);

        const block = document.createElement('details');
        block.className = 'theia-mobile-agent-thought-brief theia-mod-cursor-flat';
        block.setAttribute(TRANSCRIPT_THOUGHT_BRIEF_ATTR, 'true');
        if (thinkingActive) {
            block.classList.add('theia-mod-thinking-live');
        }
        block.open = thinkingActive || (backendActive && !!thinking);

        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-thought-brief-summary';
        // LobeHub Thinking StatusIndicator (src/features/Conversation/components/
        // Thinking/StatusIndicator.tsx): a 24x24 outlined Block chip with
        // Loader2Icon (spin) while thinking, AtomIcon when settled — purple when
        // expanded, colorTextDescription when collapsed. Reuses the existing
        // .theia-mobile-agent-lobe-status-indicator chip used by tool heads so the
        // visual language is unified. The QAAQ "finalizing" state (backend still
        // streaming but turn visually settled) keeps the spinning loader so the
        // user still sees activity, matching the prior unicode-snake spinner.
        const icon = ctx.createTranscriptThoughtBriefIcon(backendActive || thinkingActive);
        const title = document.createElement('span');
        title.className = 'theia-mobile-agent-thought-brief-title';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-thought-brief-chevron codicon codicon-chevron-down';
        chevron.setAttribute('aria-hidden', 'true');
        summary.append(icon, title, chevron);
        block.append(summary);

        if (thinking) {
            const bodyWrap = document.createElement('div');
            bodyWrap.className = 'theia-mobile-agent-thought-brief-body-wrap';
            const body = document.createElement('p');
            body.className = 'theia-mobile-agent-thought-brief-body';
            body.textContent = excerptTranscriptThought(thinking);
            bodyWrap.append(body);
            if (isTranscriptThoughtExcerptTruncated(thinking)) {
                const full = document.createElement('pre');
                full.className = 'theia-mobile-agent-thought-brief-more-body';
                full.textContent = ctx.contentUi.cleanTranscriptDisplayText(thinking);
                bodyWrap.append(full);
            }
            block.append(bodyWrap);
        }

        if (block instanceof HTMLDetailsElement && block.dataset.thoughtToggleBound !== '1') {
            block.dataset.thoughtToggleBound = '1';
            block.addEventListener('toggle', () => {
                if (block.open) {
                    block.dataset.thoughtUserExpanded = '1';
                } else {
                    block.removeAttribute('data-thought-user-expanded');
                }
            });
        }
        ctx.refreshTranscriptThoughtBriefTitle(title, block, {
            thinking,
            thinkingActive,
            streaming,
            turnStartMs,
            segments: [...segments],
        });
        return block;
}

export function createTranscriptToolPillsStripExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segments: QaapAgentMessageSegmentDTO[],
        conv?: QaapAgentConversationDTO,
        options?: { readonly deferHeavyContent?: boolean },): HTMLElement | undefined {
        const rawToolSegments = segments.filter((segment): segment is Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }> =>
            segment.type === 'tool',
        );
        const toolSegments = coalesceToolSegments(rawToolSegments);
        const descriptors = resolveTranscriptToolPillDescriptors(toolSegments, {
            resolvePath: args => ctx.resolversUi.extractTranscriptToolFullPath(args),
        });
        if (descriptors.length === 0) {
            return undefined;
        }
        const bundles = bundleToolSegmentsByUmbrella(toolSegments);
        const container = document.createElement('div');
        container.className = 'theia-mobile-agent-tool-pills-strip';
        for (const bundle of bundles) {
            const strip = document.createElement('div');
            strip.className = 'theia-mobile-agent-tool-pills';
            for (const segment of bundle.items) {
                strip.append(ctx.createTranscriptToolPill(segment, conv, options));
            }
            if (strip.childElementCount === 0) {
                continue;
            }
            const group = ctx.wrapTranscriptToolGroup(strip, bundle.umbrella, bundle.items);
            container.append(group);
        }
        if (container.childElementCount === 0) {
            return undefined;
        }
        return container;
}

export function wrapTranscriptToolGroupExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, strip: HTMLElement,
        umbrella?: ToolUmbrella,
        items?: ReadonlyArray<Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>>,): HTMLDetailsElement {
        const group = document.createElement('details');
        group.className = 'theia-mobile-agent-tool-group';
        if (umbrella) {
            group.classList.add(`theia-mod-${umbrella}`);
            group.dataset.umbrella = umbrella;
            transcriptToolGroupUmbrella.set(group, umbrella);
            if (items) {
                transcriptToolGroupItems.set(group, [...items]);
            }
        }
        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-tool-group-head';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-tool-group-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-tool-group-label';
        summary.append(chevron, label);
        group.append(summary, strip);
        if (umbrella && items) {
            label.textContent = summarizeToolBundle(umbrella, items);
        } else {
            ctx.refreshTranscriptToolGroupSummary(group);
        }
        if (group instanceof HTMLDetailsElement
            && group.querySelector('.theia-mobile-agent-tool-pill.theia-mod-running, .theia-mobile-agent-tool-pill.theia-mod-failed')) {
            group.open = true;
        }
        return group;
}

export function refreshTranscriptToolGroupSummaryExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, group: HTMLElement): void {
        const label = group.querySelector<HTMLElement>('.theia-mobile-agent-tool-group-label');
        if (!label) {
            return;
        }
        const umbrella = transcriptToolGroupUmbrella.get(group) ?? group.dataset.umbrella as ToolUmbrella | undefined;
        if (umbrella) {
            const items = transcriptToolGroupItems.get(group) ?? [];
            label.textContent = summarizeToolBundle(umbrella, items);
        } else {
            const pills = group.querySelectorAll('.theia-mobile-agent-tool-pill');
            let shells = 0;
            let fileReads = 0;
            let searches = 0;
            let edits = 0;
            let otherTools = 0;
            for (const pill of pills) {
                if (pill.classList.contains('theia-mod-terminal')) {
                    shells++;
                } else if (pill.classList.contains('theia-mod-reading')) {
                    fileReads++;
                } else if (pill.classList.contains('theia-mod-searching')) {
                    searches++;
                } else if (pill.classList.contains('theia-mod-editing')) {
                    edits++;
                } else {
                    otherTools++;
                }
            }
            label.textContent = ctx.formatTranscriptToolGroupLabel({ fileReads, searches, shells, edits, otherTools });
        }
        if (group instanceof HTMLDetailsElement
            && group.querySelector('.theia-mobile-agent-tool-pill.theia-mod-running, .theia-mobile-agent-tool-pill.theia-mod-failed')) {
            group.open = true;
        }
}

export function formatTranscriptToolGroupLabelExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, stats: QaapTranscriptActivityStats): string {
        const parts: string[] = [];
        if (stats.shells > 0) {
            parts.push(stats.shells === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneCommand', 'Ran 1 command')
                : nls.localize('qaap/mobileProjects/toolGroupCommands', 'Ran {0} commands', String(stats.shells)));
        }
        if (stats.edits > 0) {
            parts.push(stats.edits === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneEdit', 'edited 1 file')
                : nls.localize('qaap/mobileProjects/toolGroupEdits', 'edited {0} files', String(stats.edits)));
        }
        if (stats.fileReads > 0) {
            parts.push(stats.fileReads === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneRead', 'read 1 file')
                : nls.localize('qaap/mobileProjects/toolGroupReads', 'read {0} files', String(stats.fileReads)));
        }
        if (stats.searches > 0) {
            parts.push(stats.searches === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneSearch', 'searched once')
                : nls.localize('qaap/mobileProjects/toolGroupSearches', 'searched {0} times', String(stats.searches)));
        }
        if (stats.otherTools > 0) {
            parts.push(stats.otherTools === 1
                ? nls.localize('qaap/mobileProjects/toolGroupOneTool', 'used 1 tool')
                : nls.localize('qaap/mobileProjects/toolGroupTools', 'used {0} tools', String(stats.otherTools)));
        }
        const joined = parts.join(', ');
        return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export function resolveToolRowPartsExtracted(ctx: MobileProjectsTranscriptMessagesArtifactsUiContext, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        kind: string,): ReturnType<typeof resolveTranscriptToolRowParts> {
        if (ctx.resolversUi.isTranscriptPureReadTool(segment.name)) {
            const readDetail = formatReadToolDetailFromArgs(segment.args);
            if (readDetail) {
                return { verb: 'Read', detail: readDetail };
            }
        }
        return resolveTranscriptToolRowParts(kind, segment.name, {
            path: ctx.resolversUi.extractTranscriptToolFullPath(segment.args),
            command: ctx.resolversUi.extractTranscriptToolCommand(segment.args),
            argsJson: segment.args,
        });
}


// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

import { nls } from '@theia/core/lib/common/nls';
import {
    extractAgentAuthLoginChallenge,
    type QaapAgentAuthLoginChallenge,
} from '../common/qaap-agent-auth-login';
import { detectAgentFailureKind, formatStoredAgentFailureMessage } from '../common/qaap-agent-failure-message';
import { formatReadToolDetailFromArgs } from '../common/qaap-agent-conversation-list-metrics';
import { isTranscriptTodoTool, parseTranscriptTodoChecklist, shouldOpenTranscriptToolDetails as shouldOpenTranscriptToolDetailsSegment } from '../common/qaap-agent-transcript-segments';
import { isTranscriptErrorOutput, isTranscriptTerminalOutputText } from '../common/qaap-transcript-content-display';

import { createTranscriptCodeView, resolveTranscriptCodeLanguage } from './qaap-transcript-code-view';
import {
    registerDeferredTranscriptMarkdown,
    registerDeferredTranscriptToolBody,
    type TranscriptDeferredToolBodyHydrate,
} from './qaap-transcript-row-defer';
import type { QaapAgentMessageSegmentDTO } from '../common/qaap-agent-conversation-client';
import type { QaapTranscriptTodoItem } from '../common/qaap-agent-transcript-segments';
import type {
    TranscriptActivityEditExpandEntry,
    TranscriptActivityReadExpandEntry,
    TranscriptActivityTerminalExpandEntry,
} from '../common/qaap-transcript-activity-expand-core';
import type { TranscriptSearchMatch } from '../common/qaap-transcript-search-matches-core';
import type { TranscriptToolErrorDisplay } from '../common/qaap-transcript-tool-error-display';
import type { MobileProjectsTranscriptMessagesContentUi } from './mobile-projects-transcript-messages-content-ui';
import type { MobileProjectsTranscriptMessagesResolversUi } from './mobile-projects-transcript-messages-resolvers-ui';
import type { MobileProjectsTranscriptMessagesHost } from './mobile-projects-transcript-messages-ui';
import { TRANSCRIPT_APPROVAL_CARD_CLASS } from './qaap-transcript-approval-card-ui';
import { tryBuildTranscriptRichToolBody } from './qaap-transcript-rich-content-ui';
import {
    isTranscriptWebSearchTool,
    resolveTranscriptWebSearchPayload,
} from '../common/qaap-transcript-web-search-core';
import { createTranscriptWebSearchCard } from './qaap-transcript-web-search-ui';
import {
    createLobeToolTitle,
    createLobeTraceStatusIndicator,
    parseLobeToolTitleParamSummary,
    type LobeTraceStatus,
    type LobeToolTitleParam,
} from './mobile-projects-transcript-lobehub-ui';
import { sharedElapsedTicker } from './qaap-shared-elapsed-ticker';
import {
    transcriptToolIconClass as transcriptToolIconClassHelper,
    transcriptToolVerb as transcriptToolVerbHelper,
    transcriptShellStateAriaLabel as transcriptShellStateAriaLabelHelper,
    resolveLobeTraceStatus as resolveLobeTraceStatusHelper,
    parseTranscriptShellExitCode as parseTranscriptShellExitCodeHelper,
    isTranscriptActivityTerminalEntryFailed as isTranscriptActivityTerminalEntryFailedHelper,
    resolveTranscriptActivityTerminalDefaultOpenIndex as resolveTranscriptActivityTerminalDefaultOpenIndexHelper,
    transcriptFileIconClass as transcriptFileIconClassHelper,
} from './mobile-projects-transcript-messages-tool-helpers';
import { appendTranscriptShellSummaryTailExtracted, copyTranscriptShellTextExtracted, createTranscriptActivityReadExpandCardExtracted, createTranscriptActivityReadExpandPanelExtracted, createTranscriptActivityTerminalExpandCardExtracted, createTranscriptActivityTerminalExpandPanelExtracted, createTranscriptShellDetailsExtracted, flashTranscriptShellCopyTooltipExtracted, resolveTranscriptActivityTerminalDefaultOpenIndexExtracted } from './mobile-projects-transcript-messages-tool-ui-activity2';
import { createTranscriptAgentAuthLoginCardExtracted, createTranscriptAgentFailureDialogExtracted, createTranscriptClampedPreExtracted, createTranscriptSegmentDetailsExtracted, createTranscriptTextTerminalWindowExtracted, renderTranscriptRichContentExtracted } from './mobile-projects-transcript-messages-tool-ui-render2';
import { createTranscriptActivityErrorPanelExtracted, createTranscriptActivityTodoExpandPanelExtracted, createTranscriptClampedBlockExtracted, createTranscriptReadLineExtracted, createTranscriptTodoChecklistExtracted, createTranscriptTodoChecklistFromItemsExtracted, createTranscriptToolPillTerminalBodyExtracted, createTranscriptToolResultBodyExtracted, createTranscriptToolResultStreamBodyExtracted, createTranscriptToolSpeculativePlaceholderExtracted, createTranscriptToolWindowExtracted, ensureTranscriptToolSpeculativePlaceholderExtracted } from './mobile-projects-transcript-messages-tool-ui-streaming2';
import { appendTranscriptCardCopyTailExtracted, appendTranscriptToolPillSummaryTailExtracted, attachTranscriptFileOpenActionExtracted, attachTranscriptReviewFileOpenActionExtracted, canPatchTranscriptToolResultStreamExtracted, collectTranscriptShellBodyCopyTextExtracted, createTranscriptMcpBadgeExtracted, createTranscriptShellWindowHeadExtracted, createTranscriptToolHeadExtracted, createTranscriptToolPillSummaryExtracted, createTranscriptTraceStatusIndicatorExtracted, handleTranscriptFileOpenExtracted, handleTranscriptReviewFileOpenExtracted, patchTranscriptToolResultStreamBodyExtracted, resolveLobeToolTitleOptionsExtracted, resolveLobeTraceStatusExtracted, syncTranscriptToolPillSummaryExtracted } from './mobile-projects-transcript-messages-tool-ui-timeline2';
import { createTranscriptActivityEditExpandPanelExtracted, createTranscriptActivityEditExpandRowExtracted, createTranscriptActivityRunningBadgeExtracted, createTranscriptActivitySearchMatchesPanelExtracted } from './mobile-projects-transcript-messages-tool-ui-tool-pills2';

/** Sticky expand headers kick in once a grouped panel is long enough to scroll. */
export const TRANSCRIPT_EXPAND_STICKY_TERMINAL_MIN = 6;
export const TRANSCRIPT_EXPAND_STICKY_READ_MIN = 8;

export const TRANSCRIPT_TOOL_RESULT_STREAM_CLASS = 'theia-mobile-agent-tool-result-stream';
/** Placeholder body mounted before tool stdout/result arrives (speculative pill). */
export const TRANSCRIPT_TOOL_SPECULATIVE_CLASS = 'theia-mobile-agent-tool-pill-speculative';

/** LobeHub ExecutionTime format (Inspector/ExecutionTime.tsx):
 *  <1000ms -> "Xms"; <60s -> "X.Xs"; >=60s -> "XminYs". */
export function formatTranscriptExecutionTime(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }
    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    return `${minutes}min${remainingSeconds}s`;
}

/**
 * Mount / sync / unmount the LobeHub ExecutionTime chip inside a tool head.
 *
 * Mirrors `Inspector/ExecutionTime.tsx`: shows a live elapsed timer while the
 * tool is executing (100ms tick), disappears once finished. The chip is
 * inserted before `beforeEl` (the expand chevron) so it sits next to the title
 * row, matching LobeHub's `Flexbox` ordering (title, execTime, toggle).
 *
 * The interval self-cleans when the chip is removed from the DOM (e.g. on a
 * full re-render that discards the head), so no explicit teardown is needed at
 * the call sites — calling this again with `running=false` clears it too.
 */
export function syncTranscriptToolExecutionTime(
    parent: HTMLElement,
    beforeEl: HTMLElement | null,
    startedAt: number | undefined,
    running: boolean,
): void {
    let chip = parent.querySelector<HTMLElement>('.theia-mobile-agent-lobe-exec-time');
    if (!running || startedAt === undefined) {
        if (chip) {
            sharedElapsedTicker.unregister(chip);
            chip.remove();
        }
        return;
    }
    if (!chip) {
        chip = document.createElement('span');
        chip.className = 'theia-mobile-agent-lobe-exec-time';
        chip.setAttribute('aria-hidden', 'true');
        if (beforeEl && beforeEl.parentElement === parent) {
            beforeEl.before(chip);
        } else {
            parent.append(chip);
        }
    }
    // Re-register so a re-sync with a new startedAt re-bases the tick.
    sharedElapsedTicker.unregister(chip);
    sharedElapsedTicker.register({
        element: chip,
        render: now => {
            chip.textContent = `(${formatTranscriptExecutionTime(Math.max(0, now - startedAt))})`;
        },
    });
}

export class MobileProjectsTranscriptMessagesToolUi {
    constructor(
        protected readonly host: MobileProjectsTranscriptMessagesHost,
        protected readonly contentUi: MobileProjectsTranscriptMessagesContentUi,
        protected readonly resolversUi: MobileProjectsTranscriptMessagesResolversUi,
    ) { }

    renderTranscriptRichContent(host: HTMLElement, content: string, options?: { readonly streaming?: boolean; readonly defer?: boolean; readonly sync?: boolean },): void {
        renderTranscriptRichContentExtracted(this, host, content, options);
    }

    createTranscriptAgentFailureDialog(error: string, technicalContent?: string, options?: { readonly failedToolName?: string; readonly onRetry?: () => void | Promise<void>; readonly onOpenAuthUrl?: (url: string) => void; readonly onOpenAgentSignIn?: () => void | Promise<void>; readonly onOpenAiFeaturesSettings?: () => void | Promise<void>; readonly agentLabel?: string; readonly agentId?: string; readonly agentMessage?: Pick<import('../common/qaap-agent-conversation-client').QaapAgentMessageDTO, 'role' | 'content' | 'error' | 'segments' | 'traceEvents'>; },): HTMLElement {
        return createTranscriptAgentFailureDialogExtracted(this, error, technicalContent, options);
    }

    createTranscriptAgentAuthLoginCard(challenge: QaapAgentAuthLoginChallenge, options?: { readonly onOpenAuthUrl?: (url: string) => void; readonly onOpenAgentSignIn?: () => void | Promise<void>; readonly onOpenAiFeaturesSettings?: () => void | Promise<void>; readonly onRetry?: () => void | Promise<void>; readonly agentLabel?: string; readonly agentId?: string; },): HTMLElement {
        return createTranscriptAgentAuthLoginCardExtracted(this, challenge, options);
    }

    createTranscriptTextTerminalWindow(content: string): HTMLElement {
        return createTranscriptTextTerminalWindowExtracted(this, content);
    }

    createTranscriptSegmentDetails(segment: QaapAgentMessageSegmentDTO, options?: { readonly defer?: boolean; readonly streaming?: boolean },): HTMLElement {
        return createTranscriptSegmentDetailsExtracted(this, segment, options);
    }

    createTranscriptClampedPre(text: string, className: string): HTMLElement {
        return createTranscriptClampedPreExtracted(this, text, className);
    }

    createTranscriptClampedBlock(content: HTMLElement, lineCount: number, previewLines = 4): HTMLElement {
        return createTranscriptClampedBlockExtracted(this, content, lineCount, previewLines = 4);
    }

    createTranscriptReadLine(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): HTMLElement {
        return createTranscriptReadLineExtracted(this, segment);
    }

    createTranscriptToolWindow(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>, options?: { readonly defer?: boolean },): HTMLElement {
        return createTranscriptToolWindowExtracted(this, segment, options);
    }

    createTranscriptToolResultBody(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>, kind: string, options?: { readonly streaming?: boolean },): HTMLElement {
        return createTranscriptToolResultBodyExtracted(this, segment, kind, options);
    }

    createTranscriptTodoChecklist(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,): HTMLElement | undefined {
        return createTranscriptTodoChecklistExtracted(this, segment);
    }

    createTranscriptTodoChecklistFromItems(items: readonly QaapTranscriptTodoItem[], options?: { readonly premium?: boolean },): HTMLElement {
        return createTranscriptTodoChecklistFromItemsExtracted(this, items, options);
    }

    createTranscriptActivityTodoExpandPanel(items: readonly QaapTranscriptTodoItem[]): HTMLElement {
        return createTranscriptActivityTodoExpandPanelExtracted(this, items);
    }

    createTranscriptActivityErrorPanel(display: TranscriptToolErrorDisplay, options?: { readonly defaultOpen?: boolean; readonly onRetry?: () => void | Promise<void> },): HTMLDetailsElement {
        return createTranscriptActivityErrorPanelExtracted(this, display, options);
    }

    createTranscriptToolSpeculativePlaceholder(): HTMLElement {
        return createTranscriptToolSpeculativePlaceholderExtracted(this);
    }

    ensureTranscriptToolSpeculativePlaceholder(body: HTMLElement, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): void {
        ensureTranscriptToolSpeculativePlaceholderExtracted(this, body, segment);
    }

    createTranscriptToolResultStreamBody(text: string): HTMLElement {
        return createTranscriptToolResultStreamBodyExtracted(this, text);
    }

    createTranscriptToolPillTerminalBody(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>, options?: { readonly streaming?: boolean },): HTMLElement {
        return createTranscriptToolPillTerminalBodyExtracted(this, segment, options);
    }

    patchTranscriptToolResultStreamBody(pillBody: HTMLElement, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,): boolean {
        return patchTranscriptToolResultStreamBodyExtracted(this, pillBody, segment);
    }

    canPatchTranscriptToolResultStream(previous: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>, next: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,): boolean {
        return canPatchTranscriptToolResultStreamExtracted(this, previous, next);
    }

    handleTranscriptFileOpen(filePath: string): void {
        handleTranscriptFileOpenExtracted(this, filePath);
    }

    handleTranscriptReviewFileOpen(filePath: string): void {
        handleTranscriptReviewFileOpenExtracted(this, filePath);
    }

    attachTranscriptReviewFileOpenAction(row: HTMLElement, filePath: string): void {
        attachTranscriptReviewFileOpenActionExtracted(this, row, filePath);
    }

    attachTranscriptFileOpenAction(head: HTMLElement, filePath: string): void {
        attachTranscriptFileOpenActionExtracted(this, head, filePath);
    }

    createTranscriptToolHead(options: { args?: string; kind: string; toolName: string; fullPath?: string; target?: string; hasResult: boolean; showResultBody: boolean; pureRead: boolean; result?: string; finished: boolean; failed: boolean; }): HTMLElement {
        return createTranscriptToolHeadExtracted(this, options);
    }

    /** Codicon for a tool window header, by resolved tool kind. */

    transcriptToolIconClass(kind: string): string {
        return transcriptToolIconClassHelper(kind);
    }

    /** Human verb for a finished/running tool, e.g. "Read", "Edited", "Searched". */

    transcriptToolVerb(kind: string, toolName: string): string {
        return transcriptToolVerbHelper(kind, toolName);
    }

    transcriptShellStateAriaLabel(finished: boolean, failed: boolean): string {
        return transcriptShellStateAriaLabelHelper(finished, failed);
    }

    createTranscriptTraceStatusIndicator(options: { finished: boolean; failed: boolean; kind?: string; }): HTMLElement {
        return createTranscriptTraceStatusIndicatorExtracted(this, options);
    }

    protected resolveLobeTraceStatus(options: { readonly finished: boolean; readonly failed: boolean; }): LobeTraceStatus {
        return resolveLobeTraceStatusExtracted(this, options);
    }

    protected resolveLobeToolTitleOptions(options: { readonly args?: string; readonly finished: boolean; readonly fullPath?: string; readonly kind: string; readonly target?: string; readonly toolName: string; }): Parameters<typeof createLobeToolTitle>[0] {
        return resolveLobeToolTitleOptionsExtracted(this, options);
    }

    collectTranscriptShellBodyCopyText(body: HTMLElement): string {
        return collectTranscriptShellBodyCopyTextExtracted(this, body);
    }

    createTranscriptToolPillSummary(options: { kind: string; verb: string; label: string; finished: boolean; failed: boolean; copyFrom?: () => string; mcpServer?: string; startedAt?: number; }): HTMLElement {
        return createTranscriptToolPillSummaryExtracted(this, options);
    }

    createTranscriptMcpBadge(server?: string): HTMLElement {
        return createTranscriptMcpBadgeExtracted(this, server);
    }

    syncTranscriptToolPillSummary(summary: HTMLElement, options: { kind?: string; verb: string; label: string; finished: boolean; failed: boolean; copyFrom?: () => string; mcpServer?: string; startedAt?: number; },): void {
        syncTranscriptToolPillSummaryExtracted(this, summary, options);
    }

    appendTranscriptToolPillSummaryTail(summary: HTMLElement, options: { finished: boolean; failed: boolean; copyFrom?: () => string },): void {
        appendTranscriptToolPillSummaryTailExtracted(this, summary, options);
    }

    appendTranscriptCardCopyTail(summary: HTMLElement, copyFrom: () => string): void {
        appendTranscriptCardCopyTailExtracted(this, summary, copyFrom);
    }

    createTranscriptShellWindowHead(options: { title: string; finished: boolean; failed: boolean; exitCode?: number; copyFrom?: () => string; startedAt?: number; }): HTMLElement {
        return createTranscriptShellWindowHeadExtracted(this, options);
    }

    parseTranscriptShellExitCode(result: string | undefined): number | undefined {
        return parseTranscriptShellExitCodeHelper(result);
    }

    appendTranscriptShellSummaryTail(summary: HTMLElement, options: { finished: boolean; failed: boolean; copyFrom?: () => string; copyLabel?: string; showState?: boolean },): void {
        appendTranscriptShellSummaryTailExtracted(this, summary, options);
    }

    async copyTranscriptShellText(text: string, copyBtn: HTMLButtonElement, tip: HTMLElement, copyLabel: string,): Promise<void> {
        return copyTranscriptShellTextExtracted(this, text, copyBtn, tip, copyLabel);
    }

    flashTranscriptShellCopyTooltip(copyBtn: HTMLButtonElement, tip: HTMLElement, message: string, copyLabel: string, failed: boolean,): void {
        flashTranscriptShellCopyTooltipExtracted(this, copyBtn, tip, message, copyLabel, failed);
    }

    createTranscriptShellDetails(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): HTMLElement {
        return createTranscriptShellDetailsExtracted(this, segment);
    }

    createTranscriptActivityTerminalExpandPanel(entries: readonly TranscriptActivityTerminalExpandEntry[], options?: { readonly single?: boolean },): HTMLElement {
        return createTranscriptActivityTerminalExpandPanelExtracted(this, entries, options);
    }

    protected isTranscriptActivityTerminalEntryFailed(entry: TranscriptActivityTerminalExpandEntry): boolean {
        return isTranscriptActivityTerminalEntryFailedHelper(entry);
    }

    protected resolveTranscriptActivityTerminalDefaultOpenIndex(entries: readonly TranscriptActivityTerminalExpandEntry[],): number {
        return resolveTranscriptActivityTerminalDefaultOpenIndexExtracted(this, entries);
    }

    createTranscriptActivityTerminalExpandCard(entry: TranscriptActivityTerminalExpandEntry, options?: { readonly index?: number; readonly total?: number; readonly defaultOpen?: boolean },): HTMLElement {
        return createTranscriptActivityTerminalExpandCardExtracted(this, entry, options);
    }

    createTranscriptActivityReadExpandPanel(entries: readonly TranscriptActivityReadExpandEntry[], options?: { readonly single?: boolean },): HTMLElement {
        return createTranscriptActivityReadExpandPanelExtracted(this, entries, options);
    }

    createTranscriptActivityReadExpandCard(entry: TranscriptActivityReadExpandEntry, options?: { readonly index?: number; readonly total?: number; readonly defaultOpen?: boolean },): HTMLElement {
        return createTranscriptActivityReadExpandCardExtracted(this, entry, options);
    }

    createTranscriptActivityEditExpandPanel(entries: readonly TranscriptActivityEditExpandEntry[], options?: { readonly single?: boolean },): HTMLElement {
        return createTranscriptActivityEditExpandPanelExtracted(this, entries, options);
    }

    createTranscriptActivityEditExpandRow(entry: TranscriptActivityEditExpandEntry): HTMLElement {
        return createTranscriptActivityEditExpandRowExtracted(this, entry);
    }

    createTranscriptActivityRunningBadge(): HTMLElement {
        return createTranscriptActivityRunningBadgeExtracted(this);
    }

    createTranscriptActivitySearchMatchesPanel(matches: readonly TranscriptSearchMatch[]): HTMLElement {
        return createTranscriptActivitySearchMatchesPanelExtracted(this, matches);
    }

    protected transcriptFileIconClass(path: string): string {
        return transcriptFileIconClassHelper(path);
    }
}

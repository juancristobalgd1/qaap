// @ts-nocheck
// Extracted from mobile-projects-transcript-messages-tool-ui.ts

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
import { syncTranscriptToolExecutionTime } from './mobile-projects-transcript-messages-tool-ui';
import { peekPreferDesktopIde } from './mobile-projects-open';

export function patchTranscriptToolResultStreamBodyExtracted(ctx: any, pillBody: HTMLElement,
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,): boolean {
        const streamHost = pillBody.querySelector<HTMLElement>(`.${TRANSCRIPT_TOOL_RESULT_STREAM_CLASS}`);
        if (!streamHost) {
            return false;
        }
        streamHost.textContent = ctx.resolversUi.formatTranscriptToolResult(segment.result!);
        return true;
}

export function canPatchTranscriptToolResultStreamExtracted(ctx: any, previous: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        next: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,): boolean {
        if (next.finished || previous.finished) {
            return false;
        }
        if (previous.toolUseId !== next.toolUseId || previous.name !== next.name) {
            return false;
        }
        const previousArgs = previous.args ?? '';
        const incomingArgs = next.args ?? '';
        if (incomingArgs !== previousArgs) {
            return false;
        }
        const previousResult = previous.result ?? '';
        const incomingResult = next.result ?? '';
        return incomingResult === previousResult
            || (incomingResult.startsWith(previousResult) && incomingResult.length >= previousResult.length);
}

export function handleTranscriptFileOpenExtracted(ctx: any, filePath: string): void {
        if (!ctx.host.openTranscriptFile) {
            return;
        }
        void Promise.resolve(ctx.host.openTranscriptFile(filePath)).catch(error => {
            console.warn('[qaap-mobile-shell] Failed to open transcript file:', error);
            ctx.host.messageService?.error(
                nls.localize('qaap/mobileProjects/transcriptOpenFileFailed', 'Could not open {0}', filePath),
            );
        });
}

export function handleTranscriptReviewFileOpenExtracted(ctx: any, filePath: string): void {
        if (!ctx.host.openTranscriptReviewFile) {
            return;
        }
        void Promise.resolve(ctx.host.openTranscriptReviewFile(filePath)).catch(error => {
            console.warn('[qaap-mobile-shell] Failed to open transcript review file:', error);
            ctx.host.messageService?.error(
                peekPreferDesktopIde()
                    ? nls.localize('qaap/mobileProjects/transcriptOpenIdeChangeFailed', 'Could not open the change for {0} in the IDE', filePath)
                    : nls.localize('qaap/mobileProjects/transcriptOpenReviewFileFailed', 'Could not open {0} in Review', filePath),
            );
        });
}

export function attachTranscriptReviewFileOpenActionExtracted(ctx: any, row: HTMLElement, filePath: string): void {
        if (!ctx.host.openTranscriptReviewFile) {
            return;
        }
        row.classList.add('theia-mod-clickable');
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.title = peekPreferDesktopIde()
            ? nls.localize('qaap/mobileProjects/transcriptOpenFileInIdeDiff', 'Open change in IDE')
            : nls.localize('qaap/mobileProjects/transcriptOpenFileInReview', 'Open in Review');
        const open = (event: Event): void => {
            event.stopPropagation();
            event.preventDefault();
            ctx.handleTranscriptReviewFileOpen(filePath);
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', event => {
            if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
                open(event);
            }
        });
}

export function attachTranscriptFileOpenActionExtracted(ctx: any, head: HTMLElement, filePath: string): void {
        if (!ctx.host.openTranscriptFile) {
            return;
        }
        head.classList.add('theia-mod-clickable');
        head.title = peekPreferDesktopIde()
            ? nls.localize('qaap/mobileProjects/transcriptOpenFileInEditor', 'Open in editor')
            : nls.localize('qaap/mobileProjects/transcriptOpenFileInFiles', 'Open in Files preview');
        head.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault();
            ctx.handleTranscriptFileOpen(filePath);
        });
}

export function createTranscriptToolHeadExtracted(ctx: any, options: {
        args?: string;
        kind: string;
        toolName: string;
        fullPath?: string;
        target?: string;
        hasResult: boolean;
        showResultBody: boolean;
        pureRead: boolean;
        result?: string;
        finished: boolean;
        failed: boolean;
    }): HTMLElement {
        const head = document.createElement(options.showResultBody ? 'summary' : 'div');
        head.className = 'theia-mobile-agent-tool-head theia-mobile-agent-lobe-inspector';
        head.append(ctx.createTranscriptTraceStatusIndicator({
            finished: options.finished,
            failed: options.failed,
            kind: options.kind,
        }));
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-tool-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        if (!options.showResultBody) {
            chevron.hidden = true;
        }
        head.append(createLobeToolTitle(ctx.resolveLobeToolTitleOptions(options)));
        if (options.fullPath && options.kind === 'reading') {
            const { fileName, dirPath } = ctx.resolversUi.splitTranscriptFilePath(options.fullPath);
            const fileNameEl = document.createElement('span');
            fileNameEl.className = 'theia-mobile-agent-tool-file-name theia-mobile-agent-lobe-tool-api';
            fileNameEl.textContent = fileName;
            fileNameEl.hidden = true;
            head.append(fileNameEl);
            if (dirPath) {
                const dirEl = document.createElement('span');
                dirEl.className = 'theia-mobile-agent-tool-file-dir theia-mobile-agent-lobe-tool-param';
                dirEl.textContent = dirPath;
                dirEl.hidden = true;
                head.append(dirEl);
            }
            if (!options.showResultBody) {
                ctx.attachTranscriptFileOpenAction(head, options.fullPath);
            }
        } else if (options.target) {
            const chip = document.createElement('span');
            chip.className = 'theia-mobile-agent-tool-target theia-mobile-agent-lobe-tool-api';
            chip.textContent = options.target;
            chip.hidden = true;
            head.append(chip);
        }
        if (options.hasResult && options.pureRead && options.result) {
            const lineCount = ctx.resolversUi.countTranscriptResultLines(options.result);
            if (lineCount > 0) {
                const badge = document.createElement('span');
                badge.className = 'theia-mobile-agent-tool-badge';
                badge.textContent = lineCount === 1
                    ? nls.localize('qaap/mobileProjects/transcriptToolLineCountOne', '1 line')
                    : nls.localize('qaap/mobileProjects/transcriptToolLineCount', '{0} lines', String(lineCount));
                head.append(badge);
            }
        } else if (options.hasResult && options.kind === 'searching' && options.result) {
            const matchLines = ctx.resolversUi.countTranscriptResultLines(options.result);
            if (matchLines > 0) {
                const badge = document.createElement('span');
                badge.className = 'theia-mobile-agent-tool-badge theia-mod-muted';
                badge.textContent = matchLines === 1
                    ? nls.localize('qaap/mobileProjects/transcriptToolMatchCountOne', '1 match')
                    : nls.localize('qaap/mobileProjects/transcriptToolMatchCount', '{0} matches', String(matchLines));
                head.append(badge);
            }
        }
        ctx.appendTranscriptShellSummaryTail(head, {
            finished: options.finished,
            failed: options.failed,
            copyFrom: options.hasResult && options.result
                ? () => ctx.resolversUi.formatTranscriptToolResult(options.result!)
                : undefined,
            showState: false,
        });
        head.append(chevron);
        return head;
}

export function createTranscriptTraceStatusIndicatorExtracted(ctx: any, options: {
        finished: boolean;
        failed: boolean;
        kind?: string;
    }): HTMLElement {
        return createLobeTraceStatusIndicator(ctx.resolveLobeTraceStatus(options), options.kind);
}

export function resolveLobeTraceStatusExtracted(ctx: any, options: {
        readonly finished: boolean;
        readonly failed: boolean;
    }): LobeTraceStatus {
        return resolveLobeTraceStatusHelper(options);
}

export function resolveLobeToolTitleOptionsExtracted(ctx: any, options: {
        readonly args?: string;
        readonly finished: boolean;
        readonly fullPath?: string;
        readonly kind: string;
        readonly target?: string;
        readonly toolName: string;
    }): Parameters<typeof createLobeToolTitle>[0] {
        const pluginTitle = ctx.transcriptToolVerb(options.kind, options.toolName);
        let apiName = options.target || options.toolName;
        const parsedParams = parseLobeToolTitleParamSummary(options.args);
        let params: readonly LobeToolTitleParam[] = parsedParams.params;
        let remainingParamsCount = parsedParams.remainingParamsCount;
        if (options.fullPath && options.kind === 'reading') {
            const { fileName, dirPath } = ctx.resolversUi.splitTranscriptFilePath(options.fullPath);
            apiName = fileName;
            params = dirPath ? [{ key: 'path', value: dirPath }] : params;
            remainingParamsCount = 0;
        }
        return {
            apiName,
            loading: !options.finished,
            params,
            pluginTitle,
            remainingParamsCount,
        };
}

export function collectTranscriptShellBodyCopyTextExtracted(ctx: any, body: HTMLElement): string {
        const parts: string[] = [];
        const command = body.querySelector('.theia-mobile-agent-shell-command code')?.textContent?.trim();
        if (command) {
            parts.push(`$ ${command}`);
        }
        const output = body.querySelector('.theia-mobile-agent-shell-output')?.textContent;
        if (output?.trim()) {
            if (parts.length) {
                parts.push('');
            }
            parts.push(output.trimEnd());
        }
        if (parts.length) {
            return parts.join('\n');
        }
        return body.textContent?.trim() ?? '';
}

export function createTranscriptToolPillSummaryExtracted(ctx: any, options: {
        kind: string;
        verb: string;
        label: string;
        finished: boolean;
        failed: boolean;
        copyFrom?: () => string;
        mcpServer?: string;
        startedAt?: number;
    }): HTMLElement {
        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-tool-pill-summary theia-mobile-agent-lobe-inspector';
        summary.append(ctx.createTranscriptTraceStatusIndicator({
            finished: options.finished,
            failed: options.failed,
            kind: options.kind,
        }));
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-tool-pill-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        summary.append(createLobeToolTitle({
            apiName: options.label,
            loading: !options.finished,
            pluginTitle: options.verb,
        }));
        if (options.kind === 'mcp') {
            summary.append(ctx.createTranscriptMcpBadge(options.mcpServer));
        }
        ctx.appendTranscriptToolPillSummaryTail(summary, {
            finished: options.finished,
            failed: options.failed,
            copyFrom: options.copyFrom,
        });
        // LobeHub ExecutionTime: live elapsed chip while the tool is running,
        // inserted before the chevron so it sits next to the title row.
        syncTranscriptToolExecutionTime(summary, chevron, options.startedAt, !options.finished);
        summary.append(chevron);
        return summary;
}


export function createTranscriptMcpBadgeExtracted(ctx: any, server?: string): HTMLElement {
        const badge = document.createElement('span');
        badge.className = 'theia-mobile-agent-tool-pill-badge theia-mod-mcp';
        badge.textContent = server ? `MCP · ${server}` : 'MCP';
        if (server) {
            badge.setAttribute('title', server);
        }
        badge.setAttribute('aria-label', nls.localize('qaap/mobileProjects/transcriptMcpBadge', 'MCP tool'));
        return badge;
}

export function syncTranscriptToolPillSummaryExtracted(ctx: any, summary: HTMLElement,
        options: {
            kind?: string;
            verb: string;
            label: string;
            finished: boolean;
            failed: boolean;
            copyFrom?: () => string;
            mcpServer?: string;
            startedAt?: number;
        },): void {
        summary.querySelector('.theia-mobile-agent-shell-tail')?.remove();
        const status = summary.querySelector<HTMLElement>('.theia-mobile-agent-lobe-status-indicator');
        if (status) {
            status.replaceWith(ctx.createTranscriptTraceStatusIndicator({
                finished: options.finished,
                failed: options.failed,
                kind: options.kind,
            }));
        }
        const title = summary.querySelector<HTMLElement>('.theia-mobile-agent-lobe-tool-title-root');
        if (title) {
            title.replaceWith(createLobeToolTitle({
                apiName: options.label,
                loading: !options.finished,
                pluginTitle: options.verb,
            }));
        }
        summary.querySelector('.theia-mobile-agent-tool-pill-badge.theia-mod-mcp')?.remove();
        if (options.kind === 'mcp') {
            const titleRoot = summary.querySelector('.theia-mobile-agent-lobe-tool-title-root');
            titleRoot?.after(ctx.createTranscriptMcpBadge(options.mcpServer));
        }
        ctx.appendTranscriptToolPillSummaryTail(summary, {
            finished: options.finished,
            failed: options.failed,
            copyFrom: options.copyFrom,
        });
        const chevron = summary.querySelector<HTMLElement>('.theia-mobile-agent-tool-pill-chevron');
        // LobeHub ExecutionTime: keep the live chip in sync with the running
        // state. Cleared automatically once the tool finishes.
        syncTranscriptToolExecutionTime(summary, chevron, options.startedAt, !options.finished);
        if (chevron) {
            summary.append(chevron);
        }
}

export function appendTranscriptToolPillSummaryTailExtracted(ctx: any, summary: HTMLElement,
        options: { finished: boolean; failed: boolean; copyFrom?: () => string },): void {
        ctx.appendTranscriptShellSummaryTail(summary, { ...options, showState: false });
}

export function appendTranscriptCardCopyTailExtracted(ctx: any, summary: HTMLElement, copyFrom: () => string): void {
        ctx.appendTranscriptShellSummaryTail(summary, {
            finished: true,
            failed: false,
            showState: false,
            copyFrom,
        });
}

export function createTranscriptShellWindowHeadExtracted(ctx: any, options: {
        title: string;
        finished: boolean;
        failed: boolean;
        exitCode?: number;
        copyFrom?: () => string;
        startedAt?: number;
    }): HTMLElement {
        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-shell-head theia-mobile-agent-lobe-inspector';
        summary.append(ctx.createTranscriptTraceStatusIndicator({
            finished: options.finished,
            failed: options.failed,
            kind: 'terminal',
        }));
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-shell-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        summary.append(createLobeToolTitle({
            apiName: options.title,
            loading: !options.finished,
            pluginTitle: nls.localize('qaap/mobileProjects/transcriptToolRan', 'Ran'),
        }));
        if (options.exitCode !== undefined && options.finished) {
            const exitCode = document.createElement('span');
            exitCode.className = 'theia-mobile-agent-shell-exit-code';
            exitCode.classList.toggle('theia-mod-failed', options.exitCode !== 0);
            exitCode.textContent = String(options.exitCode);
            exitCode.setAttribute('aria-label', nls.localize(
                'qaap/mobileProjects/transcriptShellExitCode',
                'Exit code {0}',
                String(options.exitCode),
            ));
            summary.append(exitCode);
        }
        ctx.appendTranscriptShellSummaryTail(summary, {
            finished: options.finished,
            failed: options.failed,
            copyFrom: options.copyFrom,
            showState: false,
        });
        // LobeHub ExecutionTime: live elapsed chip while the command is running.
        syncTranscriptToolExecutionTime(summary, chevron, options.startedAt, !options.finished);
        summary.append(chevron);
        return summary;
}

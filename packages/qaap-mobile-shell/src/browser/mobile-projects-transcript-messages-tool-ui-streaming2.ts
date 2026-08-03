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

export function createTranscriptClampedBlockExtracted(ctx: any, content: HTMLElement, lineCount: number, previewLines = 4): HTMLElement {
        if (lineCount <= previewLines) {
            return content;
        }
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-agent-clamp';
        wrap.style.setProperty('--qaap-clamp-lines', String(previewLines));
        wrap.append(content);
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'theia-mobile-agent-clamp-toggle';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-clamp-chevron codicon codicon-chevron-down';
        chevron.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        const hiddenLines = lineCount - previewLines;
        const syncToggle = () => {
            const expanded = wrap.classList.contains('theia-mod-expanded');
            label.textContent = expanded
                ? nls.localize('qaap/mobileProjects/transcriptShowLess', 'Show less')
                : nls.localize('qaap/mobileProjects/transcriptShowMoreLines', 'Show {0} more lines', String(hiddenLines));
            chevron.classList.toggle('codicon-chevron-down', !expanded);
            chevron.classList.toggle('codicon-chevron-up', expanded);
            toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        };
        syncToggle();
        toggle.append(chevron, label);
        toggle.addEventListener('click', () => {
            wrap.classList.toggle('theia-mod-expanded');
            syncToggle();
        });
        wrap.append(toggle);
        return wrap;
}

export function createTranscriptReadLineExtracted(ctx: any, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): HTMLElement {
        const fullPath = ctx.resolversUi.extractTranscriptToolFullPath(segment.args);
        const line = document.createElement('div');
        const failed = ctx.resolversUi.transcriptToolResultFailed(segment.result, segment.name);
        line.className = `theia-mobile-agent-read-line theia-mobile-agent-lobe-inline-step ${!segment.finished ? 'theia-mod-running' : failed ? 'theia-mod-failed' : 'theia-mod-done'}`;
        if (!segment.finished) {
            line.classList.add('theia-mod-running');
        }
        line.append(ctx.createTranscriptTraceStatusIndicator({
            finished: segment.finished,
            failed,
            kind: 'reading',
        }));
        const verb = document.createElement('span');
        verb.className = 'theia-mobile-agent-read-line-verb';
        verb.textContent = nls.localize('qaap/mobileProjects/transcriptToolRead', 'Read');
        const detail = document.createElement('span');
        detail.className = 'theia-mobile-agent-read-line-detail';
        detail.textContent = formatReadToolDetailFromArgs(segment.args)
            ?? (fullPath ? ctx.resolversUi.splitTranscriptFilePath(fullPath).fileName : '');
        line.append(verb, document.createTextNode(' '), detail);
        if (fullPath) {
            ctx.attachTranscriptFileOpenAction(line, fullPath);
        }
        return line;
}

export function createTranscriptToolWindowExtracted(ctx: any, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        options?: { readonly defer?: boolean },): HTMLElement {
        const kind = ctx.resolversUi.resolveTranscriptToolKind(segment.name);
        const fullPath = ctx.resolversUi.extractTranscriptToolFullPath(segment.args);
        const target = fullPath ? ctx.resolversUi.compactTranscriptPath(fullPath)
            : ctx.resolversUi.extractTranscriptToolShortArg(segment.args);
        const hasResult = !!segment.result?.trim();
        const showResultBody = ctx.resolversUi.shouldShowTranscriptToolResultBody(segment, kind);
        const pureRead = ctx.resolversUi.isTranscriptPureReadTool(segment.name);

        if (pureRead && !showResultBody) {
            return ctx.createTranscriptReadLine(segment);
        }

        const failed = ctx.resolversUi.transcriptToolResultFailed(segment.result, segment.name);
        const head = ctx.createTranscriptToolHead({
            args: segment.args,
            kind,
            toolName: segment.name,
            fullPath,
            target,
            hasResult,
            showResultBody,
            pureRead,
            result: segment.result,
            finished: segment.finished,
            failed,
        });

        const details = document.createElement('details');
        details.className = `theia-mobile-agent-tool-window theia-mobile-agent-lobe-trace-block theia-mod-${kind}`;
        const shouldOpen = ctx.resolversUi.shouldOpenTranscriptToolDetails(segment);
        details.open = shouldOpen;
        details.classList.add(!segment.finished ? 'theia-mod-running' : failed ? 'theia-mod-failed' : 'theia-mod-done');
        details.append(head);
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-tool-body';
        const deferBody = !!options?.defer && showResultBody && !shouldOpen;
        if (deferBody) {
            body.classList.add('theia-mod-deferred-tool-body');
            const hydrate: TranscriptDeferredToolBodyHydrate = {
                body,
                segment,
                kind,
            };
            registerDeferredTranscriptToolBody(hydrate);
        } else {
            body.append(ctx.createTranscriptToolResultBody(segment, kind));
        }
        details.append(body);
        return details;
}

export function createTranscriptToolResultBodyExtracted(ctx: any, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        kind: string,
        options?: { readonly streaming?: boolean },): HTMLElement {
        if (isTranscriptWebSearchTool(segment.name)) {
            const payload = resolveTranscriptWebSearchPayload(segment);
            return createTranscriptWebSearchCard(payload, {
                open: !segment.finished || payload.sites.length > 0,
            });
        }
        if (isTranscriptTodoTool(segment.name)) {
            const checklist = ctx.createTranscriptTodoChecklist(segment);
            if (checklist) {
                return checklist;
            }
        }
        if (kind === 'terminal' || ctx.resolversUi.isTranscriptShellTool(segment.name)) {
            return ctx.createTranscriptToolPillTerminalBody(segment, options);
        }
        const text = ctx.resolversUi.formatTranscriptToolResult(segment.result!);
        if (options?.streaming && !segment.finished) {
            return ctx.createTranscriptToolResultStreamBody(text);
        }
        const richBody = tryBuildTranscriptRichToolBody(text, segment.name, segment.args);
        if (richBody) {
            return richBody;
        }
        const fullPath = ctx.resolversUi.extractTranscriptToolFullPath(segment.args);
        const language = resolveTranscriptCodeLanguage(fullPath, text);
        const view = createTranscriptCodeView(text, language);
        return ctx.createTranscriptClampedBlock(view, text.split('\n').length);
}

export function createTranscriptTodoChecklistExtracted(ctx: any, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,): HTMLElement | undefined {
        const items = parseTranscriptTodoChecklist(segment.args);
        if (!items) {
            return undefined;
        }
        return ctx.createTranscriptTodoChecklistFromItems(items);
}

export function createTranscriptTodoChecklistFromItemsExtracted(ctx: any, items: readonly QaapTranscriptTodoItem[],
        options?: { readonly premium?: boolean },): HTMLElement {
        const list = document.createElement('ul');
        list.className = options?.premium
            ? 'theia-mobile-agent-todo-checklist theia-mod-premium'
            : 'theia-mobile-agent-todo-checklist';
        for (const item of items) {
            const row = document.createElement('li');
            row.className = `theia-mobile-agent-todo-item theia-mod-${item.status.replace('_', '-')}`;
            const marker = document.createElement('span');
            marker.className = 'theia-mobile-agent-todo-marker';
            marker.setAttribute('aria-hidden', 'true');
            if (options?.premium) {
                marker.classList.add(
                    'codicon',
                    item.status === 'completed'
                        ? 'codicon-pass-filled'
                        : item.status === 'in_progress'
                            ? 'codicon-record'
                            : 'codicon-circle-large-outline',
                );
            } else {
                marker.textContent = item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '◉' : '○';
            }
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-todo-label';
            label.textContent = item.label;
            row.append(marker, label);
            list.append(row);
        }
        return list;
}

export function createTranscriptActivityTodoExpandPanelExtracted(ctx: any, items: readonly QaapTranscriptTodoItem[]): HTMLElement {
        const panel = document.createElement('div');
        panel.className = 'theia-mobile-agent-activity-todo-panel theia-mobile-agent-premium-card';
        const completed = items.filter(item => item.status === 'completed').length;
        const inProgress = items.filter(item => item.status === 'in_progress').length;
        const pending = items.length - completed - inProgress;
        const head = document.createElement('header');
        head.className = 'theia-mobile-agent-premium-head theia-mod-todos';
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-premium-head-icon codicon codicon-tasklist';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-premium-head-label';
        label.textContent = nls.localize('qaap/mobileProjects/transcriptActivityTodoPanel', 'Task list');
        const count = document.createElement('span');
        count.className = 'theia-mobile-agent-premium-head-count';
        count.textContent = nls.localize(
            'qaap/mobileProjects/transcriptActivityTodoPanelCount',
            '{0} items',
            String(items.length),
        );
        head.append(icon, label, count);
        const statsParts: string[] = [];
        if (completed > 0) {
            statsParts.push(nls.localize(
                'qaap/mobileProjects/transcriptActivityTodoPanelDone',
                '{0} done',
                String(completed),
            ));
        }
        if (inProgress > 0) {
            statsParts.push(nls.localize(
                'qaap/mobileProjects/transcriptActivityTodoPanelActive',
                '{0} active',
                String(inProgress),
            ));
        }
        if (pending > 0) {
            statsParts.push(nls.localize(
                'qaap/mobileProjects/transcriptActivityTodoPanelPending',
                '{0} pending',
                String(pending),
            ));
        }
        if (statsParts.length) {
            const stats = document.createElement('span');
            stats.className = 'theia-mobile-agent-activity-todo-panel-stats';
            stats.textContent = statsParts.join(' · ');
            head.append(stats);
        }
        panel.append(head);
        if (items.length > 0) {
            const progress = document.createElement('div');
            progress.className = 'theia-mobile-agent-activity-todo-progress';
            progress.setAttribute('role', 'progressbar');
            progress.setAttribute('aria-valuemin', '0');
            progress.setAttribute('aria-valuemax', String(items.length));
            progress.setAttribute('aria-valuenow', String(completed));
            progress.setAttribute('aria-label', nls.localize(
                'qaap/mobileProjects/transcriptActivityTodoProgress',
                '{0} of {1} tasks completed',
                String(completed),
                String(items.length),
            ));
            const fill = document.createElement('span');
            fill.className = 'theia-mobile-agent-activity-todo-progress-fill';
            fill.style.width = `${Math.round((completed / items.length) * 100)}%`;
            progress.append(fill);
            panel.append(progress);
        }
        panel.append(ctx.createTranscriptTodoChecklistFromItems(items, { premium: true }));
        return panel;
}

export function createTranscriptActivityErrorPanelExtracted(ctx: any, display: TranscriptToolErrorDisplay,
        options?: { readonly defaultOpen?: boolean; readonly onRetry?: () => void | Promise<void> },): HTMLDetailsElement {
        const details = document.createElement('details');
        details.className = 'theia-mobile-agent-activity-error-panel';
        details.open = options?.defaultOpen ?? true;
        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-activity-error-panel-summary';
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-activity-error-panel-icon codicon codicon-warning';
        icon.setAttribute('aria-hidden', 'true');
        const titleWrap = document.createElement('span');
        titleWrap.className = 'theia-mobile-agent-activity-error-panel-title-wrap';
        const code = document.createElement('span');
        code.className = 'theia-mobile-agent-activity-error-panel-code';
        code.textContent = display.code;
        const preview = document.createElement('span');
        preview.className = 'theia-mobile-agent-activity-error-panel-preview';
        preview.textContent = display.preview;
        titleWrap.append(code, preview);
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-activity-error-panel-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        summary.append(icon, titleWrap, chevron);
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-activity-error-panel-body';
        const message = document.createElement('pre');
        message.className = 'theia-mobile-agent-activity-error-panel-message';
        message.textContent = display.message;
        body.append(message);
        const actions = document.createElement('div');
        actions.className = 'theia-mobile-agent-activity-error-panel-actions';
        if (display.fixHint.trim()) {
            const hintBtn = document.createElement('button');
            hintBtn.type = 'button';
            hintBtn.className = 'theia-mobile-agent-activity-error-panel-action theia-mod-hint';
            hintBtn.textContent = nls.localize('qaap/mobileProjects/transcriptErrorCopyFixHint', 'Copy fix hint');
            hintBtn.addEventListener('click', event => {
                event.stopPropagation();
                event.preventDefault();
                void ctx.copyTranscriptShellText(display.fixHint, hintBtn, hintBtn, hintBtn.textContent ?? '');
            });
            actions.append(hintBtn);
        }
        if (options?.onRetry) {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'theia-mobile-agent-activity-error-panel-action theia-mod-retry codicon codicon-refresh';
            retryBtn.textContent = nls.localize('qaap/mobileProjects/transcriptErrorRetryStep', 'Retry step');
            retryBtn.addEventListener('click', event => {
                event.stopPropagation();
                event.preventDefault();
                void Promise.resolve(options.onRetry!());
            });
            actions.append(retryBtn);
        }
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'theia-mobile-agent-activity-error-panel-copy codicon codicon-copy';
        const copyLabel = nls.localize('qaap/mobileProjects/transcriptShellCopy', 'Copy');
        copyBtn.setAttribute('aria-label', copyLabel);
        const tip = document.createElement('span');
        tip.className = 'theia-mobile-agent-activity-error-panel-copy-tip';
        tip.setAttribute('role', 'tooltip');
        tip.textContent = nls.localize('qaap/mobileProjects/transcriptShellCopied', 'Copied');
        copyBtn.append(tip);
        copyBtn.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault();
            void ctx.copyTranscriptShellText(display.body, copyBtn, tip, copyLabel);
        });
        actions.append(copyBtn);
        body.append(actions);
        summary.addEventListener('click', event => event.stopPropagation());
        details.append(summary, body);
        return details;
}

export function createTranscriptToolSpeculativePlaceholderExtracted(ctx: any): HTMLElement {
        const placeholder = document.createElement('div');
        placeholder.className = TRANSCRIPT_TOOL_SPECULATIVE_CLASS;
        placeholder.setAttribute('aria-hidden', 'true');
        return placeholder;
}

export function ensureTranscriptToolSpeculativePlaceholderExtracted(ctx: any, body: HTMLElement, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): void {
        if (segment.finished || segment.result?.trim()) {
            body.querySelector(`.${TRANSCRIPT_TOOL_SPECULATIVE_CLASS}`)?.remove();
            return;
        }
        if (body.querySelector(`.${TRANSCRIPT_TOOL_SPECULATIVE_CLASS}`)) {
            return;
        }
        if (body.childElementCount === 0 || body.querySelector(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`)) {
            body.append(ctx.createTranscriptToolSpeculativePlaceholder());
        }
}

export function createTranscriptToolResultStreamBodyExtracted(ctx: any, text: string): HTMLElement {
        const pre = document.createElement('pre');
        pre.className = TRANSCRIPT_TOOL_RESULT_STREAM_CLASS;
        pre.textContent = text;
        return pre;
}

export function createTranscriptToolPillTerminalBodyExtracted(ctx: any, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        options?: { readonly streaming?: boolean },): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-agent-pill-terminal';
        const command = ctx.resolversUi.extractTranscriptToolCommand(segment.args);
        if (command) {
            const commandBlock = document.createElement('div');
            commandBlock.className = 'theia-mobile-agent-shell-command-block';
            const commandLine = document.createElement('div');
            commandLine.className = 'theia-mobile-agent-shell-command';
            const prompt = document.createElement('span');
            prompt.className = 'theia-mobile-agent-shell-prompt';
            prompt.textContent = '$';
            const commandText = document.createElement('code');
            commandText.textContent = command;
            commandLine.append(prompt, commandText);
            commandBlock.append(commandLine);
            wrap.append(commandBlock);
        }
        if (segment.result?.trim()) {
            const text = ctx.resolversUi.formatTranscriptToolResult(segment.result);
            if (options?.streaming && !segment.finished) {
                wrap.append(ctx.createTranscriptToolResultStreamBody(text));
            } else {
                const pre = document.createElement('pre');
                pre.className = 'theia-mobile-agent-shell-output';
                pre.textContent = text;
                wrap.append(ctx.createTranscriptClampedBlock(pre, text.split('\n').length, 6));
            }
        }
        return wrap;
}


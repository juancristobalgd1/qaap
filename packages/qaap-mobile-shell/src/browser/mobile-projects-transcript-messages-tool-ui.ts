// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { formatStoredAgentFailureMessage } from '../common/qaap-agent-failure-message';
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

/** Sticky expand headers kick in once a grouped panel is long enough to scroll. */
const TRANSCRIPT_EXPAND_STICKY_TERMINAL_MIN = 6;
const TRANSCRIPT_EXPAND_STICKY_READ_MIN = 8;

export const TRANSCRIPT_TOOL_RESULT_STREAM_CLASS = 'theia-mobile-agent-tool-result-stream';
/** Placeholder body mounted before tool stdout/result arrives (speculative pill). */
export const TRANSCRIPT_TOOL_SPECULATIVE_CLASS = 'theia-mobile-agent-tool-pill-speculative';

export class MobileProjectsTranscriptMessagesToolUi {
    constructor(
        protected readonly host: MobileProjectsTranscriptMessagesHost,
        protected readonly contentUi: MobileProjectsTranscriptMessagesContentUi,
        protected readonly resolversUi: MobileProjectsTranscriptMessagesResolversUi,
    ) { }

    renderTranscriptRichContent(
        host: HTMLElement,
        content: string,
        options?: { readonly streaming?: boolean; readonly defer?: boolean; readonly sync?: boolean },
    ): void {
        const clean = this.contentUi.cleanTranscriptDisplayText(content).trim();
        if (isTranscriptTerminalOutputText(clean)) {
            if (options?.defer) {
                host.classList.add('theia-mod-deferred-terminal');
                host.textContent = clean.split('\n').slice(0, 3).join('\n');
                return;
            }
            host.replaceChildren(this.createTranscriptTextTerminalWindow(clean));
            return;
        }
        host.classList.add('theia-mod-markdown');
        if (options?.sync) {
            if (options.defer) {
                host.classList.add('theia-mod-deferred-markdown');
                const excerpt = clean.length > 180 ? `${clean.slice(0, 180).trimEnd()}…` : clean;
                host.textContent = excerpt;
                registerDeferredTranscriptMarkdown({ host, content: clean, streaming: options.streaming });
                return;
            }
            this.contentUi.renderTranscriptMarkdownImmediate(host, clean);
            return;
        }
        if (options?.streaming) {
            this.contentUi.renderTranscriptStreamingMarkdown(host, clean, { defer: options?.defer });
            return;
        }
        this.contentUi.renderTranscriptMarkdown(host, clean, { defer: options?.defer });
    }

    createTranscriptAgentFailureDialog(error: string, technicalContent?: string): HTMLElement {
        const formatted = formatStoredAgentFailureMessage(error);
        const details = document.createElement('details');
        details.className = 'theia-mobile-agent-shell-window theia-mod-failed theia-mod-turn-failure';
        details.open = true;

        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-shell-head';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-shell-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        const iconWrap = document.createElement('span');
        iconWrap.className = 'theia-mobile-agent-shell-icon-wrap';
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-shell-icon codicon codicon-warning';
        icon.setAttribute('aria-hidden', 'true');
        iconWrap.append(icon);
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-shell-title';
        label.textContent = nls.localize('qaap/mobileProjects/transcriptTurnFailed', 'Task failed');
        summary.append(chevron, iconWrap, label);
        this.appendTranscriptShellSummaryTail(summary, {
            finished: true,
            failed: true,
            copyFrom: () => {
                const technical = technicalContent?.trim();
                return technical && technical !== formatted
                    ? `${formatted}\n\n${this.contentUi.cleanTranscriptDisplayText(technical)}`
                    : formatted;
            },
        });

        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-shell-body';
        const message = document.createElement('p');
        message.className = 'theia-mobile-agent-turn-failure-message';
        message.textContent = formatted;
        body.append(message);
        const technical = technicalContent?.trim();
        if (technical && technical !== formatted && technical !== error.trim()) {
            body.append(this.createTranscriptClampedPre(
                this.contentUi.cleanTranscriptDisplayText(technical),
                'theia-mobile-agent-shell-output',
            ));
        }
        details.append(summary, body);
        return details;
    }

    createTranscriptTextTerminalWindow(content: string): HTMLElement {
        const details = document.createElement('details');
        const failed = isTranscriptErrorOutput(content);
        details.className = `theia-mobile-agent-shell-window ${failed ? 'theia-mod-failed' : 'theia-mod-done'} theia-mod-text-output`;
        details.open = shouldOpenTranscriptToolDetailsSegment({ finished: true, resultFailed: failed });
        const cleanContent = this.contentUi.cleanTranscriptDisplayText(content);
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-shell-body';
        body.append(this.createTranscriptClampedPre(cleanContent, 'theia-mobile-agent-shell-output'));
        const summary = this.createTranscriptShellWindowHead({
            title: failed
                ? nls.localize('qaap/mobileProjects/transcriptErrorOutput', 'Error output')
                : nls.localize('qaap/mobileProjects/transcriptTerminalOutput', 'Terminal output'),
            finished: true,
            failed,
            exitCode: failed
                ? (this.parseTranscriptShellExitCode(cleanContent) ?? 1)
                : this.parseTranscriptShellExitCode(cleanContent),
            copyFrom: () => this.collectTranscriptShellBodyCopyText(body),
        });
        details.append(summary, body);
        return details;
    }

    createTranscriptSegmentDetails(
        segment: QaapAgentMessageSegmentDTO,
        options?: { readonly defer?: boolean; readonly streaming?: boolean },
    ): HTMLElement {
        if (segment.type === 'thinking') {
            const details = document.createElement('details');
            details.className = 'theia-mobile-agent-transcript-details theia-mod-thinking';
            details.open = false;
            const summary = document.createElement('summary');
            summary.textContent = nls.localize('qaap/mobileProjects/transcriptThinking', 'Thinking');
            const pre = document.createElement('pre');
            pre.textContent = this.contentUi.cleanTranscriptDisplayText(segment.content);
            details.append(summary, pre);
            return details;
        }
        if (segment.type === 'tool') {
            if (this.resolversUi.isTranscriptShellTool(segment.name)) {
                return this.createTranscriptShellDetails(segment);
            }
            return this.createTranscriptToolWindow(segment, options);
        }
        const block = document.createElement('div');
        block.className = 'theia-mobile-agent-transcript-content';
        this.renderTranscriptRichContent(block, segment.content ?? '', {
            defer: options?.defer,
            streaming: options?.streaming,
        });
        return block;
    }

    /**
     * Render preformatted output that clamps to a few preview lines when long, with an inline
     * expand/collapse toggle — used for tool results and terminal output so the transcript stays
     * compact but every line is one tap away.
     */

    createTranscriptClampedPre(text: string, className: string): HTMLElement {
        const pre = document.createElement('pre');
        pre.className = className;
        pre.textContent = text;
        return this.createTranscriptClampedBlock(pre, text.split('\n').length);
    }

    createTranscriptClampedBlock(content: HTMLElement, lineCount: number, previewLines = 4): HTMLElement {
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

    /** Minimal one-line read status: `Read file.ts L2505-2554`. */

    createTranscriptReadLine(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): HTMLElement {
        const fullPath = this.resolversUi.extractTranscriptToolFullPath(segment.args);
        const line = document.createElement('div');
        line.className = 'theia-mobile-agent-read-line';
        if (!segment.finished) {
            line.classList.add('theia-mod-running');
        }
        const verb = document.createElement('span');
        verb.className = 'theia-mobile-agent-read-line-verb';
        verb.textContent = nls.localize('qaap/mobileProjects/transcriptToolRead', 'Read');
        const detail = document.createElement('span');
        detail.className = 'theia-mobile-agent-read-line-detail';
        detail.textContent = formatReadToolDetailFromArgs(segment.args)
            ?? (fullPath ? this.resolversUi.splitTranscriptFilePath(fullPath).fileName : '');
        line.append(verb, document.createTextNode(' '), detail);
        if (fullPath) {
            this.attachTranscriptFileOpenAction(line, fullPath);
        }
        return line;
    }

    createTranscriptToolWindow(
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        options?: { readonly defer?: boolean },
    ): HTMLElement {
        const kind = this.resolversUi.resolveTranscriptToolKind(segment.name);
        const fullPath = this.resolversUi.extractTranscriptToolFullPath(segment.args);
        const target = fullPath ? this.resolversUi.compactTranscriptPath(fullPath)
            : this.resolversUi.extractTranscriptToolShortArg(segment.args);
        const hasResult = !!segment.result?.trim();
        const showResultBody = this.resolversUi.shouldShowTranscriptToolResultBody(segment, kind);
        const pureRead = this.resolversUi.isTranscriptPureReadTool(segment.name);

        if (pureRead && !showResultBody) {
            return this.createTranscriptReadLine(segment);
        }

        const failed = this.resolversUi.transcriptToolResultFailed(segment.result);
        const head = this.createTranscriptToolHead({
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
        details.className = `theia-mobile-agent-tool-window theia-mod-${kind}`;
        const shouldOpen = this.resolversUi.shouldOpenTranscriptToolDetails(segment);
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
            body.append(this.createTranscriptToolResultBody(segment, kind));
        }
        details.append(body);
        return details;
    }

    createTranscriptToolResultBody(
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        kind: string,
        options?: { readonly streaming?: boolean },
    ): HTMLElement {
        if (isTranscriptTodoTool(segment.name)) {
            const checklist = this.createTranscriptTodoChecklist(segment);
            if (checklist) {
                return checklist;
            }
        }
        if (kind === 'terminal' || this.resolversUi.isTranscriptShellTool(segment.name)) {
            return this.createTranscriptToolPillTerminalBody(segment, options);
        }
        const text = this.resolversUi.formatTranscriptToolResult(segment.result!);
        if (options?.streaming && !segment.finished) {
            return this.createTranscriptToolResultStreamBody(text);
        }
        const richBody = tryBuildTranscriptRichToolBody(text, segment.name, segment.args);
        if (richBody) {
            return richBody;
        }
        const fullPath = this.resolversUi.extractTranscriptToolFullPath(segment.args);
        const language = resolveTranscriptCodeLanguage(fullPath, text);
        const view = createTranscriptCodeView(text, language);
        return this.createTranscriptClampedBlock(view, text.split('\n').length);
    }

    /** Claude-Code-style live task checklist (✓ done, ◉ in progress, ○ pending). */
    createTranscriptTodoChecklist(
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    ): HTMLElement | undefined {
        const items = parseTranscriptTodoChecklist(segment.args);
        if (!items) {
            return undefined;
        }
        return this.createTranscriptTodoChecklistFromItems(items);
    }

    createTranscriptTodoChecklistFromItems(
        items: readonly QaapTranscriptTodoItem[],
        options?: { readonly premium?: boolean },
    ): HTMLElement {
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

    createTranscriptActivityTodoExpandPanel(items: readonly QaapTranscriptTodoItem[]): HTMLElement {
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
        panel.append(this.createTranscriptTodoChecklistFromItems(items, { premium: true }));
        return panel;
    }

    createTranscriptActivityErrorPanel(
        display: TranscriptToolErrorDisplay,
        options?: { readonly defaultOpen?: boolean; readonly onRetry?: () => void | Promise<void> },
    ): HTMLDetailsElement {
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
                void this.copyTranscriptShellText(display.fixHint, hintBtn, hintBtn, hintBtn.textContent ?? '');
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
            void this.copyTranscriptShellText(display.body, copyBtn, tip, copyLabel);
        });
        actions.append(copyBtn);
        body.append(actions);
        summary.addEventListener('click', event => event.stopPropagation());
        details.append(summary, body);
        return details;
    }

    createTranscriptToolSpeculativePlaceholder(): HTMLElement {
        const placeholder = document.createElement('div');
        placeholder.className = TRANSCRIPT_TOOL_SPECULATIVE_CLASS;
        placeholder.setAttribute('aria-hidden', 'true');
        return placeholder;
    }

    ensureTranscriptToolSpeculativePlaceholder(body: HTMLElement, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): void {
        if (segment.finished || segment.result?.trim()) {
            body.querySelector(`.${TRANSCRIPT_TOOL_SPECULATIVE_CLASS}`)?.remove();
            return;
        }
        if (body.querySelector(`.${TRANSCRIPT_TOOL_SPECULATIVE_CLASS}`)) {
            return;
        }
        if (body.childElementCount === 0 || body.querySelector(`.${TRANSCRIPT_APPROVAL_CARD_CLASS}`)) {
            body.append(this.createTranscriptToolSpeculativePlaceholder());
        }
    }

    createTranscriptToolResultStreamBody(text: string): HTMLElement {
        const pre = document.createElement('pre');
        pre.className = TRANSCRIPT_TOOL_RESULT_STREAM_CLASS;
        pre.textContent = text;
        return pre;
    }

    /** Shell command + clamped stdout inside a tool pill (Cursor-style inline terminal logs). */
    createTranscriptToolPillTerminalBody(
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        options?: { readonly streaming?: boolean },
    ): HTMLElement {
        const wrap = document.createElement('div');
        wrap.className = 'theia-mobile-agent-pill-terminal';
        const command = this.resolversUi.extractTranscriptToolCommand(segment.args);
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
            const text = this.resolversUi.formatTranscriptToolResult(segment.result);
            if (options?.streaming && !segment.finished) {
                wrap.append(this.createTranscriptToolResultStreamBody(text));
            } else {
                const pre = document.createElement('pre');
                pre.className = 'theia-mobile-agent-shell-output';
                pre.textContent = text;
                wrap.append(this.createTranscriptClampedBlock(pre, text.split('\n').length, 6));
            }
        }
        return wrap;
    }

    /** Patch a running tool's stdout in place — skips code-view rebuild while output grows. */
    patchTranscriptToolResultStreamBody(
        pillBody: HTMLElement,
        segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    ): boolean {
        const streamHost = pillBody.querySelector<HTMLElement>(`.${TRANSCRIPT_TOOL_RESULT_STREAM_CLASS}`);
        if (!streamHost) {
            return false;
        }
        streamHost.textContent = this.resolversUi.formatTranscriptToolResult(segment.result!);
        return true;
    }

    canPatchTranscriptToolResultStream(
        previous: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
        next: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>,
    ): boolean {
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

    handleTranscriptFileOpen(filePath: string): void {
        if (!this.host.openTranscriptFile) {
            return;
        }
        void Promise.resolve(this.host.openTranscriptFile(filePath)).catch(error => {
            console.warn('[qaap-mobile-shell] Failed to open transcript file:', error);
            this.host.messageService?.error(
                nls.localize('qaap/mobileProjects/transcriptOpenFileFailed', 'Could not open {0}', filePath),
            );
        });
    }

    handleTranscriptReviewFileOpen(filePath: string): void {
        if (!this.host.openTranscriptReviewFile) {
            return;
        }
        void Promise.resolve(this.host.openTranscriptReviewFile(filePath)).catch(error => {
            console.warn('[qaap-mobile-shell] Failed to open transcript review file:', error);
            this.host.messageService?.error(
                nls.localize('qaap/mobileProjects/transcriptOpenReviewFileFailed', 'Could not open {0} in Review', filePath),
            );
        });
    }

    attachTranscriptReviewFileOpenAction(row: HTMLElement, filePath: string): void {
        if (!this.host.openTranscriptReviewFile) {
            return;
        }
        row.classList.add('theia-mod-clickable');
        row.setAttribute('role', 'button');
        row.tabIndex = 0;
        row.title = nls.localize('qaap/mobileProjects/transcriptOpenFileInReview', 'Open in Review');
        const open = (event: Event): void => {
            event.stopPropagation();
            event.preventDefault();
            this.handleTranscriptReviewFileOpen(filePath);
        };
        row.addEventListener('click', open);
        row.addEventListener('keydown', event => {
            if (event instanceof KeyboardEvent && (event.key === 'Enter' || event.key === ' ')) {
                open(event);
            }
        });
    }

    attachTranscriptFileOpenAction(head: HTMLElement, filePath: string): void {
        if (!this.host.openTranscriptFile) {
            return;
        }
        head.classList.add('theia-mod-clickable');
        head.title = nls.localize('qaap/mobileProjects/transcriptOpenFileInFiles', 'Open in Files preview');
        head.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault();
            this.handleTranscriptFileOpen(filePath);
        });
    }

    createTranscriptToolHead(options: {
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
        head.className = 'theia-mobile-agent-tool-head';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-tool-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        if (!options.showResultBody) {
            chevron.hidden = true;
        }
        const icon = document.createElement('span');
        icon.className = `theia-mobile-agent-tool-icon codicon ${this.transcriptToolIconClass(options.kind)}`;
        icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span');
        title.className = 'theia-mobile-agent-tool-title';
        title.textContent = this.transcriptToolVerb(options.kind, options.toolName);
        head.append(chevron, icon, title);
        if (options.fullPath && options.kind === 'reading') {
            const { fileName, dirPath } = this.resolversUi.splitTranscriptFilePath(options.fullPath);
            const fileNameEl = document.createElement('span');
            fileNameEl.className = 'theia-mobile-agent-tool-file-name';
            fileNameEl.textContent = fileName;
            head.append(fileNameEl);
            if (dirPath) {
                const dirEl = document.createElement('span');
                dirEl.className = 'theia-mobile-agent-tool-file-dir';
                dirEl.textContent = dirPath;
                head.append(dirEl);
            }
            if (!options.showResultBody) {
                this.attachTranscriptFileOpenAction(head, options.fullPath);
            }
        } else if (options.target) {
            const chip = document.createElement('span');
            chip.className = 'theia-mobile-agent-tool-target';
            chip.textContent = options.target;
            head.append(chip);
        }
        if (options.hasResult && options.pureRead && options.result) {
            const lineCount = this.resolversUi.countTranscriptResultLines(options.result);
            if (lineCount > 0) {
                const badge = document.createElement('span');
                badge.className = 'theia-mobile-agent-tool-badge';
                badge.textContent = lineCount === 1
                    ? nls.localize('qaap/mobileProjects/transcriptToolLineCountOne', '1 line')
                    : nls.localize('qaap/mobileProjects/transcriptToolLineCount', '{0} lines', String(lineCount));
                head.append(badge);
            }
        } else if (options.hasResult && options.kind === 'searching' && options.result) {
            const matchLines = this.resolversUi.countTranscriptResultLines(options.result);
            if (matchLines > 0) {
                const badge = document.createElement('span');
                badge.className = 'theia-mobile-agent-tool-badge theia-mod-muted';
                badge.textContent = matchLines === 1
                    ? nls.localize('qaap/mobileProjects/transcriptToolMatchCountOne', '1 match')
                    : nls.localize('qaap/mobileProjects/transcriptToolMatchCount', '{0} matches', String(matchLines));
                head.append(badge);
            }
        }
        this.appendTranscriptShellSummaryTail(head, {
            finished: options.finished,
            failed: options.failed,
            copyFrom: options.hasResult && options.result
                ? () => this.resolversUi.formatTranscriptToolResult(options.result!)
                : undefined,
        });
        return head;
    }

    /** Codicon for a tool window header, by resolved tool kind. */

    transcriptToolIconClass(kind: string): string {
        switch (kind) {
            case 'reading': return 'codicon-file';
            case 'searching': return 'codicon-search';
            case 'editing': return 'codicon-edit';
            case 'terminal': return 'codicon-terminal';
            case 'mcp': return 'codicon-server-process';
            default: return 'codicon-tools';
        }
    }

    /** Human verb for a finished/running tool, e.g. "Read", "Edited", "Searched". */

    transcriptToolVerb(kind: string, toolName: string): string {
        switch (kind) {
            case 'reading': return nls.localize('qaap/mobileProjects/transcriptToolRead', 'Read');
            case 'searching': return nls.localize('qaap/mobileProjects/transcriptToolSearched', 'Searched');
            case 'editing': return nls.localize('qaap/mobileProjects/transcriptToolEdited', 'Edited');
            case 'terminal': return nls.localize('qaap/mobileProjects/transcriptToolRan', 'Ran');
            case 'mcp': return nls.localize('qaap/mobileProjects/transcriptToolMcp', 'Called');
            default: return (toolName ?? 'tool').replace(/_/g, ' ');
        }
    }

    transcriptShellStateAriaLabel(finished: boolean, failed: boolean): string {
        if (!finished) {
            return nls.localize('qaap/mobileProjects/transcriptShellRunning', 'running');
        }
        return failed
            ? nls.localize('qaap/mobileProjects/transcriptShellFailed', 'failed')
            : nls.localize('qaap/mobileProjects/transcriptShellDone', 'done');
    }

    /** Full shell-window text for clipboard: `$ command` plus any output block. */

    collectTranscriptShellBodyCopyText(body: HTMLElement): string {
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

    /** Tool UI-style collapsible card header for the compact tool-pill strip. */
    createTranscriptToolPillSummary(options: {
        kind: string;
        verb: string;
        label: string;
        finished: boolean;
        failed: boolean;
        copyFrom?: () => string;
        mcpServer?: string;
    }): HTMLElement {
        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-tool-pill-summary';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-tool-pill-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('span');
        icon.className = `codicon ${this.transcriptToolIconClass(options.kind)} theia-mobile-agent-tool-pill-icon`;
        icon.setAttribute('aria-hidden', 'true');
        const verb = document.createElement('span');
        verb.className = 'theia-mobile-agent-tool-pill-verb';
        verb.textContent = options.verb;
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-tool-pill-label';
        label.textContent = options.label;
        summary.append(chevron, icon, verb, label);
        if (options.kind === 'mcp') {
            summary.append(this.createTranscriptMcpBadge(options.mcpServer));
        }
        this.appendTranscriptToolPillSummaryTail(summary, {
            finished: options.finished,
            failed: options.failed,
            copyFrom: options.copyFrom,
        });
        return summary;
    }

    createTranscriptMcpBadge(server?: string): HTMLElement {
        const badge = document.createElement('span');
        badge.className = 'theia-mobile-agent-tool-pill-badge theia-mod-mcp';
        badge.textContent = server ? `MCP · ${server}` : 'MCP';
        if (server) {
            badge.setAttribute('title', server);
        }
        badge.setAttribute('aria-label', nls.localize('qaap/mobileProjects/transcriptMcpBadge', 'MCP tool'));
        return badge;
    }

    syncTranscriptToolPillSummary(
        summary: HTMLElement,
        options: {
            kind?: string;
            verb: string;
            label: string;
            finished: boolean;
            failed: boolean;
            copyFrom?: () => string;
            mcpServer?: string;
        },
    ): void {
        const verb = summary.querySelector('.theia-mobile-agent-tool-pill-verb');
        if (verb) {
            verb.textContent = options.verb;
        }
        const labelEl = summary.querySelector('.theia-mobile-agent-tool-pill-label');
        if (labelEl) {
            labelEl.textContent = options.label;
        }
        summary.querySelector('.theia-mobile-agent-tool-pill-badge.theia-mod-mcp')?.remove();
        if (options.kind === 'mcp') {
            const label = summary.querySelector('.theia-mobile-agent-tool-pill-label');
            label?.after(this.createTranscriptMcpBadge(options.mcpServer));
        }
        summary.querySelector('.theia-mobile-agent-shell-tail')?.remove();
        this.appendTranscriptToolPillSummaryTail(summary, {
            finished: options.finished,
            failed: options.failed,
            copyFrom: options.copyFrom,
        });
    }

    appendTranscriptToolPillSummaryTail(
        summary: HTMLElement,
        options: { finished: boolean; failed: boolean; copyFrom?: () => string },
    ): void {
        this.appendTranscriptShellSummaryTail(summary, options);
    }

    appendTranscriptCardCopyTail(summary: HTMLElement, copyFrom: () => string): void {
        this.appendTranscriptShellSummaryTail(summary, {
            finished: true,
            failed: false,
            showState: false,
            copyFrom,
        });
    }

    /** Tool UI terminal card header — chevron, terminal icon, title, optional exit code, tail actions. */
    createTranscriptShellWindowHead(options: {
        title: string;
        finished: boolean;
        failed: boolean;
        exitCode?: number;
        copyFrom?: () => string;
    }): HTMLElement {
        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-shell-head';
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-shell-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        const iconWrap = document.createElement('span');
        iconWrap.className = 'theia-mobile-agent-shell-icon-wrap';
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-shell-icon codicon codicon-terminal';
        icon.setAttribute('aria-hidden', 'true');
        iconWrap.append(icon);
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-shell-title';
        label.textContent = options.title;
        summary.append(chevron, iconWrap, label);
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
        this.appendTranscriptShellSummaryTail(summary, {
            finished: options.finished,
            failed: options.failed,
            copyFrom: options.copyFrom,
        });
        return summary;
    }

    parseTranscriptShellExitCode(result: string | undefined): number | undefined {
        if (!result?.trim()) {
            return undefined;
        }
        const match = result.match(/\bexit(?:\s+code)?[:\s]+(\d+)\b/i)
            ?? result.match(/\b(?:exited|code)\s+(\d+)\b/i);
        return match ? Number(match[1]) : undefined;
    }

    appendTranscriptShellSummaryTail(
        summary: HTMLElement,
        options: { finished: boolean; failed: boolean; copyFrom?: () => string; copyLabel?: string; showState?: boolean },
    ): void {
        const tail = document.createElement('div');
        tail.className = 'theia-mobile-agent-shell-tail';
        if (options.showState !== false) {
            const state = document.createElement('span');
            state.className = 'theia-mobile-agent-shell-state';
            state.setAttribute('role', 'status');
            state.setAttribute('aria-label', this.transcriptShellStateAriaLabel(options.finished, options.failed));
            tail.append(state);
        }
        if (options.copyFrom) {
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'theia-mobile-agent-shell-copy codicon codicon-copy';
            const copyLabel = options.copyLabel
                ?? nls.localize('qaap/mobileProjects/transcriptShellCopy', 'Copy');
            copyBtn.setAttribute('aria-label', copyLabel);
            const tip = document.createElement('span');
            tip.className = 'theia-mobile-agent-shell-copy-tip';
            tip.setAttribute('role', 'tooltip');
            tip.textContent = nls.localize('qaap/mobileProjects/transcriptShellCopied', 'Copied');
            copyBtn.append(tip);
            copyBtn.addEventListener('click', event => {
                event.stopPropagation();
                event.preventDefault();
                const text = options.copyFrom!().trim();
                if (text) {
                    void this.copyTranscriptShellText(text, copyBtn, tip, copyLabel);
                }
            });
            tail.append(copyBtn);
        }
        summary.append(tail);
    }

    async copyTranscriptShellText(
        text: string,
        copyBtn: HTMLButtonElement,
        tip: HTMLElement,
        copyLabel: string,
    ): Promise<void> {
        const copiedLabel = nls.localize('qaap/mobileProjects/transcriptShellCopied', 'Copied');
        const failedLabel = nls.localize('qaap/mobileProjects/transcriptShellCopyFailed', 'Could not copy');
        try {
            await navigator.clipboard.writeText(text);
            this.flashTranscriptShellCopyTooltip(copyBtn, tip, copiedLabel, copyLabel, false);
        } catch {
            this.flashTranscriptShellCopyTooltip(copyBtn, tip, failedLabel, copyLabel, true);
        }
    }

    flashTranscriptShellCopyTooltip(
        copyBtn: HTMLButtonElement,
        tip: HTMLElement,
        message: string,
        copyLabel: string,
        failed: boolean,
    ): void {
        tip.textContent = message;
        copyBtn.classList.remove('theia-mod-copied', 'theia-mod-copy-failed');
        copyBtn.classList.add(failed ? 'theia-mod-copy-failed' : 'theia-mod-copied');
        copyBtn.setAttribute('aria-label', message);
        window.clearTimeout(copyBtn.dataset.copyTipTimerId ? Number(copyBtn.dataset.copyTipTimerId) : undefined);
        copyBtn.dataset.copyTipTimerId = String(window.setTimeout(() => {
            copyBtn.classList.remove('theia-mod-copied', 'theia-mod-copy-failed');
            copyBtn.setAttribute('aria-label', copyLabel);
            delete copyBtn.dataset.copyTipTimerId;
        }, 1400));
    }

    createTranscriptShellDetails(segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): HTMLElement {
        const details = document.createElement('details');
        details.className = 'theia-mobile-agent-shell-window';
        const failed = this.resolversUi.transcriptToolResultFailed(segment.result);
        details.open = this.resolversUi.shouldOpenTranscriptToolDetails(segment);
        if (segment.finished) {
            details.classList.add(failed ? 'theia-mod-failed' : 'theia-mod-done');
        } else {
            details.classList.add('theia-mod-running');
        }

        const command = this.resolversUi.extractTranscriptToolCommand(segment.args)
            ?? this.contentUi.cleanTranscriptDisplayText(segment.args);
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-shell-body';
        if (command && command !== '{}') {
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
            body.append(commandBlock);
        }
        if (segment.result?.trim()) {
            body.append(this.createTranscriptClampedPre(
                this.resolversUi.formatTranscriptToolResult(segment.result),
                'theia-mobile-agent-shell-output',
            ));
        }
        const exitCode = segment.finished
            ? (this.parseTranscriptShellExitCode(segment.result) ?? (failed ? 1 : undefined))
            : undefined;
        const summary = this.createTranscriptShellWindowHead({
            title: command && command !== '{}'
                ? this.resolversUi.compactTranscriptCommand(command)
                : nls.localize('qaap/mobileProjects/transcriptShell', 'Shell'),
            finished: segment.finished,
            failed,
            exitCode,
            copyFrom: () => this.collectTranscriptShellBodyCopyText(body),
        });
        details.append(summary, body);
        return details;
    }

    createTranscriptActivityTerminalExpandPanel(
        entries: readonly TranscriptActivityTerminalExpandEntry[],
        options?: { readonly single?: boolean },
    ): HTMLElement {
        const panel = document.createElement('div');
        const showHead = !options?.single && entries.length >= 2;
        panel.className = showHead
            ? 'theia-mobile-agent-activity-terminal-panel theia-mobile-agent-premium-card'
            : 'theia-mobile-agent-activity-terminal-panel theia-mod-single';
        if (showHead) {
            const head = document.createElement('header');
            head.className = 'theia-mobile-agent-premium-head theia-mod-terminal';
            const icon = document.createElement('span');
            icon.className = 'theia-mobile-agent-premium-head-icon codicon codicon-terminal';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-premium-head-label';
            label.textContent = nls.localize('qaap/mobileProjects/transcriptActivityTerminalPanel', 'Shell output');
            const count = document.createElement('span');
            count.className = 'theia-mobile-agent-premium-head-count';
            count.textContent = nls.localize(
                'qaap/mobileProjects/transcriptActivityTerminalPanelCount',
                '{0} commands',
                String(entries.length),
            );
            head.append(icon, label, count);
            const failedCount = entries.filter(entry => this.isTranscriptActivityTerminalEntryFailed(entry)).length;
            const runningCount = entries.filter(entry => entry.finished === false).length;
            const successCount = entries.length - failedCount - runningCount;
            const statsParts: string[] = [];
            if (successCount > 0) {
                statsParts.push(nls.localize(
                    'qaap/mobileProjects/transcriptActivityTerminalPanelSuccess',
                    '{0} passed',
                    String(successCount),
                ));
            }
            if (failedCount > 0) {
                statsParts.push(nls.localize(
                    'qaap/mobileProjects/transcriptActivityTerminalPanelFailed',
                    '{0} failed',
                    String(failedCount),
                ));
            }
            if (runningCount > 0) {
                statsParts.push(nls.localize(
                    'qaap/mobileProjects/transcriptActivityTerminalPanelRunning',
                    '{0} running',
                    String(runningCount),
                ));
            }
            if (statsParts.length) {
                const stats = document.createElement('span');
                stats.className = 'theia-mobile-agent-activity-terminal-panel-stats';
                stats.textContent = statsParts.join(' · ');
                head.append(stats);
            }
            if (entries.length >= TRANSCRIPT_EXPAND_STICKY_TERMINAL_MIN) {
                head.classList.add('theia-mod-sticky-head');
            }
            panel.append(head);
        }
        const stack = document.createElement('div');
        stack.className = 'theia-mobile-agent-activity-terminal-stack';
        const defaultOpenIndex = this.resolveTranscriptActivityTerminalDefaultOpenIndex(entries);
        entries.forEach((entry, index) => {
            stack.append(this.createTranscriptActivityTerminalExpandCard(entry, {
                index,
                total: entries.length,
                defaultOpen: index === defaultOpenIndex,
            }));
        });
        panel.append(stack);
        return panel;
    }

    protected isTranscriptActivityTerminalEntryFailed(entry: TranscriptActivityTerminalExpandEntry): boolean {
        if (entry.failed) {
            return true;
        }
        return entry.exitCode !== undefined && entry.exitCode !== 0;
    }

    protected resolveTranscriptActivityTerminalDefaultOpenIndex(
        entries: readonly TranscriptActivityTerminalExpandEntry[],
    ): number {
        const runningIndex = entries.findIndex(entry => entry.finished === false);
        if (runningIndex >= 0) {
            return runningIndex;
        }
        const failedIndex = entries.findIndex(entry => this.isTranscriptActivityTerminalEntryFailed(entry));
        if (failedIndex >= 0) {
            return failedIndex;
        }
        return 0;
    }

    createTranscriptActivityTerminalExpandCard(
        entry: TranscriptActivityTerminalExpandEntry,
        options?: { readonly index?: number; readonly total?: number; readonly defaultOpen?: boolean },
    ): HTMLElement {
        const failed = entry.failed ?? this.resolversUi.transcriptToolResultFailed(entry.output);
        const finished = entry.finished !== false;
        const exitCode = entry.exitCode ?? (finished ? this.parseTranscriptShellExitCode(entry.output) : undefined);
        const details = document.createElement('details');
        details.className = 'theia-mobile-agent-shell-window theia-mobile-agent-activity-terminal-window';
        details.open = options?.defaultOpen ?? (options?.total === undefined || options.total <= 1);
        if (finished) {
            details.classList.add(failed ? 'theia-mod-failed' : 'theia-mod-done');
        } else {
            details.classList.add('theia-mod-running');
        }

        const command = entry.command?.trim();
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-shell-body';
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
            body.append(commandBlock);
        }
        const output = entry.output?.trim();
        if (output) {
            const outputWrap = document.createElement('div');
            outputWrap.className = 'theia-mobile-agent-activity-terminal-output-wrap';
            const outputLabel = document.createElement('div');
            outputLabel.className = 'theia-mobile-agent-activity-terminal-output-label';
            const lineCount = output.split('\n').length;
            outputLabel.textContent = lineCount > 1
                ? nls.localize(
                    'qaap/mobileProjects/transcriptActivityTerminalOutputLines',
                    'Output · {0} lines',
                    String(lineCount),
                )
                : nls.localize('qaap/mobileProjects/transcriptActivityTerminalOutput', 'Output');
            outputWrap.append(outputLabel);
            outputWrap.append(this.createTranscriptClampedPre(
                this.resolversUi.formatTranscriptToolResult(output),
                'theia-mobile-agent-shell-output theia-mobile-agent-activity-terminal-output',
            ));
            body.append(outputWrap);
        } else if (finished) {
            const empty = document.createElement('div');
            empty.className = 'theia-mobile-agent-activity-terminal-empty';
            empty.textContent = nls.localize('qaap/mobileProjects/transcriptActivityTerminalNoOutput', 'No output');
            body.append(empty);
        } else {
            const pending = document.createElement('div');
            pending.className = 'theia-mobile-agent-activity-terminal-empty theia-mod-pending';
            const dot = document.createElement('span');
            dot.className = 'theia-mobile-agent-activity-terminal-pending-dot';
            dot.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.textContent = nls.localize('qaap/mobileProjects/transcriptActivityTerminalRunning', 'Running…');
            pending.append(dot, label);
            body.append(pending);
        }

        const compactCommand = command && command !== '{}'
            ? this.resolversUi.compactTranscriptCommand(command)
            : nls.localize('qaap/mobileProjects/transcriptShell', 'Shell');
        let title = compactCommand;
        if (options?.total && options.total > 1 && options.index !== undefined) {
            title = `${options.index + 1}/${options.total} · ${compactCommand}`;
        }
        const summary = this.createTranscriptShellWindowHead({
            title,
            finished,
            failed,
            exitCode,
            copyFrom: () => this.collectTranscriptShellBodyCopyText(body),
        });
        summary.addEventListener('click', event => event.stopPropagation());
        details.append(summary, body);
        return details;
    }

    createTranscriptActivityReadExpandPanel(
        entries: readonly TranscriptActivityReadExpandEntry[],
        options?: { readonly single?: boolean },
    ): HTMLElement {
        const panel = document.createElement('div');
        const showHead = !options?.single && entries.length >= 2;
        panel.className = showHead
            ? 'theia-mobile-agent-activity-read-panel theia-mobile-agent-premium-card'
            : 'theia-mobile-agent-activity-read-panel theia-mod-single';
        if (showHead) {
            const head = document.createElement('header');
            head.className = 'theia-mobile-agent-premium-head theia-mod-read';
            const icon = document.createElement('span');
            icon.className = 'theia-mobile-agent-premium-head-icon codicon codicon-file';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-premium-head-label';
            label.textContent = nls.localize('qaap/mobileProjects/transcriptActivityReadPanel', 'File contents');
            const count = document.createElement('span');
            count.className = 'theia-mobile-agent-premium-head-count';
            count.textContent = nls.localize(
                'qaap/mobileProjects/transcriptActivityReadPanelCount',
                '{0} files',
                String(entries.length),
            );
            head.append(icon, label, count);
            if (entries.length >= TRANSCRIPT_EXPAND_STICKY_READ_MIN) {
                head.classList.add('theia-mod-sticky-head');
            }
            panel.append(head);
        }
        const stack = document.createElement('div');
        stack.className = 'theia-mobile-agent-activity-read-stack';
        entries.forEach((entry, index) => {
            stack.append(this.createTranscriptActivityReadExpandCard(entry, {
                index,
                total: entries.length,
                defaultOpen: entries.length <= 1 || index === 0,
            }));
        });
        panel.append(stack);
        return panel;
    }

    createTranscriptActivityReadExpandCard(
        entry: TranscriptActivityReadExpandEntry,
        options?: { readonly index?: number; readonly total?: number; readonly defaultOpen?: boolean },
    ): HTMLElement {
        const text = this.contentUi.cleanTranscriptDisplayText(entry.text);
        const lineCount = text.split('\n').length;
        const path = entry.path?.trim();
        const slash = path ? path.lastIndexOf('/') : -1;
        const fileName = path ? (slash >= 0 ? path.slice(slash + 1) : path) : undefined;
        const language = resolveTranscriptCodeLanguage(path, text);
        const details = document.createElement('details');
        details.className = 'theia-mobile-agent-shell-window theia-mobile-agent-activity-read-window theia-mod-done';
        details.open = options?.defaultOpen ?? true;

        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-shell-body';
        const outputWrap = document.createElement('div');
        outputWrap.className = 'theia-mobile-agent-activity-read-output-wrap';
        const outputLabel = document.createElement('div');
        outputLabel.className = 'theia-mobile-agent-activity-read-output-label';
        outputLabel.textContent = lineCount > 1
            ? nls.localize(
                'qaap/mobileProjects/transcriptActivityReadOutputLines',
                'Contents · {0} lines',
                String(lineCount),
            )
            : nls.localize('qaap/mobileProjects/transcriptActivityReadOutput', 'Contents');
        outputWrap.append(outputLabel);
        const codeView = createTranscriptCodeView(text, language);
        outputWrap.append(this.createTranscriptClampedBlock(codeView, lineCount));
        body.append(outputWrap);

        let title = fileName
            ?? nls.localize('qaap/mobileProjects/transcriptActivityReadUntitled', 'Read output');
        if (options?.total && options.total > 1 && options.index !== undefined) {
            title = `${options.index + 1}/${options.total} · ${title}`;
        }
        const summary = this.createTranscriptShellWindowHead({
            title,
            finished: true,
            failed: false,
            copyFrom: () => text,
        });
        summary.addEventListener('click', event => event.stopPropagation());
        details.append(summary, body);
        return details;
    }

    createTranscriptActivityEditExpandPanel(
        entries: readonly TranscriptActivityEditExpandEntry[],
        options?: { readonly single?: boolean },
    ): HTMLElement {
        const panel = document.createElement('div');
        const showHead = !options?.single && entries.length >= 2;
        panel.className = showHead
            ? 'theia-mobile-agent-activity-edit-panel theia-mobile-agent-premium-card'
            : 'theia-mobile-agent-activity-edit-panel theia-mod-single';
        if (showHead) {
            const head = document.createElement('header');
            head.className = 'theia-mobile-agent-premium-head theia-mod-edit';
            const icon = document.createElement('span');
            icon.className = 'theia-mobile-agent-premium-head-icon codicon codicon-diff';
            icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span');
            label.className = 'theia-mobile-agent-premium-head-label';
            label.textContent = nls.localize('qaap/mobileProjects/transcriptActivityEditPanel', 'Changed files');
            const count = document.createElement('span');
            count.className = 'theia-mobile-agent-premium-head-count';
            count.textContent = nls.localize(
                'qaap/mobileProjects/transcriptActivityEditPanelCount',
                '{0} files',
                String(entries.length),
            );
            head.append(icon, label, count);
            let totalAdded = 0;
            let totalRemoved = 0;
            for (const entry of entries) {
                totalAdded += entry.added ?? 0;
                totalRemoved += entry.removed ?? 0;
            }
            if (totalAdded > 0 || totalRemoved > 0) {
                const stats = document.createElement('span');
                stats.className = 'theia-mobile-agent-activity-edit-panel-stats';
                if (totalAdded > 0) {
                    const add = document.createElement('span');
                    add.className = 'theia-mobile-agent-diff-stat theia-mod-added';
                    add.textContent = `+${totalAdded}`;
                    stats.append(add);
                }
                if (totalRemoved > 0) {
                    const rem = document.createElement('span');
                    rem.className = 'theia-mobile-agent-diff-stat theia-mod-removed';
                    rem.textContent = `−${totalRemoved}`;
                    stats.append(rem);
                }
                head.append(stats);
            }
            if (entries.length >= TRANSCRIPT_EXPAND_STICKY_READ_MIN) {
                head.classList.add('theia-mod-sticky-head');
            }
            panel.append(head);
        }
        const stack = document.createElement('div');
        stack.className = 'theia-mobile-agent-activity-edit-stack';
        entries.forEach(entry => {
            stack.append(this.createTranscriptActivityEditExpandRow(entry));
        });
        panel.append(stack);
        return panel;
    }

    createTranscriptActivityEditExpandRow(entry: TranscriptActivityEditExpandEntry): HTMLElement {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'theia-mobile-agent-activity-edit-row';
        const icon = document.createElement('span');
        icon.className = `theia-mobile-agent-activity-edit-row-icon codicon ${this.transcriptFileIconClass(entry.path)}`;
        icon.setAttribute('aria-hidden', 'true');
        const info = document.createElement('span');
        info.className = 'theia-mobile-agent-activity-edit-row-info';
        const slash = entry.path.lastIndexOf('/');
        const name = document.createElement('span');
        name.className = 'theia-mobile-agent-activity-edit-row-name';
        name.textContent = slash >= 0 ? entry.path.slice(slash + 1) : entry.path;
        info.append(name);
        if (slash > 0) {
            const dir = document.createElement('span');
            dir.className = 'theia-mobile-agent-activity-edit-row-dir';
            dir.textContent = entry.path.slice(0, slash);
            info.append(dir);
        }
        const tail = document.createElement('span');
        tail.className = 'theia-mobile-agent-activity-edit-row-tail';
        const added = entry.added ?? 0;
        const removed = entry.removed ?? 0;
        if (added > 0 || removed > 0) {
            const stats = document.createElement('span');
            stats.className = 'theia-mobile-agent-activity-edit-row-stats';
            if (added > 0) {
                const add = document.createElement('span');
                add.className = 'theia-mobile-agent-diff-stat theia-mod-added';
                add.textContent = `+${added}`;
                stats.append(add);
            }
            if (removed > 0) {
                const rem = document.createElement('span');
                rem.className = 'theia-mobile-agent-diff-stat theia-mod-removed';
                rem.textContent = `−${removed}`;
                stats.append(rem);
            }
            tail.append(stats);
        }
        const reviewIcon = document.createElement('span');
        reviewIcon.className = 'theia-mobile-agent-activity-edit-row-review codicon codicon-git-compare';
        reviewIcon.setAttribute('aria-hidden', 'true');
        tail.append(reviewIcon);
        row.append(icon, info, tail);
        row.addEventListener('click', event => {
            event.stopPropagation();
            event.preventDefault();
            this.handleTranscriptReviewFileOpen(entry.path);
        });
        return row;
    }

    createTranscriptActivityRunningBadge(): HTMLElement {
        const badge = document.createElement('span');
        badge.className = 'theia-mobile-agent-activity-running-badge';
        const dot = document.createElement('span');
        dot.className = 'theia-mobile-agent-activity-running-dot';
        dot.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-activity-running-label theia-mod-shimmer';
        label.textContent = nls.localize('qaap/mobileProjects/transcriptActivityRunning', 'Running…');
        badge.append(dot, label);
        return badge;
    }

    createTranscriptActivitySearchMatchesPanel(matches: readonly TranscriptSearchMatch[]): HTMLElement {
        const panel = document.createElement('div');
        panel.className = matches.length >= 8
            ? 'theia-mobile-agent-activity-search-panel theia-mobile-agent-premium-card'
            : 'theia-mobile-agent-activity-search-panel theia-mod-single';
        const head = document.createElement('header');
        head.className = 'theia-mobile-agent-premium-head theia-mod-search';
        if (matches.length >= 8) {
            head.classList.add('theia-mod-sticky-head');
        }
        const icon = document.createElement('span');
        icon.className = 'theia-mobile-agent-premium-head-icon codicon codicon-search';
        icon.setAttribute('aria-hidden', 'true');
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-premium-head-label';
        label.textContent = nls.localize('qaap/mobileProjects/transcriptActivitySearchPanel', 'Matches');
        const count = document.createElement('span');
        count.className = 'theia-mobile-agent-premium-head-count';
        count.textContent = String(matches.length);
        head.append(icon, label, count);
        panel.append(head);
        const list = document.createElement('div');
        list.className = 'theia-mobile-agent-activity-search-stack';
        for (const match of matches) {
            const row = document.createElement('div');
            row.className = 'theia-mobile-agent-activity-search-match';
            const file = document.createElement('span');
            file.className = 'theia-mobile-agent-activity-search-match-file';
            file.textContent = match.file;
            const line = document.createElement('span');
            line.className = 'theia-mobile-agent-activity-search-match-line';
            line.textContent = String(match.line);
            const snippet = document.createElement('span');
            snippet.className = 'theia-mobile-agent-activity-search-match-snippet';
            snippet.textContent = match.snippet;
            row.append(file, line, snippet);
            list.append(row);
        }
        panel.append(list);
        return panel;
    }

    protected transcriptFileIconClass(path: string): string {
        const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
        if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'php', 'sh'].includes(ext)) {
            return 'codicon-file-code';
        }
        if (['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'env'].includes(ext)) {
            return 'codicon-settings-gear';
        }
        if (['md', 'mdx', 'txt', 'rst'].includes(ext)) {
            return 'codicon-markdown';
        }
        if (['css', 'scss', 'less', 'html', 'svg'].includes(ext)) {
            return 'codicon-symbol-color';
        }
        return 'codicon-file';
    }
}

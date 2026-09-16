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
import { TRANSCRIPT_EXPAND_STICKY_READ_MIN,TRANSCRIPT_EXPAND_STICKY_TERMINAL_MIN } from './mobile-projects-transcript-messages-tool-ui';

export function appendTranscriptShellSummaryTailExtracted(ctx: any, summary: HTMLElement,
        options: { finished: boolean; failed: boolean; copyFrom?: () => string; copyLabel?: string; showState?: boolean },): void {
        const tail = document.createElement('div');
        tail.className = 'theia-mobile-agent-shell-tail';
        if (options.showState !== false) {
            const state = document.createElement('span');
            state.className = 'theia-mobile-agent-shell-state';
            state.setAttribute('role', 'status');
            state.setAttribute('aria-label', ctx.transcriptShellStateAriaLabel(options.finished, options.failed));
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
                    void ctx.copyTranscriptShellText(text, copyBtn, tip, copyLabel);
                }
            });
            tail.append(copyBtn);
        }
        summary.append(tail);
}

export async function copyTranscriptShellTextExtracted(ctx: any, text: string,
        copyBtn: HTMLButtonElement,
        tip: HTMLElement,
        copyLabel: string,): Promise<void> {
        const copiedLabel = nls.localize('qaap/mobileProjects/transcriptShellCopied', 'Copied');
        const failedLabel = nls.localize('qaap/mobileProjects/transcriptShellCopyFailed', 'Could not copy');
        try {
            await navigator.clipboard.writeText(text);
            ctx.flashTranscriptShellCopyTooltip(copyBtn, tip, copiedLabel, copyLabel, false);
        } catch {
            ctx.flashTranscriptShellCopyTooltip(copyBtn, tip, failedLabel, copyLabel, true);
        }
}

export function flashTranscriptShellCopyTooltipExtracted(ctx: any, copyBtn: HTMLButtonElement,
        tip: HTMLElement,
        message: string,
        copyLabel: string,
        failed: boolean,): void {
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

export function createTranscriptShellDetailsExtracted(ctx: any, segment: Extract<QaapAgentMessageSegmentDTO, { type: 'tool' }>): HTMLElement {
        const details = document.createElement('details');
        details.className = 'theia-mobile-agent-shell-window theia-mobile-agent-lobe-trace-block';
        const failed = ctx.resolversUi.transcriptToolResultFailed(segment.result, segment.name);
        details.open = ctx.resolversUi.shouldOpenTranscriptToolDetails(segment);
        if (segment.finished) {
            details.classList.add(failed ? 'theia-mod-failed' : 'theia-mod-done');
        } else {
            details.classList.add('theia-mod-running');
        }

        const command = ctx.resolversUi.extractTranscriptToolCommand(segment.args)
            ?? ctx.contentUi.cleanTranscriptDisplayText(segment.args);
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
            body.append(ctx.createTranscriptClampedPre(
                ctx.resolversUi.formatTranscriptToolResult(segment.result),
                'theia-mobile-agent-shell-output',
            ));
        }
        const exitCode = segment.finished
            ? (ctx.parseTranscriptShellExitCode(segment.result) ?? (failed ? 1 : undefined))
            : undefined;
        const summary = ctx.createTranscriptShellWindowHead({
            title: command && command !== '{}'
                ? ctx.resolversUi.compactTranscriptCommand(command)
                : nls.localize('qaap/mobileProjects/transcriptShell', 'Shell'),
            finished: segment.finished,
            failed,
            exitCode,
            startedAt: segment.startedAt,
            copyFrom: () => ctx.collectTranscriptShellBodyCopyText(body),
        });
        details.append(summary, body);
        return details;
}

export function createTranscriptActivityTerminalExpandPanelExtracted(ctx: any, entries: readonly TranscriptActivityTerminalExpandEntry[],
        options?: { readonly single?: boolean },): HTMLElement {
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
            const failedCount = entries.filter(entry => ctx.isTranscriptActivityTerminalEntryFailed(entry)).length;
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
        const defaultOpenIndex = ctx.resolveTranscriptActivityTerminalDefaultOpenIndex(entries);
        entries.forEach((entry, index) => {
            stack.append(ctx.createTranscriptActivityTerminalExpandCard(entry, {
                index,
                total: entries.length,
                defaultOpen: index === defaultOpenIndex,
            }));
        });
        panel.append(stack);
        return panel;
}

export function resolveTranscriptActivityTerminalDefaultOpenIndexExtracted(ctx: any, entries: readonly TranscriptActivityTerminalExpandEntry[],): number {
        return resolveTranscriptActivityTerminalDefaultOpenIndexHelper(entries);
}

export function createTranscriptActivityTerminalExpandCardExtracted(ctx: any, entry: TranscriptActivityTerminalExpandEntry,
        options?: { readonly index?: number; readonly total?: number; readonly defaultOpen?: boolean },): HTMLElement {
        const failed = entry.failed ?? ctx.resolversUi.transcriptToolResultFailed(entry.output);
        const finished = entry.finished !== false;
        const exitCode = entry.exitCode ?? (finished ? ctx.parseTranscriptShellExitCode(entry.output) : undefined);
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
            outputWrap.append(ctx.createTranscriptClampedPre(
                ctx.resolversUi.formatTranscriptToolResult(output),
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
            ? ctx.resolversUi.compactTranscriptCommand(command)
            : nls.localize('qaap/mobileProjects/transcriptShell', 'Shell');
        let title = compactCommand;
        if (options?.total && options.total > 1 && options.index !== undefined) {
            title = `${options.index + 1}/${options.total} · ${compactCommand}`;
        }
        const summary = ctx.createTranscriptShellWindowHead({
            title,
            finished,
            failed,
            exitCode,
            copyFrom: () => ctx.collectTranscriptShellBodyCopyText(body),
        });
        summary.addEventListener('click', event => event.stopPropagation());
        details.append(summary, body);
        return details;
}

export function createTranscriptActivityReadExpandPanelExtracted(ctx: any, entries: readonly TranscriptActivityReadExpandEntry[],
        options?: { readonly single?: boolean },): HTMLElement {
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
            stack.append(ctx.createTranscriptActivityReadExpandCard(entry, {
                index,
                total: entries.length,
                defaultOpen: entries.length <= 1 || index === 0,
            }));
        });
        panel.append(stack);
        return panel;
}

export function createTranscriptActivityReadExpandCardExtracted(ctx: any, entry: TranscriptActivityReadExpandEntry,
        options?: { readonly index?: number; readonly total?: number; readonly defaultOpen?: boolean },): HTMLElement {
        const text = ctx.contentUi.cleanTranscriptDisplayText(entry.text);
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
        outputWrap.append(ctx.createTranscriptClampedBlock(codeView, lineCount));
        body.append(outputWrap);

        let title = fileName
            ?? nls.localize('qaap/mobileProjects/transcriptActivityReadUntitled', 'Read output');
        if (options?.total && options.total > 1 && options.index !== undefined) {
            title = `${options.index + 1}/${options.total} · ${title}`;
        }
        const summary = ctx.createTranscriptShellWindowHead({
            title,
            finished: true,
            failed: false,
            copyFrom: () => text,
        });
        summary.addEventListener('click', event => event.stopPropagation());
        details.append(summary, body);
        return details;
}


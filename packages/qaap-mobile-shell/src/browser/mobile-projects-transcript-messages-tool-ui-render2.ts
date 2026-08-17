// @ts-nocheck
// Extracted from mobile-projects-transcript-messages-tool-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import {
    extractAgentAuthLoginChallenge,
    type QaapAgentAuthLoginChallenge,
} from '../common/qaap-agent-auth-login';
import { detectAgentFailureKind, formatStoredAgentFailureMessage, localizeGenericAgentFailureMessage, resolveAgentTurnFailureMessage } from '../common/qaap-agent-failure-message';
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

export function renderTranscriptRichContentExtracted(ctx: any, host: HTMLElement,
        content: string,
        options?: { readonly streaming?: boolean; readonly defer?: boolean; readonly sync?: boolean },): void {
        const clean = ctx.contentUi.cleanTranscriptDisplayText(content).trim();
        if (isTranscriptTerminalOutputText(clean)) {
            if (options?.defer) {
                host.classList.add('theia-mod-deferred-terminal');
                host.textContent = clean.split('\n').slice(0, 3).join('\n');
                return;
            }
            host.replaceChildren(ctx.createTranscriptTextTerminalWindow(clean));
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
            ctx.contentUi.renderTranscriptMarkdownImmediate(host, clean);
            return;
        }
        if (options?.streaming) {
            ctx.contentUi.renderTranscriptStreamingMarkdown(host, clean, { defer: options?.defer });
            return;
        }
        ctx.contentUi.renderTranscriptMarkdown(host, clean, { defer: options?.defer });
}

export function createTranscriptAgentFailureDialogExtracted(ctx: any, error: string,
        technicalContent?: string,
        options?: {
            readonly failedToolName?: string;
            readonly onRetry?: () => void | Promise<void>;
            /** Opens the auth URL in a new browser tab (TUI-equivalent hyperlink). */
            readonly onOpenAuthUrl?: (url: string) => void;
            /** Opens the transcript terminal and starts the agent CLI login flow. */
            readonly onOpenAgentSignIn?: () => void | Promise<void>;
            readonly agentLabel?: string;
            readonly agentId?: string;
            readonly agentMessage?: {
                readonly role?: string;
                readonly content?: string;
                readonly error?: string;
                readonly segments?: unknown;
                readonly traceEvents?: unknown;
            };
        },): HTMLElement {
        const persisted = formatStoredAgentFailureMessage(error);
        const resolved = resolveAgentTurnFailureMessage(technicalContent, {
            state: 'failed',
            agentMessage: options?.agentMessage,
        });
        const generic = localizeGenericAgentFailureMessage('failed');
        const formatted = resolved && resolved !== generic
            ? resolved
            : (persisted || resolved || generic);
        const authSample = [error, technicalContent].filter(Boolean).join('\n');
        const failureKind = detectAgentFailureKind(authSample);
        const extractedChallenge = extractAgentAuthLoginChallenge(authSample, { agentId: options?.agentId });
        const authChallenge = extractedChallenge
            ?? (failureKind === 'auth' ? { mode: 'session' as const } : undefined)
            ?? (/needs you to sign in|sign in required|open the sign-in/i.test(formatted)
                ? { mode: 'session' as const }
                : undefined);
        const isQuotaFailure = !authChallenge && (failureKind === 'quota' || failureKind === 'rate_limit');
        const isCliMissing = !authChallenge && failureKind === 'cli_missing';
        const details = document.createElement('details');
        details.className = 'theia-mobile-agent-shell-window theia-mod-failed theia-mod-turn-failure';
        if (authChallenge) {
            details.classList.add('theia-mod-auth-login');
        }
        if (isQuotaFailure) {
            details.classList.add('theia-mod-quota-limit');
        }
        if (isCliMissing) {
            details.classList.add('theia-mod-cli-missing');
        }
        // Keep ordinary failures compact so a noisy backend error does not
        // dominate the transcript. Authentication, quota, and missing-CLI
        // failures expose their next-step guidance immediately.
        details.open = !!authChallenge || isQuotaFailure || isCliMissing;

        const summary = document.createElement('summary');
        summary.className = 'theia-mobile-agent-shell-head';
        summary.setAttribute('aria-label', nls.localize('qaap/mobileProjects/showFailureDetails', 'Show details'));
        const chevron = document.createElement('span');
        chevron.className = 'theia-mobile-agent-shell-chevron codicon codicon-chevron-right';
        chevron.setAttribute('aria-hidden', 'true');
        const iconWrap = document.createElement('span');
        iconWrap.className = 'theia-mobile-agent-shell-icon-wrap';
        const icon = document.createElement('span');
        icon.className = `theia-mobile-agent-shell-icon codicon ${authChallenge ? 'codicon-key' : isCliMissing ? 'codicon-desktop-download' : 'codicon-warning'}`;
        icon.setAttribute('aria-hidden', 'true');
        iconWrap.append(icon);
        const titleWrap = document.createElement('span');
        titleWrap.className = 'theia-mobile-agent-turn-failure-title-wrap';
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-shell-title';
        label.textContent = authChallenge
            ? nls.localize('qaap/mobileProjects/transcriptSignInRequired', 'Sign in required')
            : isQuotaFailure
                ? nls.localize('qaap/mobileProjects/transcriptQuotaReached', 'Quota reached')
                : isCliMissing
                    ? nls.localize('qaap/mobileProjects/transcriptAgentCliMissing', 'Agent CLI missing')
                    : nls.localize('qaap/mobileProjects/transcriptTurnFailed', 'Task failed');
        titleWrap.append(label);
        const failedToolName = options?.failedToolName?.trim();
        if (failedToolName) {
            const toolLine = document.createElement('span');
            toolLine.className = 'theia-mobile-agent-turn-failure-tool';
            toolLine.textContent = failedToolName;
            titleWrap.append(toolLine);
        }
        summary.append(chevron, iconWrap, titleWrap);
        ctx.appendTranscriptShellSummaryTail(summary, {
            finished: true,
            failed: true,
            copyFrom: () => {
                const technical = technicalContent?.trim();
                return technical && technical !== formatted
                    ? `${formatted}\n\n${ctx.contentUi.cleanTranscriptDisplayText(technical)}`
                    : formatted;
            },
        });
        if (options?.onRetry && !authChallenge) {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'theia-mobile-agent-turn-failure-summary-retry codicon codicon-refresh';
            retryBtn.textContent = nls.localize('qaap/mobileProjects/retryTask', 'Retry task');
            retryBtn.setAttribute('aria-label', retryBtn.textContent);
            retryBtn.addEventListener('click', event => {
                event.stopPropagation();
                event.preventDefault();
                void Promise.resolve(options.onRetry!());
            });
            summary.querySelector<HTMLElement>('.theia-mobile-agent-shell-tail')?.append(retryBtn);
        }

        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-shell-body';
        const message = document.createElement('p');
        message.className = 'theia-mobile-agent-turn-failure-message';
        message.textContent = formatted;
        body.append(message);

        if (authChallenge) {
            body.append(ctx.createTranscriptAgentAuthLoginCard(authChallenge, options));
        } else if (isQuotaFailure) {
            const hint = document.createElement('p');
            hint.className = 'theia-mobile-agent-auth-login-hint';
            hint.textContent = nls.localize(
                'qaap/mobileProjects/quotaLimitHint',
                'Pick another model or effort in the composer, then retry. We do not change effort automatically.',
            );
            body.append(hint);
        }

        const technical = technicalContent?.trim();
        if (technical && technical !== formatted && technical !== error.trim()) {
            // Hide raw URL/code lines already shown in the sign-in card.
            const cleanedTechnical = ctx.contentUi.cleanTranscriptDisplayText(technical);
            const hideTechnical = !!authChallenge?.url
                && cleanedTechnical.split('\n').every(line => {
                    const trimmed = line.trim();
                    return !trimmed
                        || (authChallenge.url !== undefined && trimmed.includes(authChallenge.url))
                        || (authChallenge.userCode !== undefined && trimmed.includes(authChallenge.userCode))
                        || /^code:\s*/i.test(trimmed);
                });
            if (!hideTechnical) {
                body.append(ctx.createTranscriptClampedPre(
                    cleanedTechnical,
                    'theia-mobile-agent-shell-output',
                ));
            }
        }
        details.append(summary, body);
        return details;
}

export function createTranscriptAgentAuthLoginCardExtracted(ctx: any, challenge: QaapAgentAuthLoginChallenge,
        options?: {
            readonly onOpenAuthUrl?: (url: string) => void;
            readonly onOpenAgentSignIn?: () => void | Promise<void>;
            readonly onRetry?: () => void | Promise<void>;
            readonly agentLabel?: string;
            readonly agentId?: string;
        },): HTMLElement {
        const card = document.createElement('div');
        card.className = 'theia-mobile-agent-auth-login-card';

        const hint = document.createElement('p');
        hint.className = 'theia-mobile-agent-auth-login-hint';
        if (challenge.mode === 'api_key') {
            hint.textContent = nls.localize(
                'qaap/mobileProjects/authLoginApiKeyHint',
                'Add or refresh the API key in Settings, then retry.',
            );
        } else if (challenge.url) {
            hint.textContent = nls.localize(
                'qaap/mobileProjects/authLoginUrlHint',
                'Open the sign-in page, authorize the agent, then retry this task.',
            );
        } else {
            hint.textContent = nls.localize(
                'qaap/mobileProjects/authLoginTerminalHint',
                'Open the agent terminal to complete sign-in (same as the agent TUI), then retry.',
            );
        }
        card.append(hint);

        if (challenge.userCode) {
            const codeRow = document.createElement('div');
            codeRow.className = 'theia-mobile-agent-auth-login-code-row';
            const codeLabel = document.createElement('span');
            codeLabel.className = 'theia-mobile-agent-auth-login-code-label';
            codeLabel.textContent = nls.localize('qaap/mobileProjects/authLoginCodeLabel', 'One-time code');
            const codeValue = document.createElement('code');
            codeValue.className = 'theia-mobile-agent-auth-login-code';
            codeValue.textContent = challenge.userCode;
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'theia-mobile-agent-auth-login-copy codicon codicon-copy';
            copyBtn.textContent = nls.localizeByDefault('Copy');
            copyBtn.addEventListener('click', event => {
                event.stopPropagation();
                event.preventDefault();
                void navigator.clipboard?.writeText(challenge.userCode!).then(() => {
                    copyBtn.classList.remove('codicon-copy');
                    copyBtn.classList.add('codicon-check');
                    copyBtn.textContent = nls.localize('qaap/mobileProjects/authLoginCopied', 'Copied');
                    window.setTimeout(() => {
                        copyBtn.classList.add('codicon-copy');
                        copyBtn.classList.remove('codicon-check');
                        copyBtn.textContent = nls.localizeByDefault('Copy');
                    }, 1800);
                }).catch(() => undefined);
            });
            codeRow.append(codeLabel, codeValue, copyBtn);
            card.append(codeRow);
        }

        const actions = document.createElement('div');
        actions.className = 'theia-mobile-agent-auth-login-actions';

        if (challenge.url) {
            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'theia-mobile-agent-auth-login-action theia-mod-primary codicon codicon-link-external';
            openBtn.textContent = nls.localize('qaap/mobileProjects/authLoginOpenUrl', 'Open sign-in page');
            openBtn.addEventListener('click', event => {
                event.stopPropagation();
                event.preventDefault();
                if (options?.onOpenAuthUrl) {
                    options.onOpenAuthUrl(challenge.url!);
                    return;
                }
                window.open(challenge.url!, '_blank', 'noopener,noreferrer');
            });
            actions.append(openBtn);

            const urlLine = document.createElement('a');
            urlLine.className = 'theia-mobile-agent-auth-login-url';
            urlLine.href = challenge.url;
            urlLine.target = '_blank';
            urlLine.rel = 'noopener noreferrer';
            urlLine.textContent = challenge.url;
            urlLine.addEventListener('click', event => {
                event.stopPropagation();
                if (options?.onOpenAuthUrl) {
                    event.preventDefault();
                    options.onOpenAuthUrl(challenge.url!);
                }
            });
            card.append(urlLine);
        }

        if (options?.onOpenAgentSignIn && challenge.mode !== 'api_key') {
            const terminalBtn = document.createElement('button');
            terminalBtn.type = 'button';
            terminalBtn.className = 'theia-mobile-agent-auth-login-action codicon codicon-terminal';
            terminalBtn.textContent = options.agentLabel
                ? nls.localize(
                    'qaap/mobileProjects/authLoginOpenTerminalNamed',
                    'Sign in with {0} in terminal',
                    options.agentLabel,
                )
                : nls.localize('qaap/mobileProjects/authLoginOpenTerminal', 'Sign in in terminal');
            terminalBtn.addEventListener('click', event => {
                event.stopPropagation();
                event.preventDefault();
                void Promise.resolve(options.onOpenAgentSignIn!());
            });
            actions.append(terminalBtn);
        }

        if (options?.onRetry) {
            const retryBtn = document.createElement('button');
            retryBtn.type = 'button';
            retryBtn.className = 'theia-mobile-agent-auth-login-action theia-mod-retry codicon codicon-refresh';
            retryBtn.textContent = nls.localize('qaap/mobileProjects/retryTask', 'Retry task');
            retryBtn.addEventListener('click', event => {
                event.stopPropagation();
                event.preventDefault();
                void Promise.resolve(options.onRetry!());
            });
            actions.append(retryBtn);
        }

        if (actions.childElementCount > 0) {
            card.append(actions);
        }
        return card;
}

export function createTranscriptTextTerminalWindowExtracted(ctx: any, content: string): HTMLElement {
        const details = document.createElement('details');
        const failed = isTranscriptErrorOutput(content);
        details.className = `theia-mobile-agent-shell-window ${failed ? 'theia-mod-failed' : 'theia-mod-done'} theia-mod-text-output`;
        details.open = shouldOpenTranscriptToolDetailsSegment({ finished: true, resultFailed: failed });
        const cleanContent = ctx.contentUi.cleanTranscriptDisplayText(content);
        const body = document.createElement('div');
        body.className = 'theia-mobile-agent-shell-body';
        body.append(ctx.createTranscriptClampedPre(cleanContent, 'theia-mobile-agent-shell-output'));
        const summary = ctx.createTranscriptShellWindowHead({
            title: failed
                ? nls.localize('qaap/mobileProjects/transcriptErrorOutput', 'Error output')
                : nls.localize('qaap/mobileProjects/transcriptTerminalOutput', 'Terminal output'),
            finished: true,
            failed,
            exitCode: failed
                ? (ctx.parseTranscriptShellExitCode(cleanContent) ?? 1)
                : ctx.parseTranscriptShellExitCode(cleanContent),
            copyFrom: () => ctx.collectTranscriptShellBodyCopyText(body),
        });
        details.append(summary, body);
        return details;
}

export function createTranscriptSegmentDetailsExtracted(ctx: any, segment: QaapAgentMessageSegmentDTO,
        options?: { readonly defer?: boolean; readonly streaming?: boolean },): HTMLElement {
        if (segment.type === 'thinking') {
            const isStreaming = !!options?.streaming;
            const details = document.createElement('details');
            details.className = 'theia-mobile-agent-transcript-details theia-mod-thinking theia-mobile-agent-lobe-trace-block';
            // This branch renders archived thinking segments inside the
            // "Technical details" card (createTranscriptTechnicalDetailsCard),
            // which is only built for settled conversations — streaming never
            // reaches here. The live open-while-thinking / auto-collapse-on-settle
            // behaviour lives in createTranscriptThoughtBriefBlock instead.
            details.open = false;
            const summary = document.createElement('summary');
            summary.className = 'theia-mobile-agent-lobe-inspector';
            const indicator = ctx.createTranscriptTraceStatusIndicator({
                finished: !isStreaming,
                failed: false,
                kind: 'thinking',
            });
            if (isStreaming) {
                indicator.classList.add('theia-mod-thinking');
            }
            const title = document.createElement('span');
            title.className = 'theia-mobile-agent-thought-brief-title theia-mobile-agent-lobe-thinking-title';
            if (isStreaming) {
                title.classList.add('theia-mod-shimmer');
            }
            // LobeHub i18n keys: Thinking.thinking = "Deep Thinking...",
            // Thinking.thoughtWithDuration = "Deeply Thought". Kept in sync
            // with the streaming thought brief (refreshTranscriptThoughtBriefTitle)
            // and the IDE React renderer (QaapLobehubThinkingRenderer).
            title.textContent = isStreaming
                ? nls.localize('qaap/lobehub/thinking/thinking', 'Deep Thinking...')
                : nls.localize('qaap/lobehub/thinking/thought', 'Deeply Thought');
            const chevron = document.createElement('span');
            chevron.className = 'theia-mobile-agent-tool-chevron codicon codicon-chevron-right';
            chevron.setAttribute('aria-hidden', 'true');
            summary.append(indicator, title, chevron);
            const body = document.createElement('div');
            body.className = 'theia-mobile-agent-lobe-thinking-scroll';
            const content = document.createElement('div');
            content.className = 'theia-mobile-agent-thought-brief-body theia-mobile-agent-lobe-thinking-content';
            content.textContent = ctx.contentUi.cleanTranscriptDisplayText(segment.content);
            body.append(content);
            details.append(summary, body);
            return details;
        }
        if (segment.type === 'tool') {
            if (ctx.resolversUi.isTranscriptShellTool(segment.name)) {
                return ctx.createTranscriptShellDetails(segment);
            }
            if (isTranscriptWebSearchTool(segment.name)) {
                const payload = resolveTranscriptWebSearchPayload(segment);
                return createTranscriptWebSearchCard(payload, {
                    open: !segment.finished || payload.sites.length > 0,
                });
            }
            return ctx.createTranscriptToolWindow(segment, options);
        }
        const block = document.createElement('div');
        block.className = 'theia-mobile-agent-transcript-content';
        ctx.renderTranscriptRichContent(block, segment.content ?? '', {
            defer: options?.defer,
            streaming: options?.streaming,
        });
        return block;
}

export function createTranscriptClampedPreExtracted(ctx: any, text: string, className: string): HTMLElement {
        const pre = document.createElement('pre');
        pre.className = className;
        pre.textContent = text;
        return ctx.createTranscriptClampedBlock(pre, text.split('\n').length);
}

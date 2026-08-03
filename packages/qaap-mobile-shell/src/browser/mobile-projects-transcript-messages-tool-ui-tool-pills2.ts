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
import { TRANSCRIPT_EXPAND_STICKY_READ_MIN } from './mobile-projects-transcript-messages-tool-ui';

export function createTranscriptActivityEditExpandPanelExtracted(ctx: any, entries: readonly TranscriptActivityEditExpandEntry[],
        options?: { readonly single?: boolean },): HTMLElement {
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
            stack.append(ctx.createTranscriptActivityEditExpandRow(entry));
        });
        panel.append(stack);
        return panel;
}

export function createTranscriptActivityEditExpandRowExtracted(ctx: any, entry: TranscriptActivityEditExpandEntry): HTMLElement {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'theia-mobile-agent-activity-edit-row';
        const icon = document.createElement('span');
        icon.className = `theia-mobile-agent-activity-edit-row-icon codicon ${ctx.transcriptFileIconClass(entry.path)}`;
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
            ctx.handleTranscriptReviewFileOpen(entry.path);
        });
        return row;
}

export function createTranscriptActivityRunningBadgeExtracted(ctx: any): HTMLElement {
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

export function createTranscriptActivitySearchMatchesPanelExtracted(ctx: any, matches: readonly TranscriptSearchMatch[]): HTMLElement {
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


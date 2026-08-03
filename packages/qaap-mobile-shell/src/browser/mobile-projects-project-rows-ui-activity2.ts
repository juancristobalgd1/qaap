// @ts-nocheck
// Extracted from mobile-projects-project-rows-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { conversationTurnProgressRatio } from '../common/qaap-agent-conversation-list-metrics';
import {
    isConversationAutoApproveEnabled,
    type QaapAgentConversationSummaryDTO,
} from '../common/qaap-agent-conversation-client';
import { resolveQaapAgentTaskVisualStatus, type QaapAgentTaskVisualStatus } from '../common/qaap-agent-task-visual-status';
import { buildWorkHubInboxRowFingerprintFromSummary } from '../common/qaap-work-hub-inbox-fingerprint';
import {
    QAAP_INBOX_ROW_FP_ATTR,
    QAAP_INBOX_ROW_ID_ATTR,
} from './mobile-projects-hub-incremental-ui';
import { SHELL_AGENT_ID } from '../common/qaap-agent-task-client';
import { formatConversationComposerSessionMeta } from '../common/qaap-conversation-composer-state';
import { readStoredComposerSurface, type QaapComposerSurface } from '../common/qaap-composer-surface';
import { createAgentTaskBadge, createAgentTaskVerificationBadge } from './qaap-agent-ui';
import { sharedSecondTicker } from './qaap-shared-elapsed-ticker';
import type { MobileProjectsActiveTasks, MobileProjectTaskView } from './mobile-projects-active-tasks';
import type { MobileProjectsService } from './mobile-projects-service';
import { mobileProjectInitials, type MobileProjectEntry, type MobileProjectsHubView } from './mobile-projects-types';
import { attachSwipeToDelete } from './qaap-mobile-swipe-to-delete';

export function patchSidebarCompactTaskRowExtracted(ctx: any, row: HTMLElement,
        project: MobileProjectEntry,
        task: MobileProjectTaskView,
        summary: QaapAgentConversationSummaryDTO,
        options?: { readonly isCurrent?: boolean },): boolean {
        if (!row.classList.contains('theia-mod-sidebar-compact') || row.dataset.qaapConversationId !== summary.id) {
            return false;
        }
        return ctx.patchWorkHubTaskRowContent(row, task, summary, options);
}

export function patchWorkHubTaskRowExtracted(ctx: any, row: HTMLElement,
        project: MobileProjectEntry,
        task: MobileProjectTaskView,
        summary: QaapAgentConversationSummaryDTO,
        options?: { readonly isCurrent?: boolean },): boolean {
        if (row.dataset.qaapConversationId !== summary.id) {
            return false;
        }
        if (row.classList.contains('theia-mod-sidebar-compact')) {
            return ctx.patchSidebarCompactTaskRow(row, project, task, summary, options);
        }
        const unread = ctx.host.conversationIndexUi.isConversationUnread(summary);
        const visualStatus = resolveQaapAgentTaskVisualStatus(task, summary, unread);
        const isRunning = visualStatus.id === 'running';
        const hasProgress = !!row.querySelector('.theia-mobile-projects-task-progress');
        if (isRunning !== hasProgress) {
            return false;
        }
        return ctx.patchWorkHubTaskRowContent(row, task, summary, options, { isRunning });
}

export function patchWorkHubTaskRowContentExtracted(ctx: any, row: HTMLElement,
        task: MobileProjectTaskView,
        summary: QaapAgentConversationSummaryDTO,
        options?: { readonly isCurrent?: boolean },
        state?: { readonly isRunning?: boolean },): boolean {
        row.classList.toggle('theia-mod-current', !!options?.isCurrent);
        const titleEl = row.querySelector<HTMLElement>('.theia-mobile-projects-task-title');
        if (titleEl && titleEl.textContent !== task.title) {
            titleEl.textContent = task.title;
        }
        const sinceEl = row.querySelector<HTMLElement>('.theia-mobile-projects-task-since');
        if (sinceEl) {
            const sinceText = ctx.formatTaskSince(task, summary);
            if (sinceEl.textContent !== sinceText) {
                sinceEl.textContent = sinceText;
            }
        }
        const metaEl = row.querySelector<HTMLElement>('.theia-mobile-projects-task-foot.theia-mod-sidebar-compact-meta');
        const sessionMeta = formatConversationComposerSessionMeta(summary, agentId => ctx.resolveConversationAgentLabel({
            ...summary,
            agentId,
        }));
        if (metaEl && sessionMeta && metaEl.textContent !== sessionMeta) {
            metaEl.textContent = sessionMeta;
        }
        const isRunning = state?.isRunning ?? resolveQaapAgentTaskVisualStatus(
            task,
            summary,
            ctx.host.conversationIndexUi.isConversationUnread(summary),
        ).id === 'running';
        if (isRunning) {
            const progressHost = row.querySelector<HTMLElement>('.theia-mobile-projects-task-progress');
            if (!progressHost) {
                return false;
            }
            ctx.renderConversationTurnProgress(progressHost, summary);
            const progressCount = row.querySelector<HTMLElement>('.theia-mobile-projects-task-progress-count');
            if (summary.turnProgressTotal && summary.turnProgressCurrent !== undefined) {
                if (!progressCount) {
                    return false;
                }
                const countText = `${summary.turnProgressCurrent}/${summary.turnProgressTotal}`;
                if (progressCount.textContent !== countText) {
                    progressCount.textContent = countText;
                }
            } else if (progressCount) {
                return false;
            }
        }
        // Non-compact rows carry a foot with diff (+N/-N), activity and message-count metrics that
        // are NOT covered by the checks above; refresh it in place when its signature changed so a
        // patched row doesn't strand the values it was first rendered with. The compact foot
        // (`theia-mod-sidebar-compact-meta`) is handled by the meta branch above and excluded here.
        const footRow = row.querySelector<HTMLElement>(
            '.theia-mobile-projects-task-foot:not(.theia-mod-sidebar-compact-meta)');
        if (footRow) {
            const footFp = ctx.computeTaskFootFingerprint(task, summary, isRunning);
            if (footRow.dataset.qaapFootFp !== footFp) {
                ctx.populateWorkHubTaskFootRow(footRow, task, summary, isRunning);
            }
        }
        // Re-register the elapsed labels with the fresh task/summary so the shared ticker keeps
        // advancing "since"/"ran" off the latest anchors (and drops "ran" when it stops running).
        ctx.registerTaskElapsedTickers(row, task, summary, isRunning);
        return true;
}

export function registerTaskElapsedTickersExtracted(ctx: any, row: HTMLElement,
        task: MobileProjectTaskView,
        summary: QaapAgentConversationSummaryDTO | undefined,
        isRunning: boolean,): void {
        const since = row.querySelector<HTMLElement>('.theia-mobile-projects-task-since');
        if (since) {
            sharedSecondTicker.register({
                element: since,
                render: () => {
                    const text = ctx.formatTaskSince(task, summary);
                    if (since.textContent !== text) {
                        since.textContent = text;
                    }
                },
            });
        }
        // "ran" is only live while the turn is running (turnStartedAt + now); a finished row shows a
        // frozen duration and never needs ticking.
        const ran = row.querySelector<HTMLElement>('.theia-mobile-projects-task-ran');
        if (ran) {
            if (isRunning && summary) {
                sharedSecondTicker.register({
                    element: ran,
                    render: () => {
                        const text = ctx.formatConversationRunDuration(summary, true);
                        if (text && ran.textContent !== text) {
                            ran.textContent = text;
                        }
                    },
                });
            } else {
                sharedSecondTicker.unregister(ran);
            }
        }
}

export function formatTaskSinceExtracted(ctx: any, task: MobileProjectTaskView, summary?: QaapAgentConversationSummaryDTO): string {
        const anchor = task.state === 'running'
            ? task.createdAt
            : (task.finishedAt ?? summary?.updatedAt ?? task.createdAt);
        if (!anchor) {
            return '';
        }
        const diff = Math.max(0, Date.now() - anchor);
        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (task.state === 'running' && diff < 45 * 1000) {
            return nls.localize('qaap/mobileProjects/taskSinceNow', 'just now');
        }
        if (diff < hour) {
            return nls.localize('qaap/mobileProjects/taskSinceMinutes', '{0} min', String(Math.max(1, Math.round(diff / minute))));
        }
        if (diff < day) {
            return nls.localize('qaap/mobileProjects/taskSinceHours', '{0} h', String(Math.round(diff / hour)));
        }
        return nls.localize('qaap/mobileProjects/taskSinceDays', '{0} d', String(Math.round(diff / day)));
}

export function appendTaskFootSeparatorExtracted(ctx: any, footRow: HTMLElement): void {
        const sep = document.createElement('span');
        sep.className = 'theia-mobile-projects-task-foot-sep';
        sep.textContent = '·';
        footRow.append(sep);
}

export function populateWorkHubTaskFootRowExtracted(ctx: any, footRow: HTMLElement,
        task: MobileProjectTaskView,
        summary: QaapAgentConversationSummaryDTO | undefined,
        isRunning: boolean,): void {
        footRow.replaceChildren();
        const agentLabel = ctx.resolveConversationAgentLabel(summary);
        const sessionMeta = summary
            ? formatConversationComposerSessionMeta(summary, agentId => ctx.resolveConversationAgentLabel({
                ...summary,
                agentId,
            }))
            : undefined;
        const agentId = summary?.agentId?.trim()
            || ctx.host.activeTasks?.getDefaultAgent()
            || SHELL_AGENT_ID;
        const agentChip = createAgentTaskBadge({
            agentId,
            label: sessionMeta ?? agentLabel,
        });
        footRow.append(agentChip);
        if (summary?.linkedPullRequest?.number) {
            const prChip = document.createElement('span');
            prChip.className = 'theia-mobile-projects-task-agent theia-mod-linked-pr';
            prChip.textContent = nls.localize(
                'qaap/mobileProjects/inboxLinkedPrShort',
                '#{0}',
                String(summary.linkedPullRequest.number),
            );
            footRow.append(prChip);
        }
        ctx.appendConversationFootMetrics(footRow, summary, isRunning);

        const verifyBadge = createAgentTaskVerificationBadge(task.verification);
        if (verifyBadge) {
            ctx.appendTaskFootSeparator(footRow);
            footRow.append(verifyBadge);
        }

        if (summary && summary.messageCount > 0 && !ctx.hasConversationDiffStats(summary)) {
            ctx.appendTaskFootSeparator(footRow);
            const msgCount = document.createElement('span');
            msgCount.className = 'theia-mobile-projects-task-message-count';
            msgCount.textContent = String(summary.messageCount);
            const msgLabel = summary.messageCount === 1
                ? nls.localize('qaap/mobileProjects/taskMessageOne', '1 message')
                : nls.localize('qaap/mobileProjects/taskMessageMany', '{0} messages', String(summary.messageCount));
            msgCount.setAttribute('aria-label', msgLabel);
            msgCount.title = msgLabel;
            footRow.append(msgCount);
        }
        footRow.dataset.qaapFootFp = ctx.computeTaskFootFingerprint(task, summary, isRunning);
}

export function computeTaskFootFingerprintExtracted(ctx: any, task: MobileProjectTaskView,
        summary: QaapAgentConversationSummaryDTO | undefined,
        isRunning: boolean,): string {
        return [
            isRunning ? 1 : 0,
            isRunning ? (summary?.activityLabel ?? '') : '',
            summary?.linesAdded ?? '',
            summary?.linesRemoved ?? '',
            summary?.linkedPullRequest?.number ?? '',
            summary?.messageCount ?? '',
            summary?.agentId ?? '',
            task.verification?.status ?? '',
        ].join('|');
}

export function appendConversationFootMetricsExtracted(ctx: any, footRow: HTMLElement,
        summary: QaapAgentConversationSummaryDTO | undefined,
        isRunning: boolean,): void {
        if (!summary) {
            return;
        }
        if (isRunning && summary.activityLabel) {
            ctx.appendTaskFootSeparator(footRow);
            const activity = document.createElement('span');
            activity.className = 'theia-mobile-projects-task-activity';
            activity.textContent = ctx.localizeActivityLabel(summary.activityLabel);
            footRow.append(activity);
        }
        if (ctx.hasConversationDiffStats(summary)) {
            ctx.appendConversationDiffFoot(footRow, summary);
        }
        const ranLabel = ctx.formatConversationRunDuration(summary, isRunning);
        if (ranLabel) {
            ctx.appendTaskFootSeparator(footRow);
            const ran = document.createElement('span');
            ran.className = 'theia-mobile-projects-task-ran';
            ran.textContent = ranLabel;
            footRow.append(ran);
        }
}

export function localizeActivityLabelExtracted(ctx: any, label: string): string {
        switch (label) {
            case 'Searching':
                return nls.localize('qaap/mobileProjects/activitySearching', 'Searching');
            case 'Thinking':
                return nls.localize('qaap/mobileProjects/activityThinking', 'Thinking');
            case 'Reading files':
                return nls.localize('qaap/mobileProjects/activityReading', 'Reading files');
            case 'Running command':
                return nls.localize('qaap/mobileProjects/activityRunningCommand', 'Running command');
            case 'Editing':
                return nls.localize('qaap/mobileProjects/activityEditing', 'Editing');
            case 'Working':
                return nls.localize('qaap/mobileProjects/taskPreviewWorking', 'Working…');
            default:
                return label;
        }
}

export function hasConversationDiffStatsExtracted(ctx: any, summary?: QaapAgentConversationSummaryDTO): boolean {
        if (!summary) {
            return false;
        }
        return (summary.linesAdded ?? 0) > 0 || (summary.linesRemoved ?? 0) > 0;
}

export function appendConversationDiffFootExtracted(ctx: any, footRow: HTMLElement, summary: QaapAgentConversationSummaryDTO): void {
        const added = summary.linesAdded ?? 0;
        const removed = summary.linesRemoved ?? 0;
        ctx.appendTaskFootSeparator(footRow);
        const diff = document.createElement('span');
        diff.className = 'theia-mobile-projects-task-diff';
        const addedSpan = document.createElement('span');
        addedSpan.className = 'theia-mobile-projects-task-diff-added';
        addedSpan.textContent = `+${added}`;
        const removedSpan = document.createElement('span');
        removedSpan.className = 'theia-mobile-projects-task-diff-removed';
        removedSpan.textContent = `−${removed}`;
        diff.append(addedSpan, removedSpan);
        footRow.append(diff);
}

export function formatConversationRunDurationExtracted(ctx: any, summary: QaapAgentConversationSummaryDTO,
        isRunning: boolean,): string | undefined {
        let durationMs: number | undefined;
        if (isRunning && summary.turnStartedAt) {
            durationMs = Math.max(0, Date.now() - summary.turnStartedAt);
        } else if (summary.lastTurnDurationMs) {
            durationMs = summary.lastTurnDurationMs;
        }
        if (durationMs === undefined || durationMs < 1000) {
            return undefined;
        }
        return ctx.formatDurationShort(durationMs);
}

export function formatDurationShortExtracted(ctx: any, durationMs: number): string {
        const minute = 60_000;
        const hour = 60 * minute;
        const day = 24 * hour;
        if (durationMs < minute) {
            return nls.localize(
                'qaap/mobileProjects/durationSeconds',
                '{0}s',
                String(Math.max(1, Math.round(durationMs / 1000))),
            );
        }
        if (durationMs < hour) {
            return nls.localize(
                'qaap/mobileProjects/durationMinutes',
                '{0}m',
                String(Math.max(1, Math.round(durationMs / minute))),
            );
        }
        if (durationMs < day) {
            return nls.localize(
                'qaap/mobileProjects/durationHours',
                '{0}h',
                String(Math.round(durationMs / hour)),
            );
        }
        return nls.localize(
            'qaap/mobileProjects/durationDays',
            '{0}d',
            String(Math.round(durationMs / day)),
        );
}

export function resolveConversationAgentLabelExtracted(ctx: any, summary?: QaapAgentConversationSummaryDTO): string {
        const raw = summary?.agentId?.trim();
        // 'task' is the idle-placeholder sentinel (buildAgentsHubIdleConversationSummary), not a
        // real agent — rendering it produced a confusing "@task" chip on optimistic rows.
        const agentId = (raw && raw !== 'task' ? raw : undefined)
            || ctx.host.activeTasks?.getDefaultAgent()
            || SHELL_AGENT_ID;
        const fromList = ctx.host.activeTasks?.getAgents().find(a => a.id === agentId)?.label;
        if (fromList) {
            return fromList;
        }
        if (agentId === 'chat') {
            return nls.localize('qaap/mobileProjects/agentChat', 'Chat');
        }
        return agentId.startsWith('@') ? agentId : `@${agentId}`;
}


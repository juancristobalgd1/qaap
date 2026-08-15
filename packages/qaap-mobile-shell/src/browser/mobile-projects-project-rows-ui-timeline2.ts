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
import { createAgentTaskBadge, createAgentTaskVerificationBadge, createAgentIdentityElement } from './qaap-agent-ui';
import { sharedSecondTicker } from './qaap-shared-elapsed-ticker';
import type { MobileProjectsActiveTasks, MobileProjectTaskView } from './mobile-projects-active-tasks';
import type { MobileProjectsService } from './mobile-projects-service';
import { mobileProjectInitials, type MobileProjectEntry, type MobileProjectsHubView } from './mobile-projects-types'; import { attachSwipeToDelete } from './qaap-mobile-swipe-to-delete';

export function createTaskItemExtracted(ctx: any, project: MobileProjectEntry,
    task: MobileProjectTaskView,
    _activeInfo: ReturnType<MobileProjectsActiveTasks['getForCwd']>,
    summary?: QaapAgentConversationSummaryDTO,
    parentIds: ReadonlySet<string> = new Set<string>(),
    options?: { onActivate?: () => void; compact?: boolean; failedDuplicateCount?: number; selection?: { selected: boolean; onToggle: () => void } },): HTMLElement {
    const compact = options?.compact === true;
    const failedDuplicateCount = options?.failedDuplicateCount ?? 0;
    const selection = options?.selection;
    const row = document.createElement('div');
    row.className = 'theia-mobile-projects-task-row';
    if (compact) {
        row.classList.add('theia-mod-sidebar-compact');
    }
    if (selection) {
        row.classList.add('theia-mod-clear-failed-select');
    }
    if (summary) {
        row.dataset.qaapConversationId = summary.id;
    }
    if (summary && ctx.host.transcriptOpenSummaryId === summary.id) {
        row.classList.add('theia-mod-current');
    }

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'theia-mobile-projects-task-item';
    const isUnread = summary ? ctx.host.conversationIndexUi.isConversationUnread(summary) : false;
    const visualStatus = resolveQaapAgentTaskVisualStatus(task, summary, isUnread);
    const isRunning = visualStatus.id === 'running';
    const needsInput = visualStatus.id === 'needs-you';
    const isDone = visualStatus.id === 'verified' || visualStatus.id === 'pr-merged';
    const isFailed = visualStatus.id === 'failed';
    const stateColor = visualStatus.color;
    if (ctx.host.justAddedTaskId === task.id) {
        item.classList.add('theia-mod-flash');
    }
    if (isDone) {
        item.classList.add('theia-mod-done');
    }
    if (needsInput) {
        item.classList.add('theia-mod-needs-input');
    }

    const lineage = summary ? ctx.host.conversationIndexUi.resolveConversationLineage(summary, parentIds) : 'none';
    const taskDot = document.createElement('span');
    const showLineageGlyph = lineage !== 'none' && !isFailed && !isRunning && !needsInput;
    if (showLineageGlyph) {
        // Fork lineage: one glyph size for all roles; color + tooltip carry parent/child/both.
        taskDot.className = `theia-mobile-projects-task-lineage theia-mod-${lineage}`;
        taskDot.append(ctx.createTaskLeadingGlyph('codicon-repo-forked'));
        taskDot.setAttribute('aria-hidden', 'true');
        const lineageLabel = lineage === 'parent'
            ? nls.localize('qaap/mobileProjects/lineageParent', 'Forked into other tasks')
            : lineage === 'child'
                ? nls.localize('qaap/mobileProjects/lineageChild', 'Forked from another task')
                : nls.localize('qaap/mobileProjects/lineageBoth', 'Forked from another task and into others');
        taskDot.title = lineageLabel;
    } else if (visualStatus.iconClass && !isRunning) {
        taskDot.className = `theia-mobile-projects-task-dot ${visualStatus.className}`;
        if (visualStatus.gitPr) {
            taskDot.classList.add('theia-mod-git-pr');
        }
        taskDot.append(ctx.createTaskLeadingGlyph(visualStatus.iconClass));
        const statusLabel = nls.localize(visualStatus.labelKey, visualStatus.label);
        taskDot.setAttribute('aria-label', statusLabel);
        taskDot.title = statusLabel;
    } else if (isRunning) {
        ctx.renderConversationTurnProgress(taskDot, summary);
    } else {
        taskDot.className = `theia-mobile-projects-task-dot ${visualStatus.className}`;
        taskDot.style.background = stateColor;
    }

    const taskBody = document.createElement('div');
    taskBody.className = 'theia-mobile-projects-task-body';

    const taskTitleRow = document.createElement('div');
    taskTitleRow.className = 'theia-mobile-projects-task-title-row';
    const taskTitle = document.createElement('span');
    taskTitle.className = 'theia-mobile-projects-task-title';
    taskTitle.textContent = task.title;
    const taskSince = document.createElement('span');
    taskSince.className = 'theia-mobile-projects-task-since';
    taskSince.textContent = ctx.formatTaskSince(task, summary);
    if (failedDuplicateCount > 0) {
        const dupHint = nls.localize(
            'qaap/sessionsSidebar/failedDuplicatesHint',
            '{0} older failed runs with this title are hidden — Clear failed runs to select which to delete',
            String(failedDuplicateCount),
        );
        taskTitle.title = dupHint;
        const badge = document.createElement('span');
        badge.className = 'theia-mobile-projects-task-failed-dup-badge';
        badge.textContent = `+${failedDuplicateCount}`;
        badge.title = dupHint;
        badge.setAttribute('aria-label', dupHint);
        taskTitleRow.append(taskTitle, badge);
    } else if (!compact && isRunning && summary?.turnProgressTotal && summary.turnProgressCurrent !== undefined) {
        const progressCount = document.createElement('span');
        progressCount.className = 'theia-mobile-projects-task-progress-count';
        progressCount.textContent = `${summary.turnProgressCurrent}/${summary.turnProgressTotal}`;
        const progressLabel = nls.localize(
            'qaap/mobileProjects/taskProgressSteps',
            '{0} of {1} steps',
            String(summary.turnProgressCurrent),
            String(summary.turnProgressTotal),
        );
        progressCount.setAttribute('aria-label', progressLabel);
        progressCount.title = progressLabel;
        taskTitleRow.append(taskTitle, progressCount);
    } else {
        taskTitleRow.append(taskTitle);
    }
    taskBody.append(taskTitleRow);

    const sessionMeta = summary
        ? formatConversationComposerSessionMeta(summary, agentId => ctx.resolveConversationAgentLabel({
            ...summary,
            agentId,
        }))
        : undefined;

    if (compact && summary?.agentId) {
        const metaRow = document.createElement('div');
        metaRow.className = 'theia-mobile-projects-task-foot theia-mod-sidebar-compact-meta';
        const model = summary.agentModel ?? summary.qaiqModel;
        const modelId = model?.modelId?.trim();
        const identity = createAgentIdentityElement({
            agentId: summary.agentId,
            agentModel: modelId ? model : undefined,
            label: modelId ?? undefined,
            iconSize: 'sm',
        });
        identity.classList.add('theia-mobile-projects-task-foot-meta-identity');
        metaRow.append(identity, taskSince);
        taskBody.append(metaRow);
    } else if (compact && sessionMeta) {
        const metaRow = document.createElement('div');
        metaRow.className = 'theia-mobile-projects-task-foot theia-mod-sidebar-compact-meta';
        const metaLabel = document.createElement('span');
        metaLabel.className = 'theia-mobile-projects-task-foot-meta-label';
        metaLabel.textContent = sessionMeta;
        metaRow.append(metaLabel, taskSince);
        taskBody.append(metaRow);
    } else if (compact) {
        const metaRow = document.createElement('div');
        metaRow.className = 'theia-mobile-projects-task-foot theia-mod-sidebar-compact-meta';
        metaRow.append(taskSince);
        taskBody.append(metaRow);
    }

    if (!compact) {
        const footRow = document.createElement('div');
        footRow.className = 'theia-mobile-projects-task-foot';
        ctx.populateWorkHubTaskFootRow(footRow, task, summary, isRunning);
        taskBody.append(footRow);
        const activityRow = ctx.createConversationActivityRow(project, summary, {
            isRunning,
            needsInput,
            isDone,
        });
        if (activityRow) {
            taskBody.append(activityRow);
        }
    }

    item.append(taskDot, taskBody);
    if (selection) {
        const check = document.createElement('span');
        check.className = 'theia-mobile-projects-task-clear-failed-check';
        check.classList.toggle('theia-mod-selected', selection.selected);
        check.setAttribute('aria-hidden', 'true');
        const checkIcon = document.createElement('span');
        checkIcon.className = selection.selected ? 'codicon codicon-check' : 'codicon codicon-circle-outline';
        check.append(checkIcon);
        item.prepend(check);
        item.setAttribute('aria-pressed', selection.selected ? 'true' : 'false');
        item.setAttribute(
            'aria-label',
            selection.selected
                ? nls.localize('qaap/sessionsSidebar/clearFailedDeselect', 'Deselect failed run')
                : nls.localize('qaap/sessionsSidebar/clearFailedSelect', 'Select failed run'),
        );
    }
    if (summary && summary.source !== 'theia-chat' && !summary.id.startsWith('pending-')) {
        let prefetched = false;
        item.addEventListener('pointerenter', () => {
            if (prefetched) {
                return;
            }
            prefetched = true;
            ctx.host.conversationOpenUi.prefetchConversationDocument(summary.id);
        }, { passive: true });
    }
    item.addEventListener('click', ev => {
        ev.stopPropagation();
        if (selection) {
            selection.onToggle();
            return;
        }
        options?.onActivate?.();
        if (summary) {
            void ctx.host.conversationOpenUi.openConversationSummary(project, summary);
        } else {
            void ctx.host.conversationOpenUi.openTaskInAgent(project, task);
        }
    });
    row.append(item);

    if (summary) {
        const flags = ctx.host.conversationIndexUi.resolveConversationFlags(summary);
        if (flags.priority && !flags.paused) {
            row.classList.add('theia-mod-priority');
            if (!compact) {
                const star = document.createElement('span');
                star.className = 'codicon codicon-star-full theia-mobile-projects-conversation-priority-badge';
                star.setAttribute('aria-label', nls.localize('qaap/mobileProjects/priorityBadge', 'High priority'));
                star.title = star.getAttribute('aria-label')!;
                taskTitleRow.insertBefore(star, taskTitleRow.firstChild);
            }
        }
        if (flags.paused) {
            row.classList.add('theia-mod-paused');
            if (!compact) {
                const pause = document.createElement('span');
                pause.className = 'codicon codicon-debug-pause theia-mobile-projects-conversation-pause-badge';
                pause.setAttribute('aria-label', nls.localize('qaap/mobileProjects/pausedBadge', 'Paused'));
                pause.title = pause.getAttribute('aria-label')!;
                taskTitleRow.insertBefore(pause, taskTitleRow.firstChild);
            }
        }
        if (summary.source !== 'theia-chat' && !isConversationAutoApproveEnabled(summary)) {
            row.classList.add('theia-mod-manual-approval');
            if (!compact) {
                const shield = document.createElement('span');
                shield.className = 'codicon codicon-shield theia-mobile-projects-conversation-manual-badge';
                const manualLabel = nls.localize('qaap/mobileProjects/manualApprovalBadge', 'Manual tool approval');
                shield.setAttribute('aria-label', manualLabel);
                shield.title = manualLabel;
                taskTitleRow.insertBefore(shield, taskTitleRow.firstChild);
            }
        }

        // Cursor-style hover actions (desktop sidebar): Pin + Archive fade in over the time slot.
        if (compact) {
            const pinBtn = document.createElement('button');
            pinBtn.type = 'button';
            pinBtn.className = 'theia-mobile-projects-card-menu-btn theia-mobile-projects-conversation-pin-btn';
            const pinned = !!(flags.priority && !flags.paused);
            const pinLabel = pinned
                ? nls.localize('qaap/mobileProjects/unpinConversation', 'Unpin')
                : nls.localize('qaap/mobileProjects/pinConversation', 'Pin');
            pinBtn.setAttribute('aria-label', pinLabel);
            pinBtn.title = pinLabel;
            pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
            if (pinned) {
                pinBtn.classList.add('theia-mod-pinned');
            }
            const pinIcon = document.createElement('span');
            pinIcon.className = `codicon ${pinned ? 'codicon-pinned' : 'codicon-pin'}`;
            pinIcon.setAttribute('aria-hidden', 'true');
            pinBtn.append(pinIcon);
            pinBtn.addEventListener('click', ev => {
                ev.stopPropagation();
                void ctx.host.onSetConversationPriority(summary, !pinned);
            });
            row.append(pinBtn);
        }

        if (summary.source !== 'theia-chat' && (compact || !summary.archived)) {
            const archiveBtn = document.createElement('button');
            archiveBtn.type = 'button';
            archiveBtn.className = 'theia-mobile-projects-card-menu-btn theia-mobile-projects-conversation-archive-btn';
            const archiveLabel = summary.archived
                ? nls.localize('qaap/mobileProjects/unarchiveTask', 'Unarchive task')
                : nls.localize('qaap/mobileProjects/archiveTask', 'Archive task');
            archiveBtn.setAttribute('aria-label', archiveLabel);
            archiveBtn.title = archiveLabel;
            if (summary.archived) {
                archiveBtn.classList.add('theia-mod-archived');
            }
            const archiveIcon = document.createElement('span');
            archiveIcon.className = 'codicon codicon-archive';
            archiveIcon.setAttribute('aria-hidden', 'true');
            archiveBtn.append(archiveIcon);
            archiveBtn.addEventListener('click', ev => {
                ev.stopPropagation();
                void ctx.host.onArchiveConversation(project, summary);
            });
            row.append(archiveBtn);
        }

        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.className = 'theia-mobile-projects-card-menu-btn theia-mobile-projects-conversation-menu-btn';
        menuBtn.setAttribute('aria-label', nls.localize('qaap/mobileProjects/taskMenu', 'Task options'));
        menuBtn.setAttribute('aria-haspopup', 'menu');
        menuBtn.setAttribute('aria-expanded', 'false');
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-kebab-vertical';
        icon.setAttribute('aria-hidden', 'true');
        menuBtn.append(icon);
        const menu = ctx.host.cardMenuUi.buildConversationMenu(project, summary);
        menuBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            ctx.host.cardMenuUi.toggleCardMenu(row, menu, menuBtn);
        });
        row.append(menuBtn, menu);
    }

    const rowKey = summary?.id ?? task.id;
    row.setAttribute(QAAP_INBOX_ROW_ID_ATTR, rowKey);
    row.setAttribute(
        QAAP_INBOX_ROW_FP_ATTR,
        summary
            ? buildWorkHubInboxRowFingerprintFromSummary(summary, {
                rowKey,
                visualStatusId: visualStatus.id,
                unread: isUnread,
                isCurrent: ctx.host.transcriptOpenSummaryId === summary.id,
            })
            : `${rowKey}:${task.state}:${task.title}`,
    );

    ctx.registerTaskElapsedTickers(row, task, summary, isRunning);

    // Swipe-to-delete: mobile-only progressive enhancement. The existing card-menu
    // kebab → Delete path remains on desktop and as a fallback.
    if (summary && summary.source !== 'theia-chat' && !summary.id.startsWith('pending-')) {
        attachSwipeToDelete(row, {
            onDelete: () => { void ctx.host.onDeleteConversation(project, summary); },
        });
    }

    return row;
}

export function createConversationActivityRowExtracted(ctx: any, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO | undefined,
    state: {
        readonly isRunning: boolean;
        readonly needsInput: boolean;
        readonly isDone: boolean;
    },): HTMLElement | undefined {
    if (!summary) {
        return undefined;
    }
    const chips: HTMLElement[] = [];
    if (state.needsInput) {
        chips.push(ctx.createConversationActivityChip({
            iconClass: 'codicon-comment-discussion',
            label: nls.localize('qaap/mobileProjects/activityNeedsUser', 'Waiting for you'),
            variant: 'needs-you',
        }));
    } else if (state.isRunning) {
        chips.push(ctx.createConversationActivityChip({
            iconClass: 'codicon-sync',
            label: summary.activityLabel?.trim()
                || nls.localize('qaap/mobileProjects/activityAgentWorking', 'Agent working'),
            variant: 'working',
        }));
    } else if (state.isDone || ctx.hasConversationDiffStats(summary)) {
        chips.push(ctx.createConversationActivityChip({
            iconClass: 'codicon-check',
            label: ctx.hasConversationDiffStats(summary)
                ? nls.localize('qaap/mobileProjects/activityChangesReady', 'Changes ready')
                : nls.localize('qaap/mobileProjects/activityDone', 'Done'),
            variant: 'ready',
        }));
    }

    if (summary.linkedPullRequest?.number) {
        chips.push(ctx.createConversationActivityChip({
            iconClass: 'codicon-git-pull-request',
            label: nls.localize('qaap/mobileProjects/activityPullRequest', 'PR #{0}', String(summary.linkedPullRequest.number)),
            variant: 'surface',
        }));
    }

    if (project.previewUrl) {
        chips.push(ctx.createConversationActivityChip({
            iconClass: 'codicon-open-preview',
            // A project URL only proves a preview can be opened; rendering/visual validation
            // happens separately and must not be implied by this compact activity chip.
            label: nls.localize('qaap/mobileProjects/activityPreviewAvailable', 'Preview available'),
            variant: 'surface',
        }));
    }

    if (summary.source !== 'theia-chat' || state.isRunning) {
        chips.push(ctx.createConversationActivityChip({
            iconClass: 'codicon-terminal',
            label: nls.localize('qaap/mobileProjects/activityTerminalAvailable', 'Terminal'),
            variant: 'surface',
        }));
    }

    if (chips.length === 0) {
        return undefined;
    }
    const row = document.createElement('div');
    row.className = 'theia-mobile-projects-task-activity-row';
    row.append(...chips.slice(0, 4));
    return row;
}

export function createConversationActivityChipExtracted(ctx: any, options: {
    readonly iconClass: string;
    readonly label: string;
    readonly variant: 'working' | 'needs-you' | 'ready' | 'surface';
}): HTMLElement {
    const chip = document.createElement('span');
    chip.className = `theia-mobile-projects-task-activity-chip theia-mod-${options.variant}`;
    chip.title = options.label;
    const icon = document.createElement('span');
    icon.className = `codicon ${options.iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'theia-mobile-projects-task-activity-chip-label';
    label.textContent = options.label;
    chip.append(icon, label);
    return chip;
}

export function renderConversationTurnProgressExtracted(ctx: any, host: HTMLElement,
    summary?: QaapAgentConversationSummaryDTO,): void {
    const hasSteps = summary?.turnProgressTotal !== undefined
        && summary.turnProgressCurrent !== undefined
        && summary.turnProgressTotal > 0;
    host.className = 'theia-mobile-projects-task-progress';
    host.classList.remove('theia-mod-indeterminate');
    host.replaceChildren();
    if (!hasSteps) {
        host.classList.add('theia-mod-indeterminate');
        host.setAttribute('aria-label', nls.localize('qaap/mobileProjects/taskProgressWorking', 'Agent working'));
        return;
    }
    const current = summary!.turnProgressCurrent!;
    const total = summary!.turnProgressTotal!;
    const ratio = conversationTurnProgressRatio(current, total);
    host.style.setProperty('--theia-mobile-projects-progress', String(ratio));
    host.setAttribute('aria-label', nls.localize(
        'qaap/mobileProjects/taskProgressSteps',
        '{0} of {1} steps',
        String(current),
        String(total),
    ));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 22 22');
    svg.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('class', 'theia-mobile-projects-task-progress-track');
    track.setAttribute('cx', '11');
    track.setAttribute('cy', '11');
    track.setAttribute('r', '9');
    const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fill.setAttribute('class', 'theia-mobile-projects-task-progress-fill');
    fill.setAttribute('cx', '11');
    fill.setAttribute('cy', '11');
    fill.setAttribute('r', '9');
    const circumference = 2 * Math.PI * 9;
    fill.style.strokeDasharray = `${circumference}`;
    fill.style.strokeDashoffset = `${circumference * (1 - ratio)}`;
    svg.append(track, fill);
    host.append(svg);
}


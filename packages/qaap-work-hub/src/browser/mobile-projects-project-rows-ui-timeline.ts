import type { MobileProjectsProjectRowsUiContext } from './mobile-projects-project-rows-ui-context';
// Extracted from mobile-projects-project-rows-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { conversationTurnProgressRatio } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-list-metrics';
import {
    isConversationAutoApproveEnabled,
    isFailedRunSummary,
    type QaapAgentConversationSummaryDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { isQaapAgentTaskStatusGlyphShown, isQaapAgentTaskUnreadReply, resolveQaapAgentTaskVisualStatus } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-visual-status';
import {
    formatStoredAgentFailureMessage,
    localizeAgentFailureShortReason,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { buildWorkHubInboxRowFingerprintFromSummary } from '../common/qaap-work-hub-inbox-fingerprint';
import {
    QAAP_INBOX_ROW_FP_ATTR,
    QAAP_INBOX_ROW_ID_ATTR,
} from './mobile-projects-hub-incremental-ui';
import type { MobileProjectsActiveTasks, MobileProjectTaskView } from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import { type MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types'; import { attachSwipeToDelete } from '@theia/qaap-mobile-shell/lib/browser/qaap-mobile-swipe-to-delete';
import { attachTaskTitleMarquee, createTaskTitleText } from './mobile-projects-task-title-marquee';
import { resolveQaapFailedRunAction } from '../common/qaap-failed-run-action';

const TASK_FAILURE_HINT_MAX_LENGTH = 120;

/** Plain-text previews interleave `[tool done] Read` / `[thinking]` stream markers with the reply. */
const TASK_PREVIEW_STREAM_MARKER = /\[(?:tool [^\]]*|thinking)\](?:\s+[\w.:/-]+(?=\s|$))?/g;

function resolveTaskFailureHint(summary: QaapAgentConversationSummaryDTO | undefined): string | undefined {
    if (!summary || summary.lastMessageRole !== 'agent' || !isFailedRunSummary(summary)) {
        return undefined;
    }
    const error = summary.lastMessageError?.trim();
    const shortReason = localizeAgentFailureShortReason(error);
    if (shortReason) {
        return shortReason;
    }
    const source = error ? formatStoredAgentFailureMessage(error) : summary.lastMessagePreview;
    const preview = source?.replace(TASK_PREVIEW_STREAM_MARKER, ' ').replace(/\s+/g, ' ').trim();
    if (!preview) {
        return undefined;
    }
    if (preview.length <= TASK_FAILURE_HINT_MAX_LENGTH) {
        return preview;
    }
    return `${preview.slice(0, TASK_FAILURE_HINT_MAX_LENGTH - 1).trimEnd()}…`;
}

/**
 * What a compact row's failure line shows: the reason and the recovery chip's action. The sessions
 * sidebar's live patch cannot rewrite that line, so a row whose key changed (failed again with
 * another error, Retry becoming Continue) is rebuilt instead of patched.
 */
export function sidebarRowFailureKey(summary: QaapAgentConversationSummaryDTO | undefined): string {
    // A streaming row can match the self-reported "Stopped:" failure pattern while its preview keeps
    // growing: keying it would rebuild the row on every SSE tick instead of patching it in place.
    if (summary?.status === 'streaming') {
        return '';
    }
    const hint = resolveTaskFailureHint(summary);
    return hint && summary ? `${resolveQaapFailedRunAction(summary)}:${hint}` : '';
}

/**
 * A compact (sidebar) row is one line: the failure reason and the model are not shown in it.
 * They live in the row's tooltip and accessible name instead. Shared with the in-place patch so a
 * changed model or failure refreshes both.
 */
export function applySidebarCompactRowTooltip(item: HTMLElement, task: MobileProjectTaskView, summary: QaapAgentConversationSummaryDTO | undefined): void {
    const lines: string[] = [task.title];
    const failureHint = resolveTaskFailureHint(summary);
    if (failureHint) {
        lines.push(nls.localize('qaap/mobileProjects/failedTaskWithReason', 'Failed: {0}', failureHint));
    }
    // A status without a glyph (branch, commit, local changes) is named here instead of on the row.
    // A clean finish ("verified") and an idle task say nothing, so they add no line.
    const visualStatus = resolveQaapAgentTaskVisualStatus(task, summary);
    if (!isQaapAgentTaskStatusGlyphShown(visualStatus) && visualStatus.id !== 'idle' && visualStatus.id !== 'verified') {
        lines.push(nls.localize(visualStatus.labelKey, visualStatus.label));
    }
    const modelId = (summary?.lastTurnAgentModel ?? summary?.agentModel ?? summary?.qaiqModel)?.modelId?.trim();
    if (modelId) {
        lines.push(nls.localize('qaap/sessionsSidebar/rowModelHint', 'Model: {0}', modelId));
    }
    item.title = lines.join('\n');
    item.setAttribute('aria-label', lines.join('. '));
}

/**
 * One-tap recovery chip next to the failure reason of a compact (sidebar) row: Continue for a turn
 * that was interrupted (its work is kept, a follow-up resumes it), Retry for one that failed (re-run
 * the turn). The overflow menu keeps both; this saves opening it for the most common next step.
 */
function createFailedRunChip(
    ctx: MobileProjectsProjectRowsUiContext,
    project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
): HTMLButtonElement {
    const action = resolveQaapFailedRunAction(summary);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'theia-mobile-projects-failed-run-chip';
    chip.dataset.qaapFailedRunAction = action;
    const icon = document.createElement('span');
    icon.className = `codicon ${action === 'continue' ? 'codicon-debug-continue' : 'codicon-debug-restart'}`;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = action === 'continue'
        ? nls.localize('qaap/mobileProjects/continueChip', 'Continue')
        : nls.localize('qaap/mobileProjects/retryChip', 'Retry');
    chip.append(icon, label);
    chip.title = action === 'continue'
        ? nls.localize('qaap/mobileProjects/continueTask', 'Continue task')
        : nls.localize('qaap/mobileProjects/retryTask', 'Retry task');
    chip.setAttribute('aria-label', chip.title);
    chip.addEventListener('click', event => {
        // The row itself opens the conversation: the chip only recovers it.
        event.stopPropagation();
        if (chip.disabled) {
            return;
        }
        const latestProject = ctx.host.projects?.find(candidate => candidate.id === project.id) ?? project;
        const latestSummary = ctx.host.conversations?.findSummaryById(summary.id) ?? summary;
        // A first tap flips the summary to streaming optimistically: a stale chip must not recover it twice.
        if (!isFailedRunSummary(latestSummary) || latestSummary.status === 'streaming') {
            return;
        }
        chip.disabled = true;
        const run = action === 'continue'
            ? ctx.host.onContinueConversation(latestProject, latestSummary)
            : ctx.host.onRetryConversation(latestProject, latestSummary);
        void Promise.resolve(run).finally(() => {
            chip.disabled = false;
        });
    });
    return chip;
}

export function createTaskItemExtracted(ctx: MobileProjectsProjectRowsUiContext, project: MobileProjectEntry,
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
        // Read by the sessions sidebar live patch, which cannot update the "+N" badge or the failure
        // line (reason + Retry/Continue chip) in place.
        row.dataset.qaapFailedDuplicates = String(failedDuplicateCount);
        row.dataset.qaapFailureKey = sidebarRowFailureKey(summary);
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
    const failureHint = resolveTaskFailureHint(summary);
    if (ctx.host.justAddedTaskId === task.id) {
        item.classList.add('theia-mod-flash');
    }
    if (isDone) {
        item.classList.add('theia-mod-done');
    }
    if (needsInput) {
        item.classList.add('theia-mod-needs-input');
    }
    // Unread agent reply: a small dot beside the status glyph, independent of the outcome glyph
    // (a finished-but-unread run keeps its real status instead of the warning triangle).
    row.classList.toggle('theia-mod-unread-reply', isQaapAgentTaskUnreadReply(summary, isUnread));

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
    } else if (isRunning) {
        ctx.renderConversationTurnProgress(taskDot, summary);
    } else if (visualStatus.iconClass && isQaapAgentTaskStatusGlyphShown(visualStatus)) {
        taskDot.className = `theia-mobile-projects-task-dot ${visualStatus.className}`;
        if (visualStatus.gitPr) {
            taskDot.classList.add('theia-mod-git-pr');
        }
        taskDot.append(ctx.createTaskLeadingGlyph(visualStatus.iconClass));
        const statusLabel = nls.localize(visualStatus.labelKey, visualStatus.label);
        const pullRequestNumber = visualStatus.gitPr ? summary?.linkedPullRequest?.number : undefined;
        const prHint = pullRequestNumber
            ? nls.localize('qaap/mobileProjects/pullRequestNumberStatus', 'Pull request #{0} · {1}', String(pullRequestNumber), statusLabel)
            : statusLabel;
        const statusHint = failureHint
            ? nls.localize('qaap/mobileProjects/failedTaskWithReason', 'Failed: {0}', failureHint)
            : prHint;
        taskDot.setAttribute('aria-label', statusHint);
        taskDot.title = statusHint;
    } else {
        // No glyph: a clean finish, or a local git fact (branch, commit, changes) that is not
        // actionable. The dot keeps its slot so titles stay aligned; the tooltip names the status.
        taskDot.className = 'theia-mobile-projects-task-dot theia-mod-no-status';
    }

    const taskBody = document.createElement('div');
    taskBody.className = 'theia-mobile-projects-task-body';

    const taskTitleRow = document.createElement('div');
    taskTitleRow.className = 'theia-mobile-projects-task-title-row';
    const taskTitle = document.createElement('span');
    taskTitle.className = 'theia-mobile-projects-task-title';
    taskTitle.title = task.title;
    taskTitle.append(createTaskTitleText(task.title));
    attachTaskTitleMarquee(row, taskTitle);
    const taskSince = document.createElement('span');
    taskSince.className = 'theia-mobile-projects-task-since';
    taskSince.textContent = ctx.formatTaskSince(task, summary);
    if (failedDuplicateCount > 0) {
        const dupHint = nls.localize(
            'qaap/sessionsSidebar/failedDuplicatesHint',
            '{0} older failed runs with this title are hidden',
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
    if (compact) {
        // One line: the time sits at the row's right edge; the reason and model are in the tooltip.
        taskTitleRow.append(taskSince);
        applySidebarCompactRowTooltip(item, task, summary);
    }
    taskBody.append(taskTitleRow);

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
    // A row survives refreshes whose markup did not change (the sessions sidebar keeps the live
    // DOM), so handlers act on the latest project and summary for its ids, not on the objects of
    // the render that created it.
    const latestProject = (): MobileProjectEntry => ctx.host.projects?.find(candidate => candidate.id === project.id) ?? project;
    const latestSummary = (current: QaapAgentConversationSummaryDTO): QaapAgentConversationSummaryDTO =>
        ctx.host.conversations?.findSummaryById(current.id) ?? current;
    item.addEventListener('click', ev => {
        ev.stopPropagation();
        if (selection) {
            selection.onToggle();
            return;
        }
        options?.onActivate?.();
        if (summary) {
            void ctx.host.conversationOpenUi.openConversationSummary(latestProject(), latestSummary(summary));
        } else {
            void ctx.host.conversationOpenUi.openTaskInAgent(latestProject(), task);
        }
    });
    row.append(item);

    if (summary) {
        const flags = ctx.host.conversationIndexUi.resolveConversationFlags(summary);
        if (flags.priority && !flags.paused) {
            row.classList.add('theia-mod-priority');
            if (!compact) {
                const pinBadge = document.createElement('span');
                pinBadge.className = 'codicon codicon-pinned theia-mobile-projects-conversation-priority-badge';
                pinBadge.setAttribute('aria-label', nls.localize('qaap/mobileProjects/priorityBadge', 'High priority'));
                pinBadge.title = pinBadge.getAttribute('aria-label')!;
                taskTitleRow.insertBefore(pinBadge, taskTitleRow.firstChild);
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

        // Compact rows keep the recovery chip (Continue/Retry) in the row, revealed on hover or focus
        // by CSS; it is icon-only and the overflow menu offers the same action on touch.
        if (compact && failureHint && summary.status !== 'streaming' && summary.source !== 'theia-chat' && !summary.id.startsWith('pending-') && !options?.selection) {
            const recoveryChip = createFailedRunChip(ctx, project, summary);
            recoveryChip.classList.add('theia-mod-row-action');
            row.append(recoveryChip);
        }

        // Pin remains available from the conversation overflow menu. Keep the compact row
        // focused on its primary action and the archive affordance on desktop hover. Retry also
        // remains available from that menu instead of taking a permanent slot in the row.
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
                void ctx.host.onArchiveConversation(latestProject(), latestSummary(summary));
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
        let menu = ctx.host.cardMenuUi.buildConversationMenu(project, summary);
        menuBtn.addEventListener('click', ev => {
            ev.stopPropagation();
            if (menu.hidden) {
                // Items and their actions follow the conversation's latest state (priority, pause, PR…).
                const fresh = ctx.host.cardMenuUi.buildConversationMenu(latestProject(), latestSummary(summary));
                menu.replaceWith(fresh);
                menu = fresh;
            }
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
            onDelete: () => { void ctx.host.onDeleteConversation(latestProject(), latestSummary(summary)); },
        });
    }

    return row;
}

export function createConversationActivityRowExtracted(ctx: MobileProjectsProjectRowsUiContext, project: MobileProjectEntry,
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
    const failureHint = resolveTaskFailureHint(summary);
    if (isFailedRunSummary(summary)) {
        chips.push(ctx.createConversationActivityChip({
            iconClass: 'codicon-error',
            label: failureHint
                ? nls.localize('qaap/mobileProjects/failedTaskWithReason', 'Failed: {0}', failureHint)
                : nls.localize('qaap/mobileProjects/activityFailed', 'Task failed'),
            variant: 'failed',
        }));
    } else if (state.needsInput) {
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

export function createConversationActivityChipExtracted(ctx: MobileProjectsProjectRowsUiContext, options: {
    readonly iconClass: string;
    readonly label: string;
    readonly variant: 'working' | 'needs-you' | 'ready' | 'failed' | 'surface';
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

export function renderConversationTurnProgressExtracted(ctx: MobileProjectsProjectRowsUiContext, host: HTMLElement,
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


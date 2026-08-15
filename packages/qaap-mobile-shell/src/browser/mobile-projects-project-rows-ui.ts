// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************
// @ts-nocheck

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
import { appendConversationDiffFootExtracted, appendConversationFootMetricsExtracted, appendTaskFootSeparatorExtracted, computeTaskFootFingerprintExtracted, formatConversationRunDurationExtracted, formatDurationShortExtracted, formatTaskSinceExtracted, hasConversationDiffStatsExtracted, localizeActivityLabelExtracted, patchSidebarCompactTaskRowExtracted, patchWorkHubTaskRowContentExtracted, patchWorkHubTaskRowExtracted, populateWorkHubTaskFootRowExtracted, registerTaskElapsedTickersExtracted, resolveConversationAgentLabelExtracted } from './mobile-projects-project-rows-ui-activity2';
import { createHomeRowAvatarExtracted, createHomeRowStatusExtracted, createRowExtracted, createSidebarStatusChipExtracted, createTaskLeadingGlyphExtracted, createWorkspaceBlockExtracted, createWorkspaceOpenControlExtracted } from './mobile-projects-project-rows-ui-render2';
import { createTaskBlockExtracted, detailComposerSurfaceForProjectExtracted, groupConversationTasksExtracted } from './mobile-projects-project-rows-ui-streaming2';
import { createConversationActivityChipExtracted, createConversationActivityRowExtracted, createTaskItemExtracted, renderConversationTurnProgressExtracted } from './mobile-projects-project-rows-ui-timeline2';

export const MOBILE_PROJECTS_CONVERSATIONS_COLLAPSED_LIMIT = 6;

/** Panel surface for repository cards and nested task/conversation rows. */
export interface MobileProjectsProjectRowsHost {
    homeMode: boolean;
    expandedId: string | undefined;
    hubView: MobileProjectsHubView;
    expandedConversationProjectIds: Set<string>;
    transcriptOpenSummaryId: string | undefined;
    justAddedTaskId: string | undefined;
    stickyComposerSurface: QaapComposerSurface | undefined;
    preparedCwdByProjectId: Map<string, string>;
    activeTasks: MobileProjectsActiveTasks | undefined;
    projectsService: MobileProjectsService;
    delegate: { onProjectOpen(project: MobileProjectEntry): void };

    cardMenuUi: import('./mobile-projects-card-menu-ui').MobileProjectsCardMenuUi;
    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    conversationOpenUi: import('./mobile-projects-conversation-open-ui').MobileProjectsConversationOpenUi;
    openProjectDetail(project: MobileProjectEntry): void | Promise<void>;
    toggleRowExpanded(project: MobileProjectEntry): void | Promise<void>;
    renderList(): void;
    onRetryConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
    onArchiveConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
    onSetConversationPriority(summary: QaapAgentConversationSummaryDTO, priority: boolean): Promise<void>;
    onDeleteConversation(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
    openTaskInAgent(project: MobileProjectEntry, task?: MobileProjectTaskView): Promise<void>;
}

/** Project list cards, expanded task blocks, and conversation row rendering. */
export class MobileProjectsProjectRowsUi {

    constructor(protected readonly host: MobileProjectsProjectRowsHost) { }

    createTaskLeadingGlyph(codiconClass: string): HTMLElement {
        return createTaskLeadingGlyphExtracted(this, codiconClass);
    }

    createRow(project: MobileProjectEntry): HTMLElement {
        return createRowExtracted(this, project);
    }

    createHomeRowAvatar(project: MobileProjectEntry): HTMLSpanElement {
        return createHomeRowAvatarExtracted(this, project);
    }

    createHomeRowStatus(project: MobileProjectEntry, state: { unreadCount: number; running: boolean; runningCount: number; needsInput: boolean; needsInputCount: number; failed: boolean; failedCount: number; },): HTMLElement | undefined {
        return createHomeRowStatusExtracted(this, project, state);
    }

    createWorkspaceOpenControl(project: MobileProjectEntry): HTMLButtonElement {
        return createWorkspaceOpenControlExtracted(this, project);
    }

    createWorkspaceBlock(project: MobileProjectEntry): HTMLElement | undefined {
        return createWorkspaceBlockExtracted(this, project);
    }

    createTaskBlock(project: MobileProjectEntry, activeInfo: ReturnType<MobileProjectsActiveTasks['getForCwd']>,): HTMLElement {
        return createTaskBlockExtracted(this, project, activeInfo);
    }

    detailComposerSurfaceForProject(project: MobileProjectEntry): QaapComposerSurface {
        return detailComposerSurfaceForProjectExtracted(this, project);
    }

    groupConversationTasks(tasks: MobileProjectTaskView[]): Array<{
        id: 'working' | 'needs-you' | 'recent' | 'done';
        label: string;
        tasks: MobileProjectTaskView[];
    }> {
        return groupConversationTasksExtracted(this, tasks);
    }

    createTaskItem(project: MobileProjectEntry, task: MobileProjectTaskView, _activeInfo: ReturnType<MobileProjectsActiveTasks['getForCwd']>, summary?: QaapAgentConversationSummaryDTO, parentIds: ReadonlySet<string> = new Set<string>(), options?: { onActivate?: () => void; compact?: boolean; failedDuplicateCount?: number; selection?: { selected: boolean; onToggle: () => void } },): HTMLElement {
        return createTaskItemExtracted(this, project, task, _activeInfo, summary, parentIds, options);
    }

    createConversationActivityRow(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO | undefined, state: { readonly isRunning: boolean; readonly needsInput: boolean; readonly isDone: boolean; },): HTMLElement | undefined {
        return createConversationActivityRowExtracted(this, project, summary, state);
    }

    createConversationActivityChip(options: { readonly iconClass: string; readonly label: string; readonly variant: 'working' | 'needs-you' | 'ready' | 'surface'; }): HTMLElement {
        return createConversationActivityChipExtracted(this, options);
    }

    renderConversationTurnProgress(host: HTMLElement, summary?: QaapAgentConversationSummaryDTO,): void {
        renderConversationTurnProgressExtracted(this, host, summary);
    }

    patchSidebarCompactTaskRow(row: HTMLElement, project: MobileProjectEntry, task: MobileProjectTaskView, summary: QaapAgentConversationSummaryDTO, options?: { readonly isCurrent?: boolean },): boolean {
        return patchSidebarCompactTaskRowExtracted(this, row, project, task, summary, options);
    }

    patchWorkHubTaskRow(row: HTMLElement, project: MobileProjectEntry, task: MobileProjectTaskView, summary: QaapAgentConversationSummaryDTO, options?: { readonly isCurrent?: boolean },): boolean {
        return patchWorkHubTaskRowExtracted(this, row, project, task, summary, options);
    }

    protected patchWorkHubTaskRowContent(row: HTMLElement, task: MobileProjectTaskView, summary: QaapAgentConversationSummaryDTO, options?: { readonly isCurrent?: boolean }, state?: { readonly isRunning?: boolean },): boolean {
        return patchWorkHubTaskRowContentExtracted(this, row, task, summary, options, state);
    }

    protected registerTaskElapsedTickers(row: HTMLElement, task: MobileProjectTaskView, summary: QaapAgentConversationSummaryDTO | undefined, isRunning: boolean,): void {
        registerTaskElapsedTickersExtracted(this, row, task, summary, isRunning);
    }

    formatTaskSince(task: MobileProjectTaskView, summary?: QaapAgentConversationSummaryDTO): string {
        return formatTaskSinceExtracted(this, task, summary);
    }

    appendTaskFootSeparator(footRow: HTMLElement): void {
        appendTaskFootSeparatorExtracted(this, footRow);
    }

    populateWorkHubTaskFootRow(footRow: HTMLElement, task: MobileProjectTaskView, summary: QaapAgentConversationSummaryDTO | undefined, isRunning: boolean,): void {
        populateWorkHubTaskFootRowExtracted(this, footRow, task, summary, isRunning);
    }

    protected computeTaskFootFingerprint(task: MobileProjectTaskView, summary: QaapAgentConversationSummaryDTO | undefined, isRunning: boolean,): string {
        return computeTaskFootFingerprintExtracted(this, task, summary, isRunning);
    }

    appendConversationFootMetrics(footRow: HTMLElement, summary: QaapAgentConversationSummaryDTO | undefined, isRunning: boolean,): void {
        appendConversationFootMetricsExtracted(this, footRow, summary, isRunning);
    }

    localizeActivityLabel(label: string): string {
        return localizeActivityLabelExtracted(this, label);
    }

    hasConversationDiffStats(summary?: QaapAgentConversationSummaryDTO): boolean {
        return hasConversationDiffStatsExtracted(this, summary);
    }

    appendConversationDiffFoot(footRow: HTMLElement, summary: QaapAgentConversationSummaryDTO): void {
        appendConversationDiffFootExtracted(this, footRow, summary);
    }

    formatConversationRunDuration(summary: QaapAgentConversationSummaryDTO, isRunning: boolean,): string | undefined {
        return formatConversationRunDurationExtracted(this, summary, isRunning);
    }

    formatDurationShort(durationMs: number): string {
        return formatDurationShortExtracted(this, durationMs);
    }

    resolveConversationAgentLabel(summary?: QaapAgentConversationSummaryDTO): string {
        return resolveConversationAgentLabelExtracted(this, summary);
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { resolveQaapAgentTaskVisualStatus } from '../common/qaap-agent-task-visual-status';
import {
    buildWorkHubInboxRowFingerprintFromSummary,
    buildWorkHubInboxStructureFingerprint,
    type WorkHubInboxProjectGroupFingerprintInput,
} from '../common/qaap-work-hub-inbox-fingerprint';
import type { QaapComposerSurface } from '../common/qaap-composer-surface';
import type { WorkHubTeamMember } from '../common/qaap-work-hub-team';
import type { MobileWorkHubInboxItem } from './mobile-work-hub-inbox';
import type { WorkHubApprovalItem } from './mobile-projects-team-hub-ui';
import type { MobileProjectEntry, MobileProjectsHubView } from './mobile-projects-types';

export const QAAP_INBOX_STRUCTURE_FP_ATTR = 'data-qaap-inbox-structure-fp';
export const QAAP_INBOX_ROW_ID_ATTR = 'data-qaap-inbox-row-id';
export const QAAP_INBOX_ROW_FP_ATTR = 'data-qaap-inbox-row-fp';

export interface MobileProjectsHubIncrementalHost {
    query: string;
    scroll: HTMLElement;
    transcriptOpenSummaryId: string | undefined;
    justAddedTaskId: string | undefined;
    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    projectRowsUi: import('./mobile-projects-project-rows-ui').MobileProjectsProjectRowsUi;
    createInboxProjectGroup(project: MobileProjectEntry, items: MobileWorkHubInboxItem[]): HTMLElement;
}

export interface HubInboxPatchGroup {
    readonly project: MobileProjectEntry;
    readonly items: readonly MobileWorkHubInboxItem[];
}

export interface MobileProjectsHubIncrementalPatchHost extends MobileProjectsHubIncrementalHost {
    hubView: MobileProjectsHubView;
    tasksHubSurface: QaapComposerSurface;
    shouldUseAgentsHubLanding(): boolean;
    collectTasksInboxGroups(
        projects: MobileProjectEntry[],
    ): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }>;
    collectChatHubGroups(
        projects: MobileProjectEntry[],
    ): Array<{ project: MobileProjectEntry; summaries: import('../common/qaap-agent-conversation-client').QaapAgentConversationSummaryDTO[] }>;
    collectReviewGroups(
        projects: MobileProjectEntry[],
    ): Array<{ project: MobileProjectEntry; items: MobileWorkHubInboxItem[] }>;
    projectsForCurrentHubList(): MobileProjectEntry[];
    updateTasksAttentionChrome(): void;
    renderSubtitle(): void;
    getFilteredTeamHubState(): {
        members: WorkHubTeamMember[];
        filteredApprovals: WorkHubApprovalItem[];
    };
    ensureOverlayUi(): {
        teamHub: {
            patchSections(
                host: HTMLElement,
                members: readonly WorkHubTeamMember[],
                options: {
                    searchQuery: string;
                    approvals: readonly WorkHubApprovalItem[];
                    embedded: boolean;
                },
            ): boolean;
        };
    };
}

/** Incremental DOM patcher for Work Hub inbox lists — avoids scroll.replaceChildren on SSE ticks. */
export class MobileProjectsHubIncrementalUi {

    protected lastStructureFingerprint = '';

    constructor(protected readonly host: MobileProjectsHubIncrementalPatchHost) { }

    /**
     * Attempt in-place inbox row patches before {@link HTMLElement.replaceChildren} on the hub scroll host.
     * Returns true when the existing DOM was updated and a full rebuild can be skipped.
     */
    tryPatchBeforeRebuild(): boolean {
        const projects = this.host.projectsForCurrentHubList();
        if (this.host.hubView === 'tasks') {
            if (this.host.shouldUseAgentsHubLanding()) {
                return false;
            }
            if (this.host.tasksHubSurface === 'chat') {
                const groups = this.host.collectChatHubGroups(projects);
                const items = groups.map(group => ({
                    project: group.project,
                    items: group.summaries.map(summary => ({
                        kind: 'conversation' as const,
                        project: group.project,
                        summary,
                        sortAt: summary.updatedAt,
                        priority: 0,
                    })),
                }));
                const inboxRoot = this.findInboxRoot('chat-inbox');
                if (this.tryPatchInbox('chat-inbox', inboxRoot, items)) {
                    this.host.renderSubtitle();
                    return true;
                }
                return false;
            }
            const groups = this.host.collectTasksInboxGroups(projects);
            const inboxRoot = this.findInboxRoot('tasks-inbox');
            const teamRoot = this.host.scroll.querySelector<HTMLElement>(
                '.theia-mobile-hub-team-root.theia-mod-embedded-in-tasks',
            );
            const teamEmbedded = !!teamRoot;
            const hasInbox = groups.length > 0 || !!inboxRoot;
            const inboxPatched = !hasInbox || this.tryPatchInbox('tasks-inbox', inboxRoot, groups, { teamEmbedded });
            const teamPatched = !teamEmbedded || this.tryPatchTeamSection(teamRoot!);
            if (inboxPatched && teamPatched && (hasInbox || teamEmbedded)) {
                this.host.updateTasksAttentionChrome();
                this.host.renderSubtitle();
                return true;
            }
            return false;
        }
        if (this.host.hubView === 'chat') {
            const groups = this.host.collectChatHubGroups(projects);
            const items = groups.map(group => ({
                project: group.project,
                items: group.summaries.map(summary => ({
                    kind: 'conversation' as const,
                    project: group.project,
                    summary,
                    sortAt: summary.updatedAt,
                    priority: 0,
                })),
            }));
            const inboxRoot = this.findInboxRoot('chat-inbox');
            if (this.tryPatchInbox('chat-inbox', inboxRoot, items)) {
                this.host.renderSubtitle();
                return true;
            }
            return false;
        }
        if (this.host.hubView === 'review') {
            const groups = this.host.collectReviewGroups(projects);
            const inboxRoot = this.findInboxRoot('review-inbox');
            if (this.tryPatchInbox('review-inbox', inboxRoot, groups)) {
                this.host.renderSubtitle();
                return true;
            }
            return false;
        }
        return false;
    }

    resetStructureFingerprint(): void {
        this.lastStructureFingerprint = '';
    }

    tryPatchInbox(
        hubKind: string,
        inboxRoot: HTMLElement | undefined,
        groups: readonly HubInboxPatchGroup[],
        options: {
            readonly emptyState?: string;
            readonly loading?: boolean;
            readonly teamEmbedded?: boolean;
        } = {},
    ): boolean {
        if (!inboxRoot?.isConnected) {
            return false;
        }
        const structure = this.buildStructureFingerprint(hubKind, groups, options);
        const existingStructure = inboxRoot.getAttribute(QAAP_INBOX_STRUCTURE_FP_ATTR);
        if (!existingStructure || existingStructure !== structure) {
            return false;
        }
        for (const group of groups) {
            const section = inboxRoot.querySelector<HTMLElement>(
                `.theia-mobile-projects-chats-project-group[data-qaap-project-id="${cssEscape(group.project.id)}"]`,
            );
            if (!section) {
                return false;
            }
            const count = section.querySelector('.theia-mobile-projects-chats-project-count');
            if (count) {
                count.textContent = String(group.items.length);
            }
            const list = section.querySelector<HTMLElement>('.theia-mobile-projects-chats-list');
            if (!list) {
                return false;
            }
            const parentIds = this.collectParentIds(group.items);
            const activeInfo = this.host.conversationIndexUi.activeInfoForProject(group.project);
            for (const item of group.items) {
                if (item.kind !== 'conversation') {
                    return false;
                }
                const summary = item.summary;
                const task = this.host.conversationIndexUi.summaryToTaskView(summary);
                const rowKey = summary.id;
                const unread = this.host.conversationIndexUi.isConversationUnread(summary);
                const visualStatusId = resolveQaapAgentTaskVisualStatus(task, summary, unread).id;
                const nextFingerprint = buildWorkHubInboxRowFingerprintFromSummary(summary, {
                    rowKey,
                    visualStatusId,
                    unread,
                    isCurrent: this.host.transcriptOpenSummaryId === summary.id,
                });
                const existingRow = list.querySelector<HTMLElement>(
                    `.theia-mobile-projects-task-row[${QAAP_INBOX_ROW_ID_ATTR}="${cssEscape(rowKey)}"]`,
                );
                if (!existingRow) {
                    return false;
                }
                if (existingRow.getAttribute(QAAP_INBOX_ROW_FP_ATTR) === nextFingerprint) {
                    continue;
                }
                if (this.host.projectRowsUi.patchWorkHubTaskRow(
                    existingRow,
                    group.project,
                    task,
                    summary,
                    { isCurrent: this.host.transcriptOpenSummaryId === summary.id },
                )) {
                    existingRow.setAttribute(QAAP_INBOX_ROW_FP_ATTR, nextFingerprint);
                    continue;
                }
                const nextRow = this.host.projectRowsUi.createTaskItem(
                    group.project,
                    task,
                    activeInfo,
                    summary,
                    parentIds,
                );
                existingRow.replaceWith(nextRow);
            }
        }
        this.lastStructureFingerprint = structure;
        return true;
    }

    /**
     * Patch a SINGLE inbox row in place from a fresh summary — used on high-frequency preview-only
     * ticks (turn progress / activity) so the streaming card's progress ring and activity label keep
     * advancing without running the whole structure sweep or a list rebuild. Returns false (and does
     * nothing) whenever anything is missing or the patch can't apply, so the caller safely falls back
     * to the current chrome-only behaviour.
     */
    patchConversationRowInPlace(
        summary: import('../common/qaap-agent-conversation-client').QaapAgentConversationSummaryDTO,
    ): boolean {
        const row = this.host.scroll.querySelector<HTMLElement>(
            `.theia-mobile-projects-task-row[${QAAP_INBOX_ROW_ID_ATTR}="${cssEscape(summary.id)}"]`,
        );
        if (!row) {
            return false;
        }
        const projectId = row.closest<HTMLElement>('.theia-mobile-projects-chats-project-group')?.dataset.qaapProjectId;
        const project = projectId
            ? this.host.projectsForCurrentHubList().find(candidate => candidate.id === projectId)
            : undefined;
        if (!project) {
            return false;
        }
        const task = this.host.conversationIndexUi.summaryToTaskView(summary);
        const unread = this.host.conversationIndexUi.isConversationUnread(summary);
        const isCurrent = this.host.transcriptOpenSummaryId === summary.id;
        const visualStatusId = resolveQaapAgentTaskVisualStatus(task, summary, unread).id;
        const nextFingerprint = buildWorkHubInboxRowFingerprintFromSummary(summary, {
            rowKey: summary.id,
            visualStatusId,
            unread,
            isCurrent,
        });
        if (row.getAttribute(QAAP_INBOX_ROW_FP_ATTR) === nextFingerprint) {
            return true;
        }
        if (this.host.projectRowsUi.patchWorkHubTaskRow(row, project, task, summary, { isCurrent })) {
            row.setAttribute(QAAP_INBOX_ROW_FP_ATTR, nextFingerprint);
            return true;
        }
        return false;
    }

    tryPatchTeamSection(teamRoot: HTMLElement): boolean {
        const { members, filteredApprovals } = this.host.getFilteredTeamHubState();
        return this.host.ensureOverlayUi().teamHub.patchSections(teamRoot, members, {
            searchQuery: this.host.query,
            approvals: filteredApprovals,
            embedded: true,
        });
    }

    rememberRenderedStructure(
        hubKind: string,
        groups: readonly HubInboxPatchGroup[],
        options: {
            readonly emptyState?: string;
            readonly loading?: boolean;
            readonly teamEmbedded?: boolean;
        } = {},
    ): void {
        this.lastStructureFingerprint = this.buildStructureFingerprint(hubKind, groups, options);
        const inboxRoot = this.findInboxRoot(hubKind);
        inboxRoot?.setAttribute(QAAP_INBOX_STRUCTURE_FP_ATTR, this.lastStructureFingerprint);
    }

    findInboxRoot(hubKind: string): HTMLElement | undefined {
        const selectorByKind: Record<string, string> = {
            'tasks-inbox': '.theia-mobile-projects-chats-inbox.theia-mod-tasks-inbox',
            'chat-inbox': '.theia-mobile-projects-chats-inbox.theia-mod-local-chat',
            'review-inbox': '.theia-mobile-projects-chats-inbox.theia-mod-review-inbox',
        };
        const selector = selectorByKind[hubKind];
        if (!selector) {
            return undefined;
        }
        const found = this.host.scroll.querySelector<HTMLElement>(selector);
        return found ?? undefined;
    }

    protected buildStructureFingerprint(
        hubKind: string,
        groups: readonly HubInboxPatchGroup[],
        options: {
            readonly emptyState?: string;
            readonly loading?: boolean;
            readonly teamEmbedded?: boolean;
        },
    ): string {
        const groupFingerprints: WorkHubInboxProjectGroupFingerprintInput[] = groups.map(group => {
            const rows: Array<{ rowKey: string }> = [];
            const variantRunIds = new Set<string>();
            for (const item of group.items) {
                if (item.kind === 'conversation') {
                    if (item.summary.parallelRunId) {
                        variantRunIds.add(item.summary.parallelRunId);
                        continue;
                    }
                    rows.push({ rowKey: item.summary.id });
                    continue;
                }
                rows.push({ rowKey: `pr:${item.pullRequest.number}:${item.pullRequest.repo}` });
            }
            return {
                projectId: group.project.id,
                itemCount: group.items.length,
                rows,
                variantRunIds: [...variantRunIds],
            };
        });
        return buildWorkHubInboxStructureFingerprint({
            hubKind,
            query: this.host.query.trim().toLowerCase(),
            groups: groupFingerprints,
            emptyState: options.emptyState,
            loading: options.loading,
            teamEmbedded: options.teamEmbedded,
        });
    }

    protected collectParentIds(items: readonly MobileWorkHubInboxItem[]): Set<string> {
        const parentIds = new Set<string>();
        for (const item of items) {
            if (item.kind === 'conversation' && item.summary.forkedFromId) {
                parentIds.add(item.summary.forkedFromId);
            }
        }
        return parentIds;
    }
}

function cssEscape(value: string): string {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        return CSS.escape(value);
    }
    return value.replace(/["\\]/g, '\\$&');
}

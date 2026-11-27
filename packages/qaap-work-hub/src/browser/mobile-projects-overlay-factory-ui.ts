// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import {
    approveAgentRequest,
    markAgentApprovalOptimisticallyResolved,
    rejectAgentRequest,
    unmarkAgentApprovalOptimisticallyResolved,
    type QaapAgentApprovalRequestDTO,
} from '@theia/qaap-shared-core/lib/common/qaap-agent-approval-client';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { WorkHubTeamMember } from '@theia/qaap-shared-core/lib/common/qaap-work-hub-team';
import type { MobileProjectsActiveTasks, MobileProjectTaskView } from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileProjectsParallelUi } from './mobile-projects-parallel-ui';
import { MobileProjectsTeamUi } from './mobile-projects-team-ui';
import { MobileProjectsTeamHubUi } from './mobile-projects-team-hub-ui';

export interface MobileProjectsOverlayBundle {
    parallel: MobileProjectsParallelUi;
    team: MobileProjectsTeamUi;
    teamHub: MobileProjectsTeamHubUi;
}

/** Panel surface for lazy overlay UI bundles (parallel, team). */
export interface MobileProjectsOverlayFactoryHost {
    overlayUi: MobileProjectsOverlayBundle | undefined;
    visible: boolean;
    projects: MobileProjectEntry[];
    activeTasks: MobileProjectsActiveTasks | undefined;
    cachedAgentApprovals?: QaapAgentApprovalRequestDTO[];
    transcriptComposerProject: MobileProjectEntry | undefined;
    transcriptLastConv: import('@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client').QaapAgentConversationDTO | undefined;
    transcriptChatHost: HTMLElement | undefined;
    messageService: MessageService | undefined;

    applyActiveTasksRefresh(): Promise<void>;
    refreshTasksHubApprovals?(forceRender?: boolean): void;
    updateTasksAttentionChrome?(): void;
    openWorkHubSessionsSidebar(): void;
    createTaskItem(
        project: MobileProjectEntry,
        task: MobileProjectTaskView,
        activeInfo: ReturnType<MobileProjectsActiveTasks['getForCwd']>,
        summary?: QaapAgentConversationSummaryDTO,
        parentIds?: ReadonlySet<string>,
        options?: { skipMenu?: boolean },
    ): HTMLElement;
    conversationIndexUi: import('@theia/qaap-shared-core/lib/browser/mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    projectNavigationUi: import('./mobile-projects-project-navigation-ui').MobileProjectsProjectNavigationUi;
    showTaskLog(project: MobileProjectEntry, taskId: string): Promise<void>;
    onTeamMemberClick(member: WorkHubTeamMember): void;
    selectHubLandingView(view: import('@theia/qaap-shared-core/lib/browser/mobile-projects-types').MobileProjectsHubView): void;
    toggleConversationAutoApproveById(conversationId: string): Promise<void>;
    renderList(): void;
    projectRowsUi: import('./mobile-projects-project-rows-ui').MobileProjectsProjectRowsUi;
}

/** Lazily constructs parallel/team overlay UI bundles wired to the panel host. */
export class MobileProjectsOverlayFactoryUi {

    constructor(protected readonly host: MobileProjectsOverlayFactoryHost) { }

    ensureOverlayUi(): MobileProjectsOverlayBundle {
        if (this.host.overlayUi) {
            return this.host.overlayUi;
        }
        const parallel = new MobileProjectsParallelUi({
            getAgents: () => this.host.activeTasks?.getAgents() ?? [],
            onRunsChanged: () => {
                if (this.host.visible) {
                    void this.host.applyActiveTasksRefresh();
                }
            },
            onOpenSessionsSidebar: () => this.host.openWorkHubSessionsSidebar(),
            buildVariantTaskRow: (project, summary, activeInfo, parentIds, options) => {
                const task = this.host.conversationIndexUi.summaryToTaskView(summary);
                return this.host.projectRowsUi.createTaskItem(project, task, activeInfo, summary, parentIds, {
                    compact: options?.compact,
                    onActivate: options?.onActivate,
                });
            },
        });
        const team = new MobileProjectsTeamUi({
            getChildTasks: parentId => this.host.activeTasks?.getChildTasksForParent(parentId) ?? [],
            onSubtaskClick: taskId => {
                const project = this.host.transcriptComposerProject ?? this.host.projectNavigationUi.resolveSelectedProject();
                if (project) {
                    void this.host.showTaskLog(project, taskId);
                }
            },
        });
        const teamHub = new MobileProjectsTeamHubUi({
            resolveAgentLabel: agentId => {
                const fromList = this.host.activeTasks?.getAgents().find(a => a.id === agentId)?.label;
                if (fromList) {
                    return fromList.startsWith('@') ? fromList : `@${fromList}`;
                }
                return agentId.startsWith('@') ? agentId : `@${agentId}`;
            },
            onMemberClick: member => this.host.onTeamMemberClick(member),
            onOpenWorkflows: () => this.host.selectHubLandingView('workflows'),
            onEnableAutoApprove: member => {
                if (!member.conversationId) {
                    return;
                }
                void this.host.toggleConversationAutoApproveById(member.conversationId);
            },
            onApproveRequest: (approvalId, _member) => {
                this.submitOptimisticTeamApproval(approvalId, 'approve');
            },
            onRejectRequest: (approvalId, _member) => {
                this.submitOptimisticTeamApproval(approvalId, 'reject');
            },
        });
        this.host.overlayUi = {
            parallel,
            team,
            teamHub,
        };
        return this.host.overlayUi;
    }

    /** Dismiss a Team Hub approval card immediately on click and roll back cleanly on failure. */
    protected submitOptimisticTeamApproval(approvalId: string, action: 'approve' | 'reject'): void {
        markAgentApprovalOptimisticallyResolved(approvalId);
        const removed = this.host.cachedAgentApprovals?.find(item => item.id === approvalId);
        if (this.host.cachedAgentApprovals) {
            this.host.cachedAgentApprovals = this.host.cachedAgentApprovals.filter(item => item.id !== approvalId);
        }
        this.host.updateTasksAttentionChrome?.();
        this.host.renderList();

        const rollback = (errorMessage: string): void => {
            unmarkAgentApprovalOptimisticallyResolved(approvalId);
            if (removed && this.host.cachedAgentApprovals
                && !this.host.cachedAgentApprovals.some(item => item.id === removed.id)) {
                this.host.cachedAgentApprovals = [...this.host.cachedAgentApprovals, removed];
            }
            this.host.updateTasksAttentionChrome?.();
            this.host.renderList();
            this.host.messageService?.error(errorMessage);
        };

        const request = action === 'approve' ? approveAgentRequest(approvalId) : rejectAgentRequest(approvalId);
        void request.then(result => {
            if (result.ok || result.expired) {
                this.host.refreshTasksHubApprovals?.(true);
                return;
            }
            rollback(result.error ?? (action === 'approve'
                ? nls.localize('qaap/mobileProjects/teamApprovalApproveFailed', 'Could not approve this action.')
                : nls.localize('qaap/mobileProjects/teamApprovalRejectFailed', 'Could not reject this action.')));
        }).catch(error => {
            rollback(error instanceof Error ? error.message : String(error));
        });
    }

    appendTranscriptHeaderActions(header: HTMLElement, title: HTMLElement): HTMLButtonElement {
        return this.ensureOverlayUi().parallel.appendTranscriptHeaderActions(header, title);
    }

    closeParallelSheet(): void {
        this.ensureOverlayUi().parallel.closeSheet();
    }
}

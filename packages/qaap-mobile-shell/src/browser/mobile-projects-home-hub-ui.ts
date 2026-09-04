// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { ChatAgentService } from '@theia/ai-chat';
import {
    buildWorkHubHomeGreeting,
    buildWorkHubHomeRecentItems,
    formatWorkHubRelativeTime,
    selectWorkHubHomePinnedProjectIds,
    type WorkHubHomeAttentionItem,
    type WorkHubHomeRecentItem,
    type WorkHubHomeRecentSource,
    type WorkHubHomeSnapshot,
} from '../common/qaap-work-hub-home';
import { buildWorkHubHomeUsageSummary } from '../common/qaap-work-hub-usage-summary';
import { isLocalChatSummary } from '../common/qaap-work-hub-surfaces';
import { readQaapAuthUser } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import type { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import type { MobileProjectsConversations } from './mobile-projects-conversations';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectEntry } from './mobile-projects-types';
import type { MobileWorkHubInboxStream } from './mobile-work-hub-inbox-stream';
import type { MobileProjectsHomeUi, WorkHubHomeNavigateTarget, WorkHubHomeQuickActionId } from './mobile-projects-home-ui';
import type { QaapGithubPullRequestSummary } from '@theia/qaap-adapters/lib/common/qaap-github-api-types';
import type { QaapAgentConversationSummaryDTO } from '../common/qaap-agent-conversation-client';
import type { WorkHubTeamMember } from '../common/qaap-work-hub-team';
import type { WorkHubApprovalItem } from './mobile-projects-team-hub-ui';
import type { MobileProjectsMissionControlHubUi } from './mobile-projects-mission-control-hub-ui';

export interface MobileProjectsHomeHubHost {
    projects: MobileProjectEntry[];
    inboxPullRequests: QaapGithubPullRequestSummary[];
    inboxPullRequestsLoaded: boolean;
    inboxPullRequestsLoading: boolean;
    conversations: MobileProjectsConversations | undefined;
    activeTasks: MobileProjectsActiveTasks | undefined;
    inboxStream: MobileWorkHubInboxStream | undefined;
    scroll: HTMLElement;
    chatAgentService: ChatAgentService | undefined;
    projectsService: MobileProjectsService;

    collectTeamMembersForHub(): WorkHubTeamMember[];
    collectTeamApprovalItems(members: WorkHubTeamMember[]): WorkHubApprovalItem[];
    countTasksAttention(): { needsYou: number; running: number };
    localChatsForProject(project: MobileProjectEntry): QaapAgentConversationSummaryDTO[];
    vpsTasksForProject(project: MobileProjectEntry): QaapAgentConversationSummaryDTO[];
    conversationsForProject(project: MobileProjectEntry): QaapAgentConversationSummaryDTO[];
    refreshTasksHubApprovals(forceRender?: boolean): void;
    subscribeToInboxStream(): void;
    refreshInboxPullRequests(projects?: MobileProjectEntry[], force?: boolean): Promise<void>;
    renderList(): void;
    renderSubtitle(): void;
    ensureOverlayUi(): { home: MobileProjectsHomeUi };
    navigateHubTab(view: import('./mobile-projects-types').MobileProjectsHubView): void;
    openProjectDetail(project: MobileProjectEntry): void | Promise<void>;
    transcriptSheetUi: import('./mobile-projects-transcript-sheet-ui').MobileProjectsTranscriptSheetUi;
    selectHubLandingView(view: import('./mobile-projects-types').MobileProjectsHubView, preferredDiffProjectId?: string, options?: { force?: boolean }): void;
    preferComposerSurface(surface: import('../common/qaap-composer-surface').QaapComposerSurface, projectCwd?: string): void;
    conversationIndexUi: import('./mobile-projects-conversation-index-ui').MobileProjectsConversationIndexUi;
    missionControlHubUi: MobileProjectsMissionControlHubUi;
    missionControlExpanded: boolean;
    agentsHubSelectedProjectId: string | undefined;
}

export class MobileProjectsHomeHubUi {
    constructor(protected readonly host: MobileProjectsHomeHubHost) { }

    refreshHomeHubData(forceRender: boolean): void {
        this.host.conversations?.start();
        this.host.activeTasks?.start();
        this.host.refreshTasksHubApprovals(forceRender);
        if (!this.host.inboxPullRequestsLoaded && !this.host.inboxPullRequestsLoading) {
            this.host.inboxStream?.start();
            this.host.subscribeToInboxStream();
            void this.host.refreshInboxPullRequests(undefined, false);
        } else if (forceRender) {
            this.host.renderList();
        }
    }

    buildHomeSnapshot(): WorkHubHomeSnapshot {
        const members = this.host.collectTeamMembersForHub();
        const approvals = this.host.collectTeamApprovalItems(members);
        const { needsYou, running } = this.host.countTasksAttention();
        const attentionItems: WorkHubHomeAttentionItem[] = approvals.slice(0, 3).map(item => ({
            id: item.approvalId ?? item.member.id,
            kind: 'approval' as const,
            title: this.resolveHomeAgentLabel(item.member.agentId),
            subtitle: item.summary ?? item.member.title,
            meta: item.member.projectName,
        }));

        const approvalConversationIds = new Set(
            approvals.flatMap(item => [item.approvalId, item.member.conversationId].filter(
                (id): id is string => !!id,
            )),
        );
        for (const item of this.host.missionControlHubUi.collectItems()) {
            if (attentionItems.length >= 4 || item.lane !== 'needs-you' || item.hasPullRequest
                || approvalConversationIds.has(item.conversationId)) {
                continue;
            }
            attentionItems.push({
                id: item.conversationId,
                kind: 'task',
                title: item.title,
                subtitle: item.preview
                    ?? (item.failureKind
                        ? nls.localize('qaap/workHubHome/taskNeedsAttention', 'Task needs attention')
                        : nls.localize('qaap/workHubHome/taskReadyToReview', 'Agent result ready to inspect')),
                meta: item.projectName,
            });
        }
        if (this.host.inboxPullRequests.length > 0 && attentionItems.length < 4) {
            attentionItems.push({
                id: 'open-pull-requests',
                kind: 'pull-request',
                title: nls.localize('qaap/workHubHome/openPullRequestsTitle', 'Open pull requests'),
                subtitle: nls.localize(
                    'qaap/workHubHome/openPullRequestsSubtitle',
                    'Finish agent handoffs waiting on GitHub',
                ),
                meta: this.host.inboxPullRequests.length === 1
                    ? nls.localize('qaap/workHubHome/openPullRequestsMetaOne', '1 PR')
                    : nls.localize(
                        'qaap/workHubHome/openPullRequestsMetaMany',
                        '{0} PRs',
                        String(this.host.inboxPullRequests.length),
                    ),
            });
        }
        const recentSources: WorkHubHomeRecentSource[] = [];
        for (const project of this.host.projects) {
            for (const summary of [...this.host.conversationIndexUi.localChatsForProject(project), ...this.host.conversationIndexUi.vpsTasksForProject(project)]) {
                recentSources.push({
                    id: summary.id,
                    projectId: project.id,
                    projectName: project.name,
                    title: summary.title?.trim()
                        || nls.localize('qaap/mobileProjects/untitledChat', 'Untitled chat'),
                    subtitle: isLocalChatSummary(summary)
                        ? nls.localize('qaap/workHubHome/recentChat', 'Local chat')
                        : nls.localize('qaap/workHubHome/recentTask', 'VPS task'),
                    surface: isLocalChatSummary(summary) ? 'chat' : 'task',
                    updatedAt: summary.updatedAt,
                });
            }
        }
        const usageEvents = [];
        for (const project of this.host.projects) {
            for (const summary of this.host.conversationIndexUi.conversationsForProject(project)) {
                usageEvents.push({
                    createdAt: summary.createdAt,
                    updatedAt: summary.updatedAt,
                    messageCount: summary.messageCount,
                });
            }
        }
        return {
            stats: {
                projectCount: this.host.projects.length,
                runningTasks: running,
                needsYou,
                openPullRequests: this.host.inboxPullRequests.length,
                localChatCount: this.host.projects.reduce(
                    (sum, project) => sum + this.host.conversationIndexUi.localChatsForProject(project).length,
                    0,
                ),
            },
            usageSummary: buildWorkHubHomeUsageSummary(usageEvents, {
                favoriteModelLabel: this.resolveHomeFavoriteModelLabel(),
            }),
            attentionItems,
            recentItems: buildWorkHubHomeRecentItems(recentSources, 5),
            pinnedProjectIds: selectWorkHubHomePinnedProjectIds(this.host.projects, 4),
        };
    }

    resolveHomeFavoriteModelLabel(): string | undefined {
        const name = this.host.chatAgentService?.getDefaultAgent()?.name?.trim();
        return name || undefined;
    }

    buildHomeGreeting(): string {
        const user = readQaapAuthUser();
        const name = user?.name?.trim() || user?.login?.trim();
        return buildWorkHubHomeGreeting(name);
    }

    formatHomeRelativeTime(updatedAt: number): string {
        return formatWorkHubRelativeTime(updatedAt, Date.now(), {
            justNow: nls.localize('qaap/mobileProjects/inboxJustNow', 'just now'),
            minutesAgo: count => nls.localize('qaap/mobileProjects/inboxMinutesAgo', '{0}m ago', count),
            hoursAgo: count => nls.localize('qaap/mobileProjects/inboxHoursAgo', '{0}h ago', count),
            daysAgo: count => nls.localize('qaap/mobileProjects/inboxDaysAgo', '{0}d ago', count),
        });
    }

    buildHomeWorkspaceActivity(project: MobileProjectEntry): string {
        const cwd = this.host.projectsService.getProjectCwd(project);
        const activeCount = cwd
            ? (this.host.activeTasks?.getForCwd(cwd)?.activeCount ?? 0)
            : this.host.activeTasks?.findTasksForProject(project).filter(task => task.state === 'running').length ?? 0;
        const tasks = this.host.conversationIndexUi.vpsTasksForProject(project).length;
        if (activeCount > 0 && tasks > 0) {
            return activeCount === 1
                ? nls.localize(
                    'qaap/workHubHome/workspaceActiveOneTaskMany',
                    '1 agent active · {0} tasks',
                    String(tasks),
                )
                : nls.localize(
                    'qaap/workHubHome/workspaceActiveManyTaskMany',
                    '{0} agents active · {1} tasks',
                    String(activeCount),
                    String(tasks),
                );
        }
        if (activeCount > 0) {
            return activeCount === 1
                ? nls.localize('qaap/workHubHome/workspaceActiveOne', '1 agent active')
                : nls.localize(
                    'qaap/workHubHome/workspaceActiveMany',
                    '{0} agents active',
                    String(activeCount),
                );
        }
        if (tasks > 0) {
            return tasks === 1
                ? nls.localize('qaap/workHubHome/workspaceTaskOne', '1 task')
                : nls.localize(
                    'qaap/workHubHome/workspaceTaskMany',
                    '{0} tasks',
                    String(tasks),
                );
        }
        return project.branch || nls.localize('qaap/workHubHome/workspaceIdle', 'Ready to work');
    }

    getHomeWorkspaceStatus(project: MobileProjectEntry): 'idle' | 'running' | 'open' {
        if (project.isCurrent) {
            return 'open';
        }
        const cwd = this.host.projectsService.getProjectCwd(project);
        const activeCount = cwd
            ? (this.host.activeTasks?.getForCwd(cwd)?.activeCount ?? 0)
            : this.host.activeTasks?.findTasksForProject(project).filter(task => task.state === 'running').length ?? 0;
        return activeCount > 0 ? 'running' : 'idle';
    }

    buildHomeSubtitle(snapshot: WorkHubHomeSnapshot): string {
        const items = this.host.missionControlHubUi.collectItems();
        const needsYou = items.filter(item => item.lane === 'needs-you').length;
        const running = items.filter(item => item.lane === 'running').length;
        if (needsYou > 0) {
            return needsYou === 1
                ? nls.localize('qaap/workHubHome/subtitleNeedsYouOne', '1 item needs your attention')
                : nls.localize(
                    'qaap/workHubHome/subtitleNeedsYouMany',
                    '{0} items need your attention',
                    String(needsYou),
                );
        }
        if (running > 0) {
            return running === 1
                ? nls.localize('qaap/workHubHome/subtitleRunningOne', '1 agent moving work toward PR')
                : nls.localize(
                    'qaap/workHubHome/subtitleRunningMany',
                    '{0} agents moving work toward PR',
                    String(running),
                );
        }
        const { stats } = snapshot;
        if (stats.needsYou > 0) {
            return stats.needsYou === 1
                ? nls.localize('qaap/workHubHome/subtitleNeedsYouOne', '1 item needs your attention')
                : nls.localize(
                    'qaap/workHubHome/subtitleNeedsYouMany',
                    '{0} items need your attention',
                    String(stats.needsYou),
                );
        }
        if (stats.runningTasks > 0) {
            return stats.runningTasks === 1
                ? nls.localize('qaap/workHubHome/subtitleRunningOne', '1 agent moving work toward PR')
                : nls.localize(
                    'qaap/workHubHome/subtitleRunningMany',
                    '{0} agents moving work toward PR',
                    String(stats.runningTasks),
                );
        }
        if (stats.openPullRequests > 0) {
            return stats.openPullRequests === 1
                ? nls.localize('qaap/workHubHome/subtitlePullRequestsOne', '1 pull request ready to review')
                : nls.localize(
                    'qaap/workHubHome/subtitlePullRequestsMany',
                    '{0} pull requests ready to review',
                    String(stats.openPullRequests),
                );
        }
        if (stats.projectCount === 0) {
            return nls.localize('qaap/workHubHome/subtitleNoProjects', 'Add a GitHub repository to start agent work');
        }
        return nls.localize('qaap/workHubHome/subtitleAllClear', 'Ready to capture the next task');
    }

    resolveHomeAgentLabel(agentId: string): string {
        const fromList = this.host.activeTasks?.getAgents().find(agent => agent.id === agentId)?.label;
        if (fromList) {
            return fromList.startsWith('@') ? fromList : `@${fromList}`;
        }
        return agentId.startsWith('@') ? agentId : `@${agentId}`;
    }

    renderHomeHubView(): void {
        const snapshot = this.buildHomeSnapshot();
        const host = document.createElement('div');
        host.className = 'theia-mobile-work-hub-home-host';
        this.host.missionControlHubUi.render(host);
        if (!this.host.missionControlExpanded) {
            const overviewHost = document.createElement('div');
            overviewHost.className = 'theia-mobile-work-hub-home-overview-host';
            this.host.ensureOverlayUi().home.renderDashboard(overviewHost, snapshot);
            host.append(overviewHost);
        }
        this.host.scroll.append(host);
        this.host.renderSubtitle();
    }

    resolveHomePinnedProject(): MobileProjectEntry | undefined {
        if (this.host.agentsHubSelectedProjectId) {
            const selected = this.host.projects.find(p => p.id === this.host.agentsHubSelectedProjectId);
            if (selected) {
                return selected;
            }
        }
        const fromWorkspace = this.host.projectsService.resolveCurrentWorkspaceProject(this.host.projects);
        if (fromWorkspace) {
            return fromWorkspace;
        }
        return this.host.projects.find(project => project.pinned)
            ?? this.host.projects[0];
    }

    onHomeNavigate(target: WorkHubHomeNavigateTarget): void {
        this.host.navigateHubTab(target);
    }

    async onHomeOpenProject(project: MobileProjectEntry): Promise<void> {
        await this.host.openProjectDetail(project);
    }

    async onHomeOpenRecent(item: WorkHubHomeRecentItem): Promise<void> {
        const project = this.host.projects.find(entry => entry.id === item.projectId);
        if (!project) {
            return;
        }
        const summary = this.host.conversationIndexUi.conversationsForProject(project).find(entry => entry.id === item.id);
        if (!summary) {
            return;
        }
        await this.host.transcriptSheetUi.openTranscriptSheet(project, summary);
    }

    onHomeOpenAttention(item: WorkHubHomeAttentionItem): void {
        if (item.kind === 'pull-request') {
            this.host.selectHubLandingView('review');
            return;
        }
        this.host.selectHubLandingView('tasks');
    }

    async onHomeQuickAction(action: WorkHubHomeQuickActionId): Promise<void> {
        switch (action) {
            case 'open-tasks':
                this.host.selectHubLandingView('tasks');
                return;
            case 'all-projects':
                this.host.selectHubLandingView('repos');
                return;
            case 'open-review':
                this.host.selectHubLandingView('review');
                return;
            case 'new-chat': {
                const project = this.resolveHomePinnedProject();
                if (!project) {
                    this.host.selectHubLandingView('repos');
                    return;
                }
                this.host.preferComposerSurface('chat', this.host.projectsService.getProjectCwd(project));
                await this.host.openProjectDetail(project);
                return;
            }
            case 'delegate-task': {
                const project = this.resolveHomePinnedProject();
                if (!project) {
                    this.host.selectHubLandingView('repos');
                    return;
                }
                this.host.preferComposerSurface('task', this.host.projectsService.getProjectCwd(project));
                await this.host.openProjectDetail(project);
                return;
            }
        }
    }

}

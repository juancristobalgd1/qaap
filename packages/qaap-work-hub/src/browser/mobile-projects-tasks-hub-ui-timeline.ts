import type { MobileProjectsTasksHubUiContext } from './mobile-projects-tasks-hub-ui-context';
// Extracted from mobile-projects-tasks-hub-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { type MobileWorkHubInboxItem } from './mobile-work-hub-inbox';
import {
    summarizeTaskStates,
    type MobileProjectsActiveTasks,
} from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    filterTaskHistoryEntries,
    type MobileProjectTaskHistoryEntry,
    type MobileProjectTaskHistoryFilters,
} from './mobile-projects-task-history-filters';

export function appendTasksHubTeamSectionExtracted(ctx: MobileProjectsTasksHubUiContext, container: HTMLElement): boolean {
        const { members, filteredApprovals } = ctx.host.getFilteredTeamHubState();
        const teamHost = document.createElement('div');
        teamHost.className = 'theia-mobile-hub-team-root theia-mod-embedded-in-tasks';
        const rendered = ctx.host.ensureOverlayUi().teamHub.renderSections(teamHost, members, {
            searchQuery: ctx.host.query,
            approvals: filteredApprovals,
            embedded: true,
        });
        if (rendered) {
            container.append(teamHost);
        }
        return rendered;
}

export function renderTasksHubViewExtracted(ctx: MobileProjectsTasksHubUiContext, projects: MobileProjectEntry[]): void {
        if (ctx.host.shouldUseAgentsHubLanding()) {
            void projects;
            ctx.host.renderAgentsHubExecutionShell();
            return;
        }
        if (ctx.host.agentsHubShellActive) {
            ctx.host.teardownAgentsHubExecutionShell();
        }
        const root = document.createElement('div');
        root.className = 'theia-mobile-tasks-hub-root';
        if (ctx.host.tasksHubSurface === 'chat') {
            const groups = ctx.host.collectChatHubGroups(projects);
            if (groups.length === 0) {
                root.append(ctx.host.createChatEmptyState());
            } else {
                const host = document.createElement('div');
                host.className = 'theia-mobile-projects-chats-inbox theia-mod-local-chat';
                for (const group of groups) {
                    const items: MobileWorkHubInboxItem[] = group.summaries.map(summary => ({
                        kind: 'conversation',
                        project: group.project,
                        summary,
                        sortAt: summary.updatedAt,
                        priority: 0,
                    }));
                    host.append(ctx.host.createInboxProjectGroup(group.project, items));
                }
                root.append(host);
            }
            ctx.host.hubIncrementalUi.rememberRenderedStructure('chat-inbox', groups.map(group => ({
                project: group.project,
                items: group.summaries.map(summary => ({
                    kind: 'conversation' as const,
                    project: group.project,
                    summary,
                    sortAt: summary.updatedAt,
                    priority: 0,
                })),
            })));
            ctx.host.scroll.append(root);
            ctx.updateTasksAttentionChrome();
            ctx.host.renderSubtitle();
            return;
        }

        if (ctx.host.activeTasks) {
            root.append(createTaskTransportStatus(ctx.host.activeTasks));
            const queueSummary = createTaskQueueSummary(ctx.host.activeTasks);
            if (queueSummary) {
                root.append(queueSummary);
            }
            const taskHistory = createTaskHistoryBlock(ctx, projects, ctx.host.activeTasks);
            if (taskHistory) {
                root.append(taskHistory);
            }
        }
        const groups = ctx.host.collectTasksInboxGroups(projects);
        const teamRendered = ctx.appendTasksHubTeamSection(root);

        if (groups.length > 0) {
            const inbox = document.createElement('div');
            inbox.className = 'theia-mobile-projects-chats-inbox theia-mod-tasks-inbox';
            if (teamRendered) {
                const inboxHead = document.createElement('div');
                inboxHead.className = 'theia-mobile-tasks-inbox-section-head';
                const inboxLabel = document.createElement('span');
                inboxLabel.className = 'theia-mobile-tasks-inbox-section-label';
                inboxLabel.textContent = nls.localize('qaap/mobileProjects/tasksInboxSection', 'By project');
                inboxHead.append(inboxLabel);
                inbox.append(inboxHead);
            }
            for (const group of groups) {
                inbox.append(ctx.host.createInboxProjectGroup(group.project, group.items));
            }
            root.append(inbox);
            ctx.host.hubIncrementalUi.rememberRenderedStructure('tasks-inbox', groups, { teamEmbedded: teamRendered });
        }

        if (!teamRendered && groups.length === 0) {
            if (ctx.host.tasksFirstLoadPending && !ctx.host.query.trim()) {
                root.append(ctx.createTasksLoadingState());
            } else {
                root.append(ctx.createTasksEmptyState());
            }
        }
        ctx.host.scroll.append(root);
        ctx.updateTasksAttentionChrome();
        ctx.host.renderSubtitle();
}

function createTaskTransportStatus(activeTasks: MobileProjectsActiveTasks): HTMLElement {
        const state = activeTasks.getTransportState();
        const status = document.createElement('div');
        status.className = `theia-mobile-agent-tasks-transport theia-mod-${state}`;
        status.setAttribute('role', 'status');
        status.textContent = state === 'connected'
            ? nls.localize('qaap/mobileProjects/taskTransportConnected', 'Live task connection: connected')
            : state === 'reconnecting'
                ? nls.localize('qaap/mobileProjects/taskTransportReconnecting', 'Live task connection: reconnecting…')
                : nls.localize('qaap/mobileProjects/taskTransportDisconnected', 'Live task connection: disconnected. Tasks continue on the server and will resync automatically.');
        return status;
}

function createTaskQueueSummary(activeTasks: MobileProjectsActiveTasks): HTMLElement | undefined {
        const counts = summarizeTaskStates(activeTasks.getAllTasks());
        const entries: Array<{ readonly key: string; readonly label: string; readonly count: number }> = [
            { key: 'queued', label: nls.localize('qaap/mobileProjects/taskQueueQueued', 'Waiting'), count: counts.queued },
            { key: 'running', label: nls.localize('qaap/mobileProjects/taskQueueRunning', 'Running'), count: counts.running },
            { key: 'blocked', label: nls.localize('qaap/mobileProjects/taskQueueBlocked', 'Blocked'), count: counts.blocked },
            { key: 'failed', label: nls.localize('qaap/mobileProjects/taskQueueFailed', 'Failed'), count: counts.failed },
            { key: 'interrupted', label: nls.localize('qaap/mobileProjects/taskQueueInterrupted', 'Interrupted'), count: counts.interrupted },
        ].filter(entry => entry.count > 0);
        if (entries.length === 0) {
            return undefined;
        }
        const summary = document.createElement('div');
        summary.className = 'theia-mobile-agent-tasks-queue-summary';
        summary.setAttribute('role', 'status');
        summary.setAttribute(
            'aria-label',
            nls.localize('qaap/mobileProjects/taskQueueSummaryAria', 'Task queue: {0}', entries.map(entry => `${entry.count} ${entry.label}`).join(', ')),
        );
        const label = document.createElement('span');
        label.className = 'theia-mobile-agent-tasks-queue-label';
        label.textContent = nls.localize('qaap/mobileProjects/taskQueueLabel', 'Task queue');
        summary.append(label);
        for (const entry of entries) {
            const chip = document.createElement('span');
            chip.className = `theia-mobile-agent-tasks-queue-chip theia-mod-${entry.key}`;
            chip.textContent = `${entry.label} ${entry.count}`;
            summary.append(chip);
        }
        return summary;
}

function createTaskHistoryBlock(
    ctx: MobileProjectsTasksHubUiContext,
    projects: MobileProjectEntry[],
    activeTasks: MobileProjectsActiveTasks,
): HTMLElement | undefined {
    const entries = collectTaskHistoryEntries(activeTasks, projects);
    if (entries.length === 0) {
        return undefined;
    }
    const filters: MobileProjectTaskHistoryFilters = ctx.getTaskHistoryFilters();
    const matching = filterTaskHistoryEntries(entries, filters);
    const section = document.createElement('section');
    section.className = 'theia-mobile-agent-tasks-history';
    section.setAttribute(
        'aria-label',
        nls.localize('qaap/mobileProjects/taskHistoryAria', 'Task history'),
    );

    const head = document.createElement('div');
    head.className = 'theia-mobile-agent-tasks-history-head';
    const title = document.createElement('span');
    title.className = 'theia-mobile-agent-tasks-history-title';
    title.textContent = nls.localize('qaap/mobileProjects/taskHistoryTitle', 'Task history');
    const count = document.createElement('span');
    count.className = 'theia-mobile-agent-tasks-history-count';
    count.textContent = entries.length === matching.length
        ? String(matching.length)
        : nls.localize(
            'qaap/mobileProjects/taskHistoryFilteredCount',
            '{0} of {1}',
            String(matching.length),
            String(entries.length),
        );
    head.append(title, count);
    section.append(head, createTaskHistoryFilters(ctx, projects, filters));

    if (matching.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'theia-mobile-agent-tasks-history-empty';
        empty.textContent = entries.length === 0
            ? nls.localize('qaap/mobileProjects/taskHistoryEmpty', 'No background tasks yet.')
            : nls.localize(
                'qaap/mobileProjects/taskHistoryNoMatches',
                'No tasks match these filters.',
            );
        section.append(empty);
        return section;
    }

    const list = document.createElement('div');
    list.className = 'theia-mobile-projects-chats-list theia-mobile-agent-tasks-history-list';
    for (const entry of matching) {
        const row = ctx.host.projectRowsUi.createTaskItem(
            entry.project,
            entry.task,
            ctx.host.activeInfoForProject(entry.project),
        );
        row.classList.add('theia-mod-task-history-row');
        row.dataset.qaapTaskHistoryId = entry.task.id;
        list.append(row);
    }
    section.append(list);
    return section;
}

function createTaskHistoryFilters(
    ctx: MobileProjectsTasksHubUiContext,
    projects: MobileProjectEntry[],
    filters: MobileProjectTaskHistoryFilters,
): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'theia-mobile-agent-tasks-history-filters';
    wrapper.setAttribute(
        'aria-label',
        nls.localize('qaap/mobileProjects/taskHistoryFiltersAria', 'Filter task history'),
    );

    const projectOptions = [
        { value: '', label: nls.localize('qaap/mobileProjects/taskHistoryAllProjects', 'All projects') },
        ...projects.map(project => ({ value: project.id, label: project.name })),
    ];
    wrapper.append(createTaskHistorySelect(
        ctx,
        'projectId',
        nls.localize('qaap/mobileProjects/taskHistoryProjectFilter', 'Project'),
        filters.projectId,
        projectOptions,
    ));
    wrapper.append(createTaskHistorySelect(
        ctx,
        'state',
        nls.localize('qaap/mobileProjects/taskHistoryStateFilter', 'State'),
        filters.state,
        [
            { value: 'all', label: nls.localize('qaap/mobileProjects/taskHistoryAllStates', 'All states') },
            { value: 'queued', label: nls.localize('qaap/mobileProjects/taskQueueQueued', 'Waiting') },
            { value: 'running', label: nls.localize('qaap/mobileProjects/taskQueueRunning', 'Running') },
            { value: 'blocked', label: nls.localize('qaap/mobileProjects/taskQueueBlocked', 'Blocked') },
            { value: 'failed', label: nls.localize('qaap/mobileProjects/taskQueueFailed', 'Failed') },
            { value: 'interrupted', label: nls.localize('qaap/mobileProjects/taskQueueInterrupted', 'Interrupted') },
            { value: 'completed', label: nls.localize('qaap/mobileProjects/taskHistoryCompleted', 'Completed') },
        ],
    ));
    wrapper.append(createTaskHistorySelect(
        ctx,
        'date',
        nls.localize('qaap/mobileProjects/taskHistoryDateFilter', 'Date'),
        filters.date,
        [
            { value: 'all', label: nls.localize('qaap/mobileProjects/taskHistoryAnyDate', 'Any time') },
            { value: 'today', label: nls.localize('qaap/mobileProjects/taskHistoryToday', 'Today') },
            { value: '7d', label: nls.localize('qaap/mobileProjects/taskHistoryLast7Days', 'Last 7 days') },
            { value: '30d', label: nls.localize('qaap/mobileProjects/taskHistoryLast30Days', 'Last 30 days') },
        ],
    ));

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'theia-mobile-agent-tasks-history-clear';
    clear.textContent = nls.localize('qaap/mobileProjects/taskHistoryClearFilters', 'Clear');
    clear.disabled = !filters.projectId && filters.state === 'all' && filters.date === 'all';
    clear.addEventListener('click', () => { ctx.clearTaskHistoryFilters(); });
    wrapper.append(clear);
    return wrapper;
}

function createTaskHistorySelect(
    ctx: MobileProjectsTasksHubUiContext,
    key: 'projectId' | 'state' | 'date',
    labelText: string,
    value: string,
    options: Array<{ value: string; label: string }>,
): HTMLElement {
    const label = document.createElement('label');
    label.className = 'theia-mobile-agent-tasks-history-filter';
    const text = document.createElement('span');
    text.className = 'theia-mobile-agent-tasks-history-filter-label';
    text.textContent = labelText;
    const select = document.createElement('select');
    select.className = 'theia-mobile-agent-tasks-history-filter-select';
    select.value = value;
    select.setAttribute('aria-label', labelText);
    for (const option of options) {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.textContent = option.label;
        optionElement.selected = option.value === value;
        select.append(optionElement);
    }
    select.addEventListener('change', () => {
        ctx.setTaskHistoryFilter(key, select.value);
    });
    label.append(text, select);
    return label;
}

function collectTaskHistoryEntries(
    activeTasks: MobileProjectsActiveTasks,
    projects: MobileProjectEntry[],
): MobileProjectTaskHistoryEntry[] {
    const entries: MobileProjectTaskHistoryEntry[] = [];
    const seenTaskIds = new Set<string>();
    for (const project of projects) {
        for (const task of activeTasks.findTasksForProject(project)) {
            if (seenTaskIds.has(task.id)) {
                continue;
            }
            seenTaskIds.add(task.id);
            entries.push({ project, task });
        }
    }
    return entries;
}


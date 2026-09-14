// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { retryAgentTask, type QaapAgentTaskDetailDTO } from '../common/qaap-agent-task-client';
import type { MobileProjectsActiveTasks } from './mobile-projects-active-tasks';
import type { MobileProjectsService } from './mobile-projects-service';
import type { MobileProjectEntry } from './mobile-projects-types';
import { MobileSnackbar } from './mobile-snackbar';

/** Panel surface for VPS background-task cancel and log viewer. */
export interface MobileProjectsActiveTaskActionsHost {
    root: HTMLElement;
    projects: MobileProjectEntry[];
    projectsService: MobileProjectsService;
    activeTasks?: MobileProjectsActiveTasks;
    delegate: { onProjectsChanged?(): void };

    closeCardMenu(): void;
    render(): void;
    cardMenuUi: import('./mobile-projects-card-menu-ui').MobileProjectsCardMenuUi;
}

export class MobileProjectsActiveTaskActionsUi {
    constructor(protected readonly host: MobileProjectsActiveTaskActionsHost) { }

    async cancelActiveTask(taskId: string): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        try {
            const response = await fetch(`/qaap/api/agent-tasks/${encodeURIComponent(taskId)}/cancel`, {
                method: 'POST',
                credentials: 'include',
            });
            if (response.ok) {
                this.host.activeTasks?.recordTaskEnded(await response.json());
                MobileSnackbar.show(
                    nls.localize('qaap/mobileProjects/taskCancelled', 'Task cancelled'),
                    { duration: 1400 },
                );
            }
        } finally {
            this.host.projects = await this.host.projectsService.loadProjects();
            this.host.render();
            this.host.delegate.onProjectsChanged?.();
        }
    }

    async retryActiveTask(taskId: string): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        try {
            const task = await retryAgentTask(taskId);
            this.host.activeTasks?.recordTaskCreated(task);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/taskRetried', 'Task restarted'),
                { kind: 'success', duration: 1400 },
            );
        } catch (error) {
            MobileSnackbar.show(nls.localize(
                'qaap/mobileProjects/retryTaskFailed',
                'Could not retry: {0}',
                error instanceof Error ? error.message : String(error),
            ), { kind: 'warning', duration: 3200 });
        } finally {
            this.host.projects = await this.host.projectsService.loadProjects();
            this.host.render();
            this.host.delegate.onProjectsChanged?.();
        }
    }

    async showTaskLog(project: MobileProjectEntry, taskId: string): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        const root = document.createElement('div');
        root.className = 'theia-mobile-agent-log theia-mod-visible';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');

        const backdrop = document.createElement('div');
        backdrop.className = 'theia-mobile-agent-log-backdrop';
        const sheet = document.createElement('section');
        sheet.className = 'theia-mobile-agent-log-sheet';
        const header = document.createElement('header');
        header.className = 'theia-mobile-agent-log-header';
        const title = document.createElement('h2');
        title.textContent = nls.localize('qaap/mobileProjects/activeLogTitle', '{0} log', project.name);
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'theia-mobile-agent-log-close codicon codicon-close';
        close.title = nls.localize('qaap/mobileProjects/closeLog', 'Close');
        close.setAttribute('aria-label', close.title);
        const pre = document.createElement('pre');
        pre.className = 'theia-mobile-agent-log-output';
        pre.textContent = nls.localize('qaap/mobileProjects/loadingLog', 'Loading...');
        const meta = document.createElement('div');
        meta.className = 'theia-mobile-agent-log-meta';
        const dispose = (): void => root.remove();
        close.addEventListener('click', dispose);
        backdrop.addEventListener('click', dispose);
        header.append(title, close);
        sheet.append(header, meta, pre);
        root.append(backdrop, sheet);
        this.host.root.append(root);
        try {
            const response = await fetch(`/qaap/api/agent-tasks/${encodeURIComponent(taskId)}`, { credentials: 'include' });
            if (response.ok) {
                const detail = await response.json() as QaapAgentTaskDetailDTO;
                this.renderTaskMetadata(meta, detail, taskId, dispose);
                pre.textContent = detail.log || nls.localize('qaap/mobileProjects/noLogOutput', '(no output yet)');
            } else {
                pre.textContent = response.statusText;
            }
        } catch (error) {
            pre.textContent = error instanceof Error ? error.message : String(error);
        }
    }

    protected renderTaskMetadata(
        host: HTMLElement,
        detail: QaapAgentTaskDetailDTO,
        taskId: string,
        close: () => void,
    ): void {
        host.replaceChildren();
        const knownTask = this.host.activeTasks?.getAllTasks().find(task => task.id === taskId);
        const agentId = detail.agentId ?? knownTask?.agentId ?? nls.localize('qaap/mobileProjects/unknownAgent', 'unknown agent');
        const state = detail.state || knownTask?.state || 'unknown';
        appendTaskMeta(host, nls.localize('qaap/mobileProjects/taskAgentLabel', 'Agent'), formatAgentId(agentId));
        appendTaskMeta(host, nls.localize('qaap/mobileProjects/taskStateLabel', 'State'), taskStateLabel(state));
        appendTaskMeta(host, nls.localize('qaap/mobileProjects/taskCommandLabel', 'Command'), detail.command ?? knownTask?.command ?? '—');
        appendTaskMeta(host, nls.localize('qaap/mobileProjects/taskCauseLabel', 'Cause'), taskCause(detail));
        appendTaskMeta(host, nls.localize('qaap/mobileProjects/taskNextActionLabel', 'Next action'), taskNextAction(state));

        if (state === 'failed' || state === 'interrupted') {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'theia-mobile-agent-log-retry';
            retry.textContent = nls.localize('qaap/mobileProjects/retryTask', 'Retry task');
            retry.addEventListener('click', () => {
                close();
                void this.retryActiveTask(taskId);
            });
            host.append(retry);
        }
    }
}

function appendTaskMeta(host: HTMLElement, label: string, value: string): void {
    const row = document.createElement('div');
    row.className = 'theia-mobile-agent-log-meta-row';
    const name = document.createElement('span');
    name.className = 'theia-mobile-agent-log-meta-label';
    name.textContent = `${label}:`;
    const content = document.createElement('span');
    content.className = 'theia-mobile-agent-log-meta-value';
    content.textContent = value;
    row.append(name, content);
    host.append(row);
}

function formatAgentId(agentId: string): string {
    const trimmed = agentId.trim();
    return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function taskStateLabel(state: string): string {
    switch (state) {
        case 'queued': return nls.localize('qaap/mobileProjects/taskStateWaiting', 'Waiting');
        case 'running': return nls.localize('qaap/mobileProjects/taskStateRunning', 'Running');
        case 'blocked': return nls.localize('qaap/mobileProjects/taskStateBlocked', 'Blocked');
        case 'failed': return nls.localize('qaap/mobileProjects/taskStateFailed', 'Failed');
        case 'interrupted': return nls.localize('qaap/mobileProjects/taskStateInterrupted', 'Interrupted');
        case 'completed': return nls.localize('qaap/mobileProjects/taskStateCompleted', 'Completed');
        case 'completed_with_warnings': return nls.localize('qaap/mobileProjects/taskStateWarnings', 'Completed with warnings');
        case 'cancelled': return nls.localize('qaap/mobileProjects/taskStateCancelled', 'Cancelled');
        default: return state;
    }
}

function taskCause(detail: QaapAgentTaskDetailDTO): string {
    if (detail.state === 'interrupted') {
        return nls.localize('qaap/mobileProjects/taskCauseInterrupted', 'The server or browser connection interrupted the task.');
    }
    if (detail.state === 'blocked') {
        return nls.localize('qaap/mobileProjects/taskCauseBlocked', 'The agent needs a decision or more information.');
    }
    if (detail.state === 'cancelled') {
        return nls.localize('qaap/mobileProjects/taskCauseCancelled', 'Cancelled by the user.');
    }
    const lines = detail.log.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    return lines.at(-1) ?? nls.localize('qaap/mobileProjects/taskCauseUnavailable', 'No cause was reported.');
}

function taskNextAction(state: string): string {
    switch (state) {
        case 'failed':
        case 'interrupted': return nls.localize('qaap/mobileProjects/taskNextRetry', 'Retry the task.');
        case 'blocked': return nls.localize('qaap/mobileProjects/taskNextResolveBlock', 'Resolve the request, then continue from the task transcript.');
        case 'queued': return nls.localize('qaap/mobileProjects/taskNextWait', 'Wait for an available agent slot.');
        case 'running': return nls.localize('qaap/mobileProjects/taskNextMonitor', 'Monitor the live log or cancel it if needed.');
        case 'completed_with_warnings': return nls.localize('qaap/mobileProjects/taskNextWarnings', 'Review the verification warnings.');
        case 'completed': return nls.localize('qaap/mobileProjects/taskNextReview', 'Review the task result and changed files.');
        case 'cancelled': return nls.localize('qaap/mobileProjects/taskNextCancelled', 'Run the task again if you still need it.');
        default: return nls.localize('qaap/mobileProjects/taskNextUnknown', 'Open the task details for the next step.');
    }
}

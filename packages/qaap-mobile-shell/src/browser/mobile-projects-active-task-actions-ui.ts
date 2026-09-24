// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { reorderAgentTask, resumeAgentTask, retryAgentTask, type QaapAgentTaskDetailDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';
import type { MobileProjectsActiveTasks } from '@theia/qaap-shared-core/lib/browser/mobile-projects-active-tasks';
import type { MobileProjectsService } from '@theia/qaap-shared-core/lib/browser/mobile-projects-service';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import { MobileSnackbar } from '@theia/qaap-mobile-mechanics/lib/browser/mobile-snackbar';

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

    async continueActiveTask(taskId: string): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        try {
            const task = await resumeAgentTask(taskId);
            this.host.activeTasks?.recordTaskCreated(task);
            MobileSnackbar.show(
                nls.localize('qaap/mobileProjects/taskContinued', 'Task continued'),
                { kind: 'success', duration: 1400 },
            );
        } catch (error) {
            MobileSnackbar.show(nls.localize(
                'qaap/mobileProjects/continueTaskFailed',
                'Could not continue: {0}',
                error instanceof Error ? error.message : String(error),
            ), { kind: 'warning', duration: 3200 });
        } finally {
            this.host.projects = await this.host.projectsService.loadProjects();
            this.host.render();
            this.host.delegate.onProjectsChanged?.();
        }
    }

    async reorderQueuedTask(taskId: string, direction: 'up' | 'down'): Promise<void> {
        this.host.cardMenuUi.closeCardMenu();
        try {
            const task = await reorderAgentTask(taskId, direction);
            this.host.activeTasks?.recordTaskCreated(task);
            MobileSnackbar.show(
                direction === 'up'
                    ? nls.localize('qaap/mobileProjects/taskMovedUp', 'Task moved up in the queue')
                    : nls.localize('qaap/mobileProjects/taskMovedDown', 'Task moved down in the queue'),
                { kind: 'success', duration: 1400 },
            );
        } catch (error) {
            MobileSnackbar.show(nls.localize(
                'qaap/mobileProjects/reorderTaskFailed',
                'Could not reorder: {0}',
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
        const createdAt = detail.createdAt ?? knownTask?.createdAt;
        const startedAt = detail.startedAt ?? knownTask?.startedAt ?? (state !== 'queued' ? createdAt : undefined);
        const finishedAt = detail.finishedAt ?? knownTask?.finishedAt;
        if (createdAt !== undefined) {
            appendTaskMeta(
                host,
                nls.localize('qaap/mobileProjects/taskDurationLabel', 'Duration'),
                formatTaskDuration(createdAt, finishedAt),
            );
        }
        const queuePosition = detail.queuePosition ?? knownTask?.queuePosition;
        if (state === 'queued' && queuePosition !== undefined) {
            appendTaskMeta(
                host,
                nls.localize('qaap/mobileProjects/taskQueuePositionLabel', 'Queue position'),
                `#${queuePosition}`,
            );
        }
        appendTaskMeta(host, nls.localize('qaap/mobileProjects/taskCauseLabel', 'Cause'), taskCause(detail));
        appendTaskMeta(host, nls.localize('qaap/mobileProjects/taskNextActionLabel', 'Next action'), taskNextAction(state));
        if (createdAt !== undefined) {
            renderTaskTimeline(host, state, createdAt, startedAt, finishedAt);
        }

        const diagnosticText = buildTaskDiagnostic(detail, knownTask);
        const diagnosticActions = document.createElement('div');
        diagnosticActions.className = 'theia-mobile-agent-log-actions';
        const diagnostic = document.createElement('button');
        diagnostic.type = 'button';
        diagnostic.className = 'theia-mobile-agent-log-copy';
        diagnostic.textContent = nls.localize('qaap/mobileProjects/copyTaskDiagnostic', 'Copy diagnostic');
        diagnostic.addEventListener('click', async () => {
            try {
                await copyTaskDiagnostic(diagnosticText);
                diagnostic.textContent = nls.localize('qaap/mobileProjects/taskDiagnosticCopied', 'Diagnostic copied');
                window.setTimeout(() => {
                    if (diagnostic.isConnected) {
                        diagnostic.textContent = nls.localize('qaap/mobileProjects/copyTaskDiagnostic', 'Copy diagnostic');
                    }
                }, 1600);
            } catch {
                MobileSnackbar.show(
                    nls.localize('qaap/mobileProjects/taskDiagnosticCopyFailed', 'Could not copy the diagnostic.'),
                    { kind: 'warning', duration: 2600 },
                );
            }
        });
        diagnosticActions.append(diagnostic);

        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'theia-mobile-agent-log-download';
        download.textContent = nls.localize('qaap/mobileProjects/downloadTaskDiagnostic', 'Download diagnostic');
        download.addEventListener('click', () => {
            try {
                downloadTaskDiagnostic(diagnosticText, taskId);
                MobileSnackbar.show(
                    nls.localize('qaap/mobileProjects/taskDiagnosticDownloaded', 'Diagnostic downloaded'),
                    { kind: 'success', duration: 1600 },
                );
            } catch {
                MobileSnackbar.show(
                    nls.localize('qaap/mobileProjects/taskDiagnosticDownloadFailed', 'Could not download the diagnostic.'),
                    { kind: 'warning', duration: 2600 },
                );
            }
        });
        diagnosticActions.append(download);
        host.append(diagnosticActions);

        if (state === 'queued') {
            const queueActions = document.createElement('div');
            queueActions.className = 'theia-mobile-agent-log-queue-actions';
            for (const direction of ['up', 'down'] as const) {
                const action = document.createElement('button');
                action.type = 'button';
                action.className = 'theia-mobile-agent-log-queue-action';
                action.textContent = direction === 'up'
                    ? nls.localize('qaap/mobileProjects/moveTaskUp', 'Move up')
                    : nls.localize('qaap/mobileProjects/moveTaskDown', 'Move down');
                action.addEventListener('click', () => {
                    close();
                    void this.reorderQueuedTask(taskId, direction);
                });
                queueActions.append(action);
            }
            host.append(queueActions);
        }
        if (state === 'queued' || state === 'running') {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'theia-mobile-agent-log-cancel';
            action.textContent = nls.localize('qaap/mobileProjects/cancelTask', 'Cancel task');
            action.addEventListener('click', () => {
                close();
                void this.cancelActiveTask(taskId);
            });
            host.append(action);
        }
        if (state === 'failed' || state === 'interrupted') {
            const action = document.createElement('button');
            action.type = 'button';
            action.className = 'theia-mobile-agent-log-retry';
            action.textContent = state === 'interrupted'
                ? nls.localize('qaap/mobileProjects/continueTask', 'Continue task')
                : nls.localize('qaap/mobileProjects/retryTask', 'Retry task');
            action.addEventListener('click', () => {
                close();
                if (state === 'interrupted') {
                    void this.continueActiveTask(taskId);
                } else {
                    void this.retryActiveTask(taskId);
                }
            });
            host.append(action);
        }
    }
}

function formatTaskDuration(createdAt: number, finishedAt?: number): string {
    const elapsedMs = Math.max(0, (finishedAt ?? Date.now()) - createdAt);
    const totalSeconds = Math.floor(elapsedMs / 1000);
    if (totalSeconds < 60) {
        return nls.localize('qaap/mobileProjects/taskDurationSeconds', '{0}s', String(totalSeconds));
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
        return nls.localize('qaap/mobileProjects/taskDurationMinutes', '{0}m {1}s', String(minutes), String(seconds));
    }
    const hours = Math.floor(minutes / 60);
    return nls.localize('qaap/mobileProjects/taskDurationHours', '{0}h {1}m', String(hours), String(minutes % 60));
}

function renderTaskTimeline(host: HTMLElement, state: string, createdAt: number, startedAt?: number, finishedAt?: number): void {
    const timeline = document.createElement('section');
    timeline.className = 'theia-mobile-agent-log-timeline';
    const heading = document.createElement('h3');
    heading.textContent = nls.localize('qaap/mobileProjects/taskTimelineTitle', 'Timeline');
    const list = document.createElement('ol');
    list.className = 'theia-mobile-agent-log-timeline-list';

    appendTimelinePhase(
        list,
        'done',
        nls.localize('qaap/mobileProjects/taskTimelineSubmitted', 'Submitted'),
        formatTaskTime(createdAt),
    );

    const waitedForSlot = startedAt !== undefined && startedAt > createdAt;
    if (state === 'queued' || waitedForSlot) {
        appendTimelinePhase(
            list,
            state === 'queued' ? 'current' : 'done',
            nls.localize('qaap/mobileProjects/taskTimelineQueue', 'Queue'),
            state === 'queued'
                ? nls.localize('qaap/mobileProjects/taskTimelineWaiting', 'Waiting for an available agent slot · {0}', formatTaskDuration(createdAt))
                : nls.localize('qaap/mobileProjects/taskTimelineQueueDuration', '{0} wait', formatTaskDuration(createdAt, startedAt)),
        );
    }

    appendTimelinePhase(
        list,
        state === 'queued' ? 'pending' : state === 'running' ? 'current' : 'done',
        nls.localize('qaap/mobileProjects/taskTimelineExecution', 'Agent execution'),
        startedAt === undefined
            ? nls.localize('qaap/mobileProjects/taskTimelineNotStarted', 'Not started')
            : nls.localize('qaap/mobileProjects/taskTimelineExecutionDuration', '{0} · {1}', formatTaskTime(startedAt), formatTaskDuration(startedAt, finishedAt)),
    );

    appendTimelinePhase(
        list,
        finishedAt !== undefined ? 'done' : 'pending',
        nls.localize('qaap/mobileProjects/taskTimelineFinished', 'Finished'),
        finishedAt === undefined
            ? nls.localize('qaap/mobileProjects/taskTimelineNotFinished', 'Pending')
            : formatTaskTime(finishedAt),
    );
    timeline.append(heading, list);
    host.append(timeline);
}

function appendTimelinePhase(list: HTMLOListElement, status: 'done' | 'current' | 'pending', label: string, detail: string): void {
    const item = document.createElement('li');
    item.className = `theia-mobile-agent-log-timeline-phase theia-mod-${status}`;
    const marker = document.createElement('span');
    marker.className = 'theia-mobile-agent-log-timeline-marker';
    marker.setAttribute('aria-hidden', 'true');
    const content = document.createElement('div');
    content.className = 'theia-mobile-agent-log-timeline-content';
    const phase = document.createElement('strong');
    phase.textContent = label;
    const value = document.createElement('span');
    value.textContent = detail;
    content.append(phase, value);
    item.append(marker, content);
    list.append(item);
}

function formatTaskTime(value: number): string {
    return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildTaskDiagnostic(
    detail: QaapAgentTaskDetailDTO,
    knownTask: { readonly agentId?: string; readonly command: string; readonly createdAt: number; readonly finishedAt?: number; readonly state: string } | undefined,
): string {
    const createdAt = detail.createdAt ?? knownTask?.createdAt;
    const finishedAt = detail.finishedAt ?? knownTask?.finishedAt;
    const log = detail.log ?? '';
    const logTail = log.length > 12_000 ? `[truncated]\n${log.slice(-12_000)}` : log;
    return [
        'Qaap task diagnostic',
        `Task: ${detail.id}`,
        `State: ${detail.state || knownTask?.state || 'unknown'}`,
        `Agent: ${detail.agentId ?? knownTask?.agentId ?? 'unknown'}`,
        `Workspace: ${detail.cwd}`,
        `Command: ${detail.command ?? knownTask?.command ?? ''}`,
        createdAt !== undefined ? `Duration: ${formatTaskDuration(createdAt, finishedAt)}` : undefined,
        `Exit code: ${detail.exitCode ?? 'unknown'}`,
        '',
        'Log tail:',
        logTail || '(no output)',
    ].filter((line): line is string => line !== undefined).join('\n');
}

async function copyTaskDiagnostic(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) {
        throw new Error('Clipboard unavailable');
    }
}

function downloadTaskDiagnostic(text: string, taskId: string): void {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeId = taskId.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'task';
    link.href = url;
    link.download = `qaap-${safeId}-diagnostic.txt`;
    link.rel = 'noopener';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
        return nls.localize('qaap/mobileProjects/taskCauseInterrupted', 'The backend lost the running process. A browser reload does not cancel a task.');
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
            return nls.localize('qaap/mobileProjects/taskNextRetry', 'Retry the task.');
        case 'interrupted': return nls.localize('qaap/mobileProjects/taskNextContinue', 'Continue the task from its persisted request.');
        case 'blocked': return nls.localize('qaap/mobileProjects/taskNextResolveBlock', 'Resolve the request, then continue from the task transcript.');
        case 'queued': return nls.localize('qaap/mobileProjects/taskNextWait', 'Wait for an available agent slot.');
        case 'running': return nls.localize('qaap/mobileProjects/taskNextMonitor', 'Monitor the live log or cancel it if needed.');
        case 'completed_with_warnings': return nls.localize('qaap/mobileProjects/taskNextWarnings', 'Review the verification warnings.');
        case 'completed': return nls.localize('qaap/mobileProjects/taskNextReview', 'Review the task result and changed files.');
        case 'cancelled': return nls.localize('qaap/mobileProjects/taskNextCancelled', 'Run the task again if you still need it.');
        default: return nls.localize('qaap/mobileProjects/taskNextUnknown', 'Open the task details for the next step.');
    }
}

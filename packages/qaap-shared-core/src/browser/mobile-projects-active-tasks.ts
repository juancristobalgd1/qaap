// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Emitter, Event } from '@theia/core/lib/common/event';
import { injectable, unmanaged } from '@theia/core/shared/inversify';
import {
    defaultQaapChatViewStreamUpdateClocks,
    QaapChatViewStreamUpdateScheduler,
    type QaapChatViewStreamUpdateClocks,
} from '../common/qaap-chat-view-stream-update-scheduler';
import {
    appendWorkingDetailTaskLogChunk,
    seedWorkingDetailTaskLog,
    WORKING_DETAIL_TASK_LOG_MAX_BYTES,
} from './qaap-sticky-composer-working-detail-task-log';

/**
 * HTTP contract with `@theia/qaap-cloud-workspace`. The string is duplicated here on purpose:
 * cloud-workspace already depends on mobile-shell, so we cannot import the constant from there
 * without a dependency cycle. Keep in sync with `QAAP_AGENT_TASK_API_PATH`.
 */
const AGENT_TASK_API_PATH = '/qaap/api/agent-tasks';
const WS_PATH = `${AGENT_TASK_API_PATH}/ws`;

/** Exponential backoff cap for WebSocket reconnects. */
const RECONNECT_MAX_MS = 30_000;
const ACTIVE_TASKS_BACKGROUND_CHANGE_COALESCE_MS = 120;

export type MobileProjectTaskTransportState = 'connected' | 'reconnecting' | 'disconnected';

/**
 * Backend self-verification outcome for a QAIQ task that edited files. Mirrors
 * `QaapAgentTaskVerification` in `@theia/qaap-cloud-workspace`; kept local on purpose to avoid a
 * package dependency cycle (cloud-workspace already imports from mobile-shell).
 */
export type MobileProjectTaskVerification =
    | { readonly status: 'skipped' }
    | { readonly status: 'passed'; readonly command: string; readonly attempts: number }
    | { readonly status: 'failed'; readonly command: string; readonly attempts: number; readonly summary: string };

/** Task row as shown in the mobile Projects panel (mirrors VPS agent-task API). */
export interface MobileProjectTaskView {
    readonly agentId?: string;
    readonly id: string;
    readonly title: string;
    readonly command: string;
    readonly cwd: string;
    readonly state: string;
    readonly createdAt: number;
    readonly startedAt?: number;
    readonly finishedAt?: number;
    /** Lower values run first while the task is queued. */
    readonly queuePosition?: number;
    /** Set when spawned by a leader via `qaap-task`. */
    readonly parentId?: string;
    /** Backend self-verification result (passed/failed/skipped) when QAAP_AGENT_VERIFY ran. */
    readonly verification?: MobileProjectTaskVerification;
}

interface TaskEventPayload {
    readonly agentId?: string;
    readonly id: string;
    readonly cwd: string;
    readonly state: string;
    readonly title?: string;
    readonly command?: string;
    readonly createdAt?: number;
    readonly startedAt?: number;
    readonly finishedAt?: number;
    readonly queuePosition?: number;
    readonly parentId?: string;
    readonly verification?: MobileProjectTaskVerification;
}

export interface MobileProjectAgentDescriptor {
    readonly id: string;
    readonly label: string;
    readonly available: boolean;
}

interface SnapshotPayload {
    readonly groups?: ReadonlyArray<{
        readonly cwd: string;
        readonly activeCount: number;
        readonly tasks: ReadonlyArray<TaskEventPayload>;
    }>;
    readonly agentConfigured?: boolean;
    readonly agents?: ReadonlyArray<MobileProjectAgentDescriptor>;
    readonly defaultAgent?: string;
}

type WsServerMessage =
    | ({ readonly type: 'snapshot' } & SnapshotPayload)
    | { readonly type: 'heartbeat' }
    | { readonly type: 'created' | 'completed' | 'cancelled' | 'deleted' | 'reordered'; readonly task: TaskEventPayload }
    | { readonly type: 'output'; readonly task: TaskEventPayload; readonly chunk: string };

/** Snapshot of what's running in one project. */
export interface MobileProjectActiveTaskInfo {
    /** Number of tasks currently in the `'running'` state for this cwd. */
    readonly activeCount: number;
    /** Id of the most recent running task — used for cancel/log quick actions. */
    readonly taskId?: string;
    /** Title of the most recent running task — used as the card subtitle. */
    readonly title?: string;
}

/** Live stdout/stderr tail for a VPS task (Working DETAIL command log). */
export interface MobileProjectTaskLogTail {
    readonly taskId: string;
    readonly text: string;
    readonly truncated: boolean;
}

/** Counts used by the Tasks hub queue summary. */
export interface MobileProjectTaskStateCounts {
    readonly queued: number;
    readonly running: number;
    readonly blocked: number;
    readonly failed: number;
    readonly interrupted: number;
    readonly completed: number;
    readonly completedWithWarnings: number;
}

/**
 * Listens to the cross-project agent-task WebSocket and exposes a live view of what is running on
 * the VPS, keyed by absolute working directory. The projects panel consults this to flip cards
 * to a `working` state without polling.
 *
 * The first message from the server is always a `snapshot` that primes the full state, eliminating
 * the separate HTTP `/all` fetch that the previous SSE approach required. Reconnects use
 * exponential backoff (1 s → 2 s → 4 s → … → 30 s cap).
 */
@injectable()
export class MobileProjectsActiveTasks {

    /** Active-task summary keyed by normalized cwd. */
    protected readonly activeByCwd = new Map<string, MobileProjectActiveTaskInfo>();
    /** Full task lists per cwd (newest first), for the expanded project task block. */
    protected readonly tasksByCwd = new Map<string, MobileProjectTaskView[]>();
    /** Live stdout/stderr tails keyed by task id (WS `output` chunks + HTTP seed). */
    protected readonly logByTaskId = new Map<string, MobileProjectTaskLogTail>();
    protected socket: WebSocket | undefined;
    protected reconnectHandle: number | undefined;
    protected reconnectAttempt = 0;
    protected started = false;
    protected transportState: MobileProjectTaskTransportState = 'disconnected';
    protected agents: MobileProjectAgentDescriptor[] = [];
    protected agentConfigured = false;
    protected defaultAgentId = '';
    protected readonly changeScheduler = new QaapChatViewStreamUpdateScheduler(
        () => this.onDidChangeEmitter.fire(),
        () => this.resolveChangeCoalesceDelayMs(),
        this.updateClocks,
    );

    protected readonly onDidChangeEmitter = new Emitter<void>();
    /** Fires whenever the set of active tasks changes (task created, completed, or cancelled). */
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected readonly onDidTaskOutputEmitter = new Emitter<MobileProjectTaskLogTail>();
    /** Fires when a task's live log tail changes (WS chunk or HTTP seed). */
    readonly onDidTaskOutput: Event<MobileProjectTaskLogTail> = this.onDidTaskOutputEmitter.event;

    getTransportState(): MobileProjectTaskTransportState {
        return this.transportState;
    }

    constructor(@unmanaged() protected readonly updateClocks: QaapChatViewStreamUpdateClocks = defaultQaapChatViewStreamUpdateClocks) { }

    /** Idempotent — safe to call from multiple consumers. The first call opens the WebSocket. */
    start(): void {
        if (this.started) {
            return;
        }
        this.started = true;
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.onVisibilityChange);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('pageshow', this.onPageShow);
        }
        this.openSocket();
    }

    getForCwd(cwd: string): MobileProjectActiveTaskInfo | undefined {
        return lookupByCwd(this.activeByCwd, cwd);
    }

    /** All tasks for a project cwd, running first then newest — excludes cancelled. */
    getTasksForCwd(cwd: string): MobileProjectTaskView[] {
        return lookupByCwd(this.tasksByCwd, cwd) ?? [];
    }

    /** All VPS background tasks across every project cwd. */
    getAllTasks(): MobileProjectTaskView[] {
        const merged: MobileProjectTaskView[] = [];
        for (const tasks of this.tasksByCwd.values()) {
            merged.push(...tasks);
        }
        return sortTasks(merged);
    }

    /** Sub-tasks spawned by a leader task via `qaap-task`. */
    getChildTasksForParent(parentId: string): MobileProjectTaskView[] {
        const merged: MobileProjectTaskView[] = [];
        for (const tasks of this.tasksByCwd.values()) {
            for (const task of tasks) {
                if (task.parentId === parentId) {
                    merged.push(task);
                }
            }
        }
        return sortTasks(merged);
    }

    /**
     * Match tasks when the panel only knows repo identity (GitHub card without a local URI yet).
     * Compares normalized cwd suffixes against repo name / owner/name.
     */
    findTasksForProject(project: { readonly name: string; readonly github?: { readonly owner: string; readonly name: string } }): MobileProjectTaskView[] {
        const merged: MobileProjectTaskView[] = [];
        for (const [cwd, tasks] of this.tasksByCwd) {
            if (cwdMatchesProject(cwd, project)) {
                merged.push(...tasks);
            }
        }
        return sortTasks(merged);
    }

    getAgents(): MobileProjectAgentDescriptor[] {
        return this.agents;
    }

    getDefaultAgent(): string {
        return this.defaultAgentId;
    }

    isAgentConfigured(): boolean {
        return this.agentConfigured;
    }

    /**
     * Optimistic local update used by the dashboard composer immediately after POST /tasks
     * succeeds. The WebSocket `created` event may arrive later; matching by task id keeps it idempotent.
     */
    recordTaskCreated(task: TaskEventPayload): void {
        this.applyEvent('created', task);
    }

    /** Optimistic local update after a user cancels a task from the dashboard. */
    recordTaskEnded(task: TaskEventPayload): void {
        this.applyEvent('cancelled', task);
    }

    /** Current live log tail for a task, if any chunks/seeds have been received. */
    getTaskLogTail(taskId: string): MobileProjectTaskLogTail | undefined {
        const id = taskId.trim();
        return id ? this.logByTaskId.get(id) : undefined;
    }

    /**
     * Seed / replace the live log from `GET /agent-tasks/:id` when DETAIL opens mid-run.
     * Keeps an already-longer live buffer when the WebSocket raced ahead of the HTTP fetch.
     */
    seedTaskLog(taskId: string, log: string): MobileProjectTaskLogTail {
        const id = taskId.trim();
        const seeded = seedWorkingDetailTaskLog(log, WORKING_DETAIL_TASK_LOG_MAX_BYTES);
        const existing = this.logByTaskId.get(id);
        if (existing && existing.text.length >= seeded.text.length) {
            // Live WS already has at least as much as the HTTP snapshot.
            return existing;
        }
        const next: MobileProjectTaskLogTail = {
            taskId: id,
            text: seeded.text,
            truncated: seeded.truncated || (existing?.truncated === true),
        };
        this.logByTaskId.set(id, next);
        this.onDidTaskOutputEmitter.fire(next);
        return next;
    }

    protected openSocket(): void {
        if (typeof WebSocket === 'undefined') {
            this.setTransportState('disconnected');
            return;
        }
        if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        this.setTransportState('reconnecting');
        try {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const socket = new WebSocket(`${proto}//${window.location.host}${WS_PATH}`);
            this.socket = socket;

            socket.addEventListener('open', () => {
                this.reconnectAttempt = 0;
                this.setTransportState('connected');
            });

            socket.addEventListener('message', ev => {
                try {
                    const msg = JSON.parse(String(ev.data)) as WsServerMessage;
                    if (msg.type === 'heartbeat') {
                        this.setTransportState('connected');
                    } else if (msg.type === 'snapshot') {
                        this.applySnapshot(msg);
                    } else if (msg.type === 'output') {
                        this.applyOutput(msg.task, msg.chunk);
                    } else {
                        this.applyEvent(msg.type, msg.task);
                    }
                } catch {
                    /* malformed payload — drop */
                }
            });

            socket.addEventListener('close', () => {
                if (this.socket !== socket) {
                    return;
                }
                this.socket = undefined;
                if (typeof document !== 'undefined' && document.hidden) {
                    this.setTransportState('disconnected');
                    return;
                }
                this.scheduleReconnect();
            });
            socket.addEventListener('error', () => socket.close());
        } catch {
            this.scheduleReconnect();
        }
    }

    /** @internal Exported path for tests — append a live `output` chunk. */
    applyOutput(task: TaskEventPayload, chunk: string): void {
        const taskId = task.id?.trim();
        if (!taskId || !chunk) {
            return;
        }
        const previous = this.logByTaskId.get(taskId)?.text ?? '';
        const nextState = appendWorkingDetailTaskLogChunk(
            previous,
            chunk,
            WORKING_DETAIL_TASK_LOG_MAX_BYTES,
        );
        const next: MobileProjectTaskLogTail = {
            taskId,
            text: nextState.text,
            truncated: nextState.truncated || (this.logByTaskId.get(taskId)?.truncated === true),
        };
        this.logByTaskId.set(taskId, next);
        this.onDidTaskOutputEmitter.fire(next);
    }

    protected scheduleReconnect(): void {
        if (!this.started) {
            return;
        }
        if (this.reconnectHandle !== undefined) {
            return;
        }
        this.socket = undefined;
        this.setTransportState('reconnecting');
        const delay = Math.min(RECONNECT_MAX_MS, 1_000 * (2 ** this.reconnectAttempt));
        this.reconnectAttempt++;
        this.reconnectHandle = window.setTimeout(() => {
            this.reconnectHandle = undefined;
            this.openSocket();
        }, delay);
    }

    protected readonly onVisibilityChange = (): void => {
        if (typeof document === 'undefined' || document.hidden) {
            return;
        }
        this.reconnectIfNeeded();
    };

    protected readonly onPageShow = (): void => {
        this.reconnectIfNeeded();
    };

    protected reconnectIfNeeded(): void {
        if (!this.started || (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING))) {
            return;
        }
        if (this.reconnectHandle !== undefined && typeof window !== 'undefined') {
            window.clearTimeout(this.reconnectHandle);
            this.reconnectHandle = undefined;
        }
        this.reconnectAttempt = 0;
        this.openSocket();
    }

    protected setTransportState(state: MobileProjectTaskTransportState): void {
        if (this.transportState === state) {
            return;
        }
        this.transportState = state;
        this.scheduleDidChange();
    }

    /** Apply a full snapshot sent by the server on WebSocket connect. */
    protected applySnapshot(payload: SnapshotPayload): void {
        this.agents = [...(payload.agents ?? [])];
        this.agentConfigured = payload.agentConfigured === true;
        this.defaultAgentId = payload.defaultAgent && payload.defaultAgent !== 'shell'
            ? payload.defaultAgent
            : this.agents.find(agent => agent.id !== 'shell')?.id ?? '';
        const nextActive = new Map<string, MobileProjectActiveTaskInfo>();
        const nextTasks = new Map<string, MobileProjectTaskView[]>();
        for (const group of payload.groups ?? []) {
            const cwd = normalizeCwd(group.cwd);
            const tasks = sortTasks(
                group.tasks
                    .map(task => toTaskView(task))
                    .filter(task => task.state !== 'cancelled')
            );
            if (tasks.length > 0) {
                nextTasks.set(cwd, tasks);
            }
            if (group.activeCount > 0) {
                const running = tasks.find(task => task.state === 'running');
                nextActive.set(cwd, {
                    activeCount: group.activeCount,
                    taskId: running?.id,
                    title: running?.title,
                });
            }
        }
        this.replaceTasks(nextTasks);
        this.replaceActive(nextActive);
    }

    protected applyEvent(type: 'created' | 'completed' | 'cancelled' | 'deleted' | 'reordered', task: TaskEventPayload): void {
        const cwd = normalizeCwd(task.cwd);
        if (type === 'deleted') {
            const list = [...(lookupByCwd(this.tasksByCwd, cwd) ?? [])].filter(entry => entry.id !== task.id);
            if (list.length > 0) {
                this.tasksByCwd.set(cwd, list);
            } else {
                this.tasksByCwd.delete(cwd);
            }
            this.logByTaskId.delete(task.id);
            this.refreshActiveForCwd(cwd);
            this.scheduleDidChange();
            return;
        }
        this.upsertTaskList({ ...task, cwd });
        this.refreshActiveForCwd(cwd);
        // Drop cancelled buffers; keep completed tails so DETAIL can still show the final log.
        if (type === 'cancelled' && task.id) {
            this.logByTaskId.delete(task.id);
        }
        this.scheduleDidChange();
    }

    /** Rebuild the running summary from the task list so queued events never consume an active slot. */
    protected refreshActiveForCwd(cwd: string): void {
        const tasks = this.getTasksForCwd(cwd);
        const running = tasks.filter(task => task.state === 'running');
        if (running.length === 0) {
            this.activeByCwd.delete(cwd);
            return;
        }
        this.activeByCwd.set(cwd, {
            activeCount: running.length,
            taskId: running[0]?.id,
            title: running[0]?.title,
        });
    }

    protected upsertTaskList(task: TaskEventPayload): void {
        const cwd = normalizeCwd(task.cwd);
        const view = toTaskView({ ...task, cwd });
        const list = [...(lookupByCwd(this.tasksByCwd, cwd) ?? [])];
        const index = list.findIndex(entry => entry.id === view.id);
        if (view.state === 'cancelled') {
            if (index >= 0) {
                list.splice(index, 1);
            }
        } else if (index >= 0) {
            list[index] = { ...list[index], ...view };
        } else {
            list.unshift(view);
        }
        if (list.length === 0) {
            this.tasksByCwd.delete(cwd);
        } else {
            this.tasksByCwd.set(cwd, sortTasks(list));
        }
    }

    protected replaceActive(next: Map<string, MobileProjectActiveTaskInfo>): void {
        if (sameActive(this.activeByCwd, next)) {
            return;
        }
        this.activeByCwd.clear();
        for (const [cwd, info] of next) {
            this.activeByCwd.set(cwd, info);
        }
        this.scheduleDidChange();
    }

    protected replaceTasks(next: Map<string, MobileProjectTaskView[]>): void {
        if (sameTasks(this.tasksByCwd, next)) {
            return;
        }
        this.tasksByCwd.clear();
        for (const [cwd, tasks] of next) {
            this.tasksByCwd.set(cwd, tasks);
        }
        this.scheduleDidChange();
    }

    protected scheduleDidChange(): void {
        this.changeScheduler.schedule();
    }

    protected resolveChangeCoalesceDelayMs(): number {
        if (typeof document !== 'undefined' && document.hidden) {
            return ACTIVE_TASKS_BACKGROUND_CHANGE_COALESCE_MS;
        }
        return 0;
    }
}

/** @internal Exported for testing. */
export function toTaskView(task: TaskEventPayload): MobileProjectTaskView {
    const command = task.command ?? task.title ?? '';
    return {
        id: task.id,
        agentId: task.agentId,
        title: task.title || command.slice(0, 80) || 'Background task',
        command,
        cwd: normalizeCwd(task.cwd),
        state: task.state,
        createdAt: task.createdAt ?? Date.now(),
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        queuePosition: task.queuePosition,
        parentId: task.parentId,
        verification: task.verification,
    };
}

/** @internal Exported for testing. */
export function normalizeCwd(cwd: string): string {
    let normalized = cwd.replace(/\\/g, '/');
    while (normalized.length > 1 && normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
    }
    return normalized;
}

/** @internal Exported to avoid duplication with mobile-projects-conversations. */
export function lookupByCwd<T>(map: Map<string, T>, cwd: string): T | undefined {
    const normalized = normalizeCwd(cwd);
    const direct = map.get(normalized);
    if (direct !== undefined) {
        return direct;
    }
    for (const [key, value] of map) {
        if (normalizeCwd(key) === normalized) {
            return value;
        }
    }
    return undefined;
}

/** @internal Exported for testing. */
export function cwdMatchesProject(
    cwd: string,
    project: { readonly name: string; readonly github?: { readonly owner: string; readonly name: string } },
): boolean {
    const normalized = normalizeCwd(cwd).toLowerCase();
    const base = normalized.split('/').pop() ?? '';
    if (base === project.name.toLowerCase()) {
        return true;
    }
    if (project.github) {
        const repoPath = `${project.github.owner}/${project.github.name}`.toLowerCase();
        if (normalized.endsWith(`/${repoPath}`) || normalized.endsWith(`/repos/${repoPath}`)) {
            return true;
        }
    }
    return false;
}

/** @internal Exported for testing. */
export function sortTasks(tasks: MobileProjectTaskView[]): MobileProjectTaskView[] {
    return [...tasks].sort((a, b) => {
        const aPriority = taskStatePriority(a.state);
        const bPriority = taskStatePriority(b.state);
        if (aPriority !== bPriority) {
            return aPriority - bPriority;
        }
        if (a.state === 'queued' && b.state === 'queued') {
            const aPosition = a.queuePosition ?? Number.POSITIVE_INFINITY;
            const bPosition = b.queuePosition ?? Number.POSITIVE_INFINITY;
            if (aPosition !== bPosition) {
                return aPosition - bPosition;
            }
        }
        return b.createdAt - a.createdAt;
    });
}

/** @internal Exported for the Tasks hub and unit tests. */
export function summarizeTaskStates(tasks: readonly Pick<MobileProjectTaskView, 'state'>[]): MobileProjectTaskStateCounts {
    const counts = {
        queued: 0,
        running: 0,
        blocked: 0,
        failed: 0,
        interrupted: 0,
        completed: 0,
        completedWithWarnings: 0,
    };
    for (const task of tasks) {
        switch (task.state) {
            case 'queued': counts.queued++; break;
            case 'running': counts.running++; break;
            case 'blocked': counts.blocked++; break;
            case 'failed': counts.failed++; break;
            case 'interrupted': counts.interrupted++; break;
            case 'completed': counts.completed++; break;
            case 'completed_with_warnings': counts.completedWithWarnings++; break;
            default: break;
        }
    }
    return counts;
}

function taskStatePriority(state: string): number {
    switch (state) {
        case 'running': return 0;
        case 'queued': return 1;
        case 'blocked': return 2;
        case 'failed':
        case 'interrupted': return 3;
        case 'completed_with_warnings': return 4;
        case 'completed': return 5;
        case 'cancelled': return 6;
        default: return 7;
    }
}

function sameActive(a: Map<string, MobileProjectActiveTaskInfo>, b: Map<string, MobileProjectActiveTaskInfo>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const [cwd, info] of a) {
        const other = b.get(cwd);
        if (!other || other.activeCount !== info.activeCount || other.taskId !== info.taskId || other.title !== info.title) {
            return false;
        }
    }
    return true;
}

function sameTasks(a: Map<string, MobileProjectTaskView[]>, b: Map<string, MobileProjectTaskView[]>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const [cwd, tasks] of a) {
        const other = b.get(cwd);
        if (!other || other.length !== tasks.length) {
            return false;
        }
        for (let i = 0; i < tasks.length; i++) {
            const left = tasks[i];
            const right = other[i];
            if (left.id !== right.id || left.state !== right.state || left.title !== right.title
                || left.queuePosition !== right.queuePosition) {
                return false;
            }
        }
    }
    return true;
}

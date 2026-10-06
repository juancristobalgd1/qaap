// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapCreateAgentTaskRequest } from '../common/qaap-agent-task';

/** In-process (never serialized) options for {@link QaapAgentTaskRunner.create}. */
export interface QaapAgentTaskCreateOptions {
    /**
     * Awaited right before the agent process spawns (after a queued task is promoted, too). Lets a
     * caller finish bounded preparation — e.g. a pre-turn worktree snapshot — before the agent can
     * write. Must settle on its own within a short budget; a rejection is ignored.
     */
    readonly spawnGate?: Promise<unknown>;
    /**
     * Internal only (never from a request body): id of the interrupted run this create continues
     * from a restart-continuation outbox effect. Honoured only while that effect is in flight.
     */
    readonly restartContinuationOf?: string;
}

/**
 * Spawn gates keyed by the create request object: the runner keeps that same object for queued
 * tasks (`queuedCreateRequests`), so the gate follows the task without touching the wire DTO.
 */
const spawnGates = new WeakMap<QaapCreateAgentTaskRequest, Promise<unknown>>();

export function registerQaapAgentTaskSpawnGate(request: QaapCreateAgentTaskRequest, options: QaapAgentTaskCreateOptions | undefined): void {
    if (options?.spawnGate) {
        spawnGates.set(request, options.spawnGate);
    }
}

/** Wait for (and forget) the gate registered for `request`; resolves immediately when none. */
export async function awaitQaapAgentTaskSpawnGate(request: QaapCreateAgentTaskRequest): Promise<void> {
    const gate = spawnGates.get(request);
    if (!gate) {
        return;
    }
    spawnGates.delete(request);
    try {
        await gate;
    } catch {
        // A failed preparation never blocks the turn.
    }
}

/** Default poll interval while waiting for a task's process to close. */
export const QAAP_AGENT_PROCESS_EXIT_POLL_MS = 100;

/**
 * Resolve `true` once no process is registered for any of `taskIds` (the runner deletes the entry
 * on the child's `close`), or `false` when `timeoutMs` elapses first.
 */
export function waitForQaapAgentTaskProcessesExit(
    hasProcess: (taskId: string) => boolean,
    taskIds: readonly string[],
    timeoutMs: number,
    pollMs: number = QAAP_AGENT_PROCESS_EXIT_POLL_MS,
): Promise<boolean> {
    const anyAlive = (): boolean => taskIds.some(taskId => hasProcess(taskId));
    if (!anyAlive()) {
        return Promise.resolve(true);
    }
    const deadline = Date.now() + Math.max(0, timeoutMs);
    return new Promise<boolean>(resolve => {
        const tick = (): void => {
            if (!anyAlive()) {
                resolve(true);
                return;
            }
            if (Date.now() >= deadline) {
                resolve(false);
                return;
            }
            setTimeout(tick, pollMs);
        };
        setTimeout(tick, pollMs);
    });
}

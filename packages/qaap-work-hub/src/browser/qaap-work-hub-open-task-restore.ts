// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

/**
 * Task open in the Work Hub, kept for F5 in the same tab only (sessionStorage, like the surface
 * preference in `qaap-mobile-work-surface-preference.ts`). A new tab starts on "Ready when you are".
 */
export const QAAP_WORK_HUB_OPEN_TASK_KEY = 'qaap.workHub.openTask';

/** How long a reload waits for the projects and task lists to load before giving up. */
export const QAAP_WORK_HUB_OPEN_TASK_RESTORE_TIMEOUT_MS = 15000;
const QAAP_WORK_HUB_OPEN_TASK_RESTORE_POLL_MS = 200;

export interface QaapWorkHubOpenTask {
    readonly projectId: string;
    readonly conversationId: string;
}

export function rememberWorkHubOpenTask(projectId: string, conversationId: string): void {
    try {
        sessionStorage.setItem(QAAP_WORK_HUB_OPEN_TASK_KEY, JSON.stringify({ projectId, conversationId }));
    } catch {
        // Storage unavailable: the reload simply lands on the empty composer.
    }
}

/** Forget the open task (closed, or replaced by the empty composer). */
export function forgetWorkHubOpenTask(): void {
    try {
        sessionStorage.removeItem(QAAP_WORK_HUB_OPEN_TASK_KEY);
    } catch {
        // ignore
    }
}

export function peekWorkHubOpenTask(): QaapWorkHubOpenTask | undefined {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(QAAP_WORK_HUB_OPEN_TASK_KEY) ?? 'null') as Partial<QaapWorkHubOpenTask> | null;
        return typeof parsed?.projectId === 'string' && typeof parsed.conversationId === 'string'
            ? { projectId: parsed.projectId, conversationId: parsed.conversationId }
            : undefined;
    } catch {
        return undefined;
    }
}

export interface QaapWorkHubOpenTaskRestoreTarget {
    projects(): readonly MobileProjectEntry[];
    findSummary(conversationId: string): QaapAgentConversationSummaryDTO | undefined;
    /** False once the user opened another task or left the Work Hub: never override their choice. */
    isStillWanted(): boolean;
    open(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
}

/**
 * Reopen the task that was open before a reload, once its project and summary have loaded.
 * A task that was deleted or archived meanwhile is forgotten and the hub stays on its empty state.
 */
export async function restoreWorkHubOpenTask(
    saved: QaapWorkHubOpenTask,
    target: QaapWorkHubOpenTaskRestoreTarget,
    timeoutMs: number = QAAP_WORK_HUB_OPEN_TASK_RESTORE_TIMEOUT_MS,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        if (!target.isStillWanted()) {
            return false;
        }
        const summary = target.findSummary(saved.conversationId);
        const project = target.projects().find(candidate => candidate.id === saved.projectId);
        if (summary?.archived) {
            forgetWorkHubOpenTask();
            return false;
        }
        if (summary && project) {
            await target.open(project, summary);
            return true;
        }
        if (Date.now() >= deadline) {
            forgetWorkHubOpenTask();
            return false;
        }
        await new Promise<void>(resolve => setTimeout(resolve, QAAP_WORK_HUB_OPEN_TASK_RESTORE_POLL_MS));
    }
}

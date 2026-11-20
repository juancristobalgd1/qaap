// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import {
    presentableAgentCliUpdateFailure,
    rememberAgentCliUpdateDismiss,
    requestAgentCliUpdate,
    type QaapAgentCliUpdateInfo,
    type QaapAgentCliUpdateResult,
} from '../common/qaap-agent-cli-update';

/** How long a successful update stays visible in the status chip before it removes itself. */
export const QAAP_AGENT_CLI_UPDATE_SUCCESS_VISIBLE_MS = 4000;

export type QaapAgentCliUpdateJobStatus = 'updating' | 'succeeded' | 'failed';

/** One harness update, from the click until the chip is dismissed. */
export interface QaapAgentCliUpdateJob {
    readonly info: QaapAgentCliUpdateInfo;
    readonly status: QaapAgentCliUpdateJobStatus;
    readonly startedAt: number;
    readonly finishedAt?: number;
    readonly installedVersion?: string;
    /** Presentable failure reason (failed jobs only); `undefined` shows the generic text. */
    readonly detail?: string;
}

/**
 * Client-side owner of harness updates started from the update notice or Settings → Harness.
 * The notice closes on click and the progress lives here, so the chip and the harness rows read
 * one state. Single-flight per harness: a second `start` for a running harness returns the same run.
 * The backend exposes no progress stream, so the job only knows "running" and the final result.
 */
@injectable()
export class QaapAgentCliUpdateTracker {

    protected readonly jobs = new Map<string, QaapAgentCliUpdateJob>();
    protected readonly runs = new Map<string, Promise<QaapAgentCliUpdateJob>>();
    protected readonly successTimers = new Map<string, ReturnType<typeof setTimeout>>();
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    /** Jobs in start order (oldest first). */
    getJobs(): readonly QaapAgentCliUpdateJob[] {
        return [...this.jobs.values()];
    }

    getJob(agentId: string): QaapAgentCliUpdateJob | undefined {
        return this.jobs.get(agentId);
    }

    isUpdating(agentId: string): boolean {
        return this.jobs.get(agentId)?.status === 'updating';
    }

    /** Start (or join the running) update for `info`. Resolves with the job's final state. */
    start(info: QaapAgentCliUpdateInfo): Promise<QaapAgentCliUpdateJob> {
        const running = this.runs.get(info.id);
        if (running) {
            return running;
        }
        this.clearSuccessTimer(info.id);
        const startedAt = Date.now();
        this.jobs.set(info.id, { info, status: 'updating', startedAt });
        this.fireChange();
        const run = this.requestUpdate(info.id)
            .catch((error: unknown): QaapAgentCliUpdateResult => ({
                ok: false,
                id: info.id,
                message: error instanceof Error ? error.message : String(error),
            }))
            .then(result => this.finish(info, startedAt, result))
            .finally(() => {
                this.runs.delete(info.id);
            });
        this.runs.set(info.id, run);
        return run;
    }

    /** Remove a finished job from the chip (a running job cannot be dismissed). */
    dismiss(agentId: string): void {
        if (this.isUpdating(agentId)) {
            return;
        }
        this.clearSuccessTimer(agentId);
        if (this.jobs.delete(agentId)) {
            this.fireChange();
        }
    }

    dispose(): void {
        for (const timer of this.successTimers.values()) {
            clearTimeout(timer);
        }
        this.successTimers.clear();
        this.onDidChangeEmitter.dispose();
    }

    /** Overridable transport so specs can drive outcomes without the backend. */
    protected requestUpdate(agentId: string): Promise<QaapAgentCliUpdateResult> {
        return requestAgentCliUpdate(agentId);
    }

    protected finish(
        info: QaapAgentCliUpdateInfo,
        startedAt: number,
        result: QaapAgentCliUpdateResult,
    ): QaapAgentCliUpdateJob {
        const finishedAt = Date.now();
        if (result.ok) {
            rememberAgentCliUpdateDismiss(info.id, info.latestVersion);
            const job: QaapAgentCliUpdateJob = {
                info,
                status: 'succeeded',
                startedAt,
                finishedAt,
                installedVersion: result.installedVersion ?? info.latestVersion,
            };
            this.jobs.set(info.id, job);
            this.successTimers.set(info.id, setTimeout(() => {
                this.successTimers.delete(info.id);
                this.dismiss(info.id);
            }, QAAP_AGENT_CLI_UPDATE_SUCCESS_VISIBLE_MS));
            this.fireChange();
            return job;
        }
        const job: QaapAgentCliUpdateJob = {
            info,
            status: 'failed',
            startedAt,
            finishedAt,
            detail: presentableAgentCliUpdateFailure(result.message),
        };
        this.jobs.set(info.id, job);
        this.fireChange();
        return job;
    }

    protected clearSuccessTimer(agentId: string): void {
        const timer = this.successTimers.get(agentId);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.successTimers.delete(agentId);
        }
    }

    protected fireChange(): void {
        this.onDidChangeEmitter.fire(undefined);
    }
}

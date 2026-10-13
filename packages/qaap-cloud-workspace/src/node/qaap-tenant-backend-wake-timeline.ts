// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Phases of one tenant backend wake, in the order `createOrValidateTenantBackend` runs them:
 * - `prepare`: Docker client, tenant networks and host directories;
 * - `container`: inspect plus start (stopped) or create+start (missing) of the backend container;
 * - `relay`: the per-tenant ingress relay that publishes the backend on the control-plane host;
 * - `ready`: polling `/qaap/api/health` until the tenant Theia backend answers.
 */
export type QaapTenantBackendWakePhase = 'prepare' | 'container' | 'relay' | 'ready';

/**
 * What the wake had to do with the backend container: it was already `running` (e.g. after a
 * control-plane restart), a stopped one was `started`, a missing one was `created`, or a stale one
 * kept serving because agent turns were running (`deferred`).
 */
export type QaapTenantBackendWakeAction = 'running' | 'started' | 'created' | 'deferred';

export interface QaapTenantBackendWakeSample {
    readonly at: string;
    readonly totalMs: number;
    readonly ok: boolean;
    readonly action?: QaapTenantBackendWakeAction;
    readonly phases: Readonly<Partial<Record<QaapTenantBackendWakePhase, number>>>;
}

/** Collects per-phase durations of one tenant backend ensure (see `QaapDockerOrchestrator`). */
export class QaapTenantBackendWakeTimeline {

    protected last: number;
    protected readonly phases: Partial<Record<QaapTenantBackendWakePhase, number>> = {};
    action: QaapTenantBackendWakeAction | undefined;

    constructor(protected readonly now: () => number = Date.now) {
        this.last = now();
    }

    /** Records the time elapsed since the previous mark (or the start) as `phase`. */
    mark(phase: QaapTenantBackendWakePhase): void {
        const current = this.now();
        this.phases[phase] = (this.phases[phase] ?? 0) + Math.max(0, current - this.last);
        this.last = current;
    }

    sample(totalMs: number, ok: boolean): QaapTenantBackendWakeSample {
        return {
            at: new Date(this.now()).toISOString(),
            totalMs: Math.max(0, Math.round(totalMs)),
            ok,
            ...(this.action ? { action: this.action } : {}),
            phases: { ...this.phases },
        };
    }
}

export namespace QaapTenantBackendWakeTimeline {
    const PHASE_ORDER: readonly QaapTenantBackendWakePhase[] = ['prepare', 'container', 'relay', 'ready'];

    /** One compact, grep-friendly log line: `[qaap-tenant] backend wake alice 5210ms action=started prepare=40ms ...`. */
    export function formatLogLine(tenantLogin: string, sample: QaapTenantBackendWakeSample, error?: unknown): string {
        const parts = [`[qaap-tenant] backend wake${sample.ok ? '' : ' failed'} ${tenantLogin} ${sample.totalMs}ms`];
        if (sample.action) {
            parts.push(`action=${sample.action}`);
        }
        for (const phase of PHASE_ORDER) {
            const duration = sample.phases[phase];
            if (duration !== undefined) {
                parts.push(`${phase}=${Math.round(duration)}ms`);
            }
        }
        if (!sample.ok && error !== undefined) {
            const message = error instanceof Error ? error.message : String(error);
            parts.push(`error=${JSON.stringify(message.slice(0, 200))}`);
        }
        return parts.join(' ');
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';

/**
 * How long a backend whose CLI hard-failed stays out of routing. A CLI that exits non-zero is
 * almost always infrastructure (quota exhausted, auth expired, broken install), not "the task was
 * hard" — agent CLIs report hard tasks in-band with exit 0. Long enough to stop every subsequent
 * run from failing the same way; short enough that a transient blip self-heals.
 */
export const QAAP_AGENT_FAILURE_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Shared in-memory health record for agent CLIs (ADR-001).
 *
 * One tracker serves both consumers of judge routing — workflow runs and the runner's inline
 * adversarial review — so a backend that just burned a workflow judge is not retried seconds
 * later by a composer task's review, and vice versa.
 */
@injectable()
export class QaapAgentHealthTracker {

    protected readonly cooldownUntil = new Map<string, number>();

    /** The CLI itself hard-failed (non-zero exit, no output contract met). */
    noteFailure(agentRef: string): void {
        this.cooldownUntil.set(agentRef, Date.now() + QAAP_AGENT_FAILURE_COOLDOWN_MS);
        console.warn(`[qaap-agent-health] "${agentRef}" CLI failed; routing around it for ${QAAP_AGENT_FAILURE_COOLDOWN_MS / 60000} min.`);
    }

    /** Any completed turn (even one reporting a task-level failure in-band) proves the CLI works. */
    noteSuccess(agentRef: string): void {
        this.cooldownUntil.delete(agentRef);
    }

    isCoolingDown(agentRef: string): boolean {
        const until = this.cooldownUntil.get(agentRef);
        return until !== undefined && Date.now() < until;
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { warmAgentRunner } from './qaap-agent-task-client';

/** A warm-up per cwd is enough for minutes: the runner caches project info between turns. */
export const AGENT_TURN_WARM_MIN_INTERVAL_MS = 5 * 60_000;

const lastWarmAtByCwd = new Map<string, number>();

/**
 * True when the runner for `cwd` should be warmed now, at most once per
 * {@link AGENT_TURN_WARM_MIN_INTERVAL_MS}. Records the attempt when it returns true.
 */
export function shouldWarmAgentTurn(cwd: string, now: number, lastWarmAt: Map<string, number> = lastWarmAtByCwd): boolean {
    const previous = lastWarmAt.get(cwd);
    if (previous !== undefined && now - previous < AGENT_TURN_WARM_MIN_INTERVAL_MS) {
        return false;
    }
    lastWarmAt.set(cwd, now);
    return true;
}

export interface QaapAgentTurnWarmHooks {
    warmLiveTransport?(): void;
}

/** Pre-connect live transport and warm the VPS agent runner before the user sends. */
export function warmAgentTurnPath(cwd: string | undefined, hooks: QaapAgentTurnWarmHooks): void {
    hooks.warmLiveTransport?.();
    const trimmed = cwd?.trim();
    if (!trimmed) {
        return;
    }
    // Called on every transcript render: only the first call per cwd in the window hits the backend.
    if (!shouldWarmAgentTurn(trimmed, Date.now())) {
        return;
    }
    void warmAgentRunner(trimmed);
}

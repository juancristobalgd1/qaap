// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

/**
 * How launchable an agent is for a "Run variants" fan-out, derived from the same backend catalog
 * fields the composer agent picker uses (`available` + `connectionState`):
 * - `ready`: the backend confirmed the harness is connected (or needs no login).
 * - `unverified`: installed, but the backend cannot confirm its login; it must be connected first.
 * - `not-connected`: unavailable or explicitly disconnected on this workspace.
 */
export type QaapParallelAgentAvailability = 'ready' | 'unverified' | 'not-connected';

export namespace QaapParallelAgentDefaults {

    export function availability(agent: Pick<QaapAgentTaskAgentOption, 'available' | 'connectionState'>): QaapParallelAgentAvailability {
        if (agent.available === false || agent.connectionState === 'disconnected') {
            return 'not-connected';
        }
        if (agent.connectionState === 'connected' || agent.connectionState === 'not-required') {
            return 'ready';
        }
        return 'unverified';
    }

    export function isLaunchable(agent: Pick<QaapAgentTaskAgentOption, 'available' | 'connectionState'>): boolean {
        return availability(agent) === 'ready';
    }

    /**
     * Default agent selection for the parallel-runs sheet: only backend-confirmed connections,
     * with the currently selected agent(s) first.
     */
    export function pickDefaultAgentIds(
        agents: readonly QaapAgentTaskAgentOption[],
        preferredAgentIds: readonly (string | undefined)[],
        max = 2,
    ): string[] {
        const launchable = agents.filter(agent => isLaunchable(agent));
        const picked: string[] = [];
        const pickedKeys = new Set<string>();
        const add = (agent: QaapAgentTaskAgentOption): void => {
            const key = agent.id.trim().toLowerCase();
            if (picked.length >= max || pickedKeys.has(key)) {
                return;
            }
            pickedKeys.add(key);
            picked.push(agent.id);
        };
        for (const preferred of preferredAgentIds) {
            const key = preferred?.trim().toLowerCase();
            if (!key) {
                continue;
            }
            const match = launchable.find(agent => agent.id.trim().toLowerCase() === key);
            if (match) {
                add(match);
            }
        }
        for (const agent of launchable) {
            if (availability(agent) === 'ready') {
                add(agent);
            }
        }
        for (const agent of launchable) {
            add(agent);
        }
        return picked;
    }

    /** Selected agent ids that may actually be launched (drops disconnected / unknown ids). */
    export function launchableSelection(
        agents: readonly QaapAgentTaskAgentOption[],
        selectedAgentIds: Iterable<string>,
    ): string[] {
        const byKey = new Map(agents.map(agent => [agent.id.trim().toLowerCase(), agent] as const));
        const result: string[] = [];
        for (const id of selectedAgentIds) {
            const agent = byKey.get(id.trim().toLowerCase());
            if (agent && isLaunchable(agent)) {
                result.push(id);
            }
        }
        return result;
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { QaapAgentConnectionState, QaapAgentTaskAgentOption } from '@theia/qaap-shared-core/lib/common/qaap-agent-task-client';

const PERSISTED_AGENT_CATALOG_STORAGE_KEY = 'qaap.composer.agentCatalog.v1';
const CONNECTION_STATES: ReadonlySet<string> = new Set<QaapAgentConnectionState>(['connected', 'disconnected', 'unknown', 'not-required']);
const MAX_PERSISTED_AGENTS = 64;

/**
 * Agent picker catalog from the last successful backend load in this browser. A fresh page paints
 * the picker from it instead of waiting seconds for backend status probes; the background refresh
 * then replaces it. Malformed or foreign entries are dropped, so a stale value only costs one repaint.
 */
export function readPersistedAgentCatalog(): QaapAgentTaskAgentOption[] {
    try {
        const raw = window.localStorage.getItem(PERSISTED_AGENT_CATALOG_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : undefined;
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.slice(0, MAX_PERSISTED_AGENTS).filter(isPersistedAgentOption).map(agent => ({
            id: agent.id,
            label: agent.label,
            available: agent.available,
            ...(agent.connectionState ? { connectionState: agent.connectionState } : {}),
        }));
    } catch {
        return [];
    }
}

export function writePersistedAgentCatalog(agents: readonly QaapAgentTaskAgentOption[]): void {
    try {
        const entries = agents.slice(0, MAX_PERSISTED_AGENTS).map(agent => ({
            id: agent.id,
            label: agent.label,
            available: agent.available,
            ...(agent.connectionState ? { connectionState: agent.connectionState } : {}),
        }));
        window.localStorage.setItem(PERSISTED_AGENT_CATALOG_STORAGE_KEY, JSON.stringify(entries));
    } catch {
        /* localStorage unavailable — the picker waits for the backend as before */
    }
}

function isPersistedAgentOption(value: unknown): value is QaapAgentTaskAgentOption {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value as Record<string, unknown>;
    return typeof candidate.id === 'string' && candidate.id.length > 0
        && typeof candidate.label === 'string'
        && typeof candidate.available === 'boolean'
        && (candidate.connectionState === undefined
            || (typeof candidate.connectionState === 'string' && CONNECTION_STATES.has(candidate.connectionState)));
}

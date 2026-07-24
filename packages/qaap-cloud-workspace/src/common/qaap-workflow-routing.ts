// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Resolves an agent-turn's capability + cost tier into a concrete backend (ADR-001).
 *
 * The IR never names a vendor: a turn declares what it needs (`capability`, `costTier`) and this
 * policy maps that onto whichever agent is actually installed, in a configurable preference order.
 * A turn may still pin `agentRef` to force a backend; the policy only fills the gap when it does
 * not, so adding Pi/Hermes/etc. is a routing-table edit, never an IR change.
 */

import { QaapWorkflowCapability, QaapWorkflowCostTier } from './qaap-workflow-ir';

/** Ordered agent ids to try for one capability, cheapest-acceptable first per tier. */
export interface QaapWorkflowRoute {
    readonly cheap?: readonly string[];
    readonly standard?: readonly string[];
    readonly premium?: readonly string[];
    /** Tried when no tier-specific list yields an available agent. */
    readonly any?: readonly string[];
}

export type QaapWorkflowRoutingTable = Partial<Record<QaapWorkflowCapability, QaapWorkflowRoute>>;

export interface QaapWorkflowRoutingResult {
    readonly agentRef: string | undefined;
    /** Why this backend was chosen, for the run transcript. */
    readonly reason: 'pinned' | 'routed' | 'fallback';
}

/**
 * Default table. Only agent ids; whether one exists is decided at resolve time against the live
 * catalog, so an entry for an uninstalled agent is simply skipped. Deliberately conservative:
 * judges and exploration prefer a strong reasoner, mechanical work prefers a cheap one.
 */
export const DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE: QaapWorkflowRoutingTable = {
    explore: { any: ['qaiq', 'codex', 'claude'] },
    implement: { cheap: ['qaiq'], standard: ['qaiq', 'codex'], premium: ['codex', 'claude'], any: ['qaiq'] },
    judge: { any: ['codex', 'claude', 'qaiq'] },
    synthesize: { any: ['codex', 'qaiq'] },
    measure: { any: ['qaiq'] },
    creative: { any: ['claude', 'qaiq'] },
    general: { any: ['qaiq'] },
};

export class QaapWorkflowRoutingPolicy {

    constructor(protected readonly table: QaapWorkflowRoutingTable = DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE) { }

    /**
     * @param isAvailable predicate over the live agent catalog.
     * @param pinnedAgentRef an explicit backend from the node, if any.
     */
    resolve(
        capability: QaapWorkflowCapability,
        costTier: QaapWorkflowCostTier | undefined,
        isAvailable: (agentRef: string) => boolean,
        pinnedAgentRef?: string,
    ): QaapWorkflowRoutingResult {
        if (pinnedAgentRef) {
            return { agentRef: pinnedAgentRef, reason: 'pinned' };
        }
        const route = this.table[capability];
        for (const candidate of this.candidateOrder(route, costTier)) {
            if (isAvailable(candidate)) {
                return { agentRef: candidate, reason: 'routed' };
            }
        }
        // No known backend matched: leave the ref undefined so the runner applies its own default
        // rather than pinning a possibly-absent agent.
        return { agentRef: undefined, reason: 'fallback' };
    }

    protected candidateOrder(
        route: QaapWorkflowRoute | undefined,
        costTier: QaapWorkflowCostTier | undefined,
    ): readonly string[] {
        if (!route) {
            return [];
        }
        const tiered = costTier ? route[costTier] ?? [] : [];
        // De-duplicate while preserving order: tier-specific first, then the capability's `any`.
        return [...new Set([...tiered, ...(route.any ?? [])])];
    }
}

/**
 * Parse `QAAP_WORKFLOW_AGENT_ROUTES` (JSON) into a routing table, falling back to the default on
 * any problem. Shape: `{ "<capability>": { "cheap"|"standard"|"premium"|"any": ["agentId", …] } }`.
 */
export function parseQaapWorkflowRoutingTable(raw: string | undefined): QaapWorkflowRoutingTable {
    if (!raw?.trim()) {
        return DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE;
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE;
        }
        const table: QaapWorkflowRoutingTable = {};
        for (const [capability, value] of Object.entries(parsed as Record<string, unknown>)) {
            const route = sanitizeRoute(value);
            if (route) {
                table[capability as QaapWorkflowCapability] = route;
            }
        }
        return Object.keys(table).length > 0 ? table : DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE;
    } catch {
        return DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE;
    }
}

function sanitizeRoute(value: unknown): QaapWorkflowRoute | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const source = value as Record<string, unknown>;
    const route: { -readonly [K in keyof QaapWorkflowRoute]: string[] } = {};
    for (const key of ['cheap', 'standard', 'premium', 'any'] as const) {
        const ids = source[key];
        if (Array.isArray(ids)) {
            const clean = ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
            if (clean.length > 0) {
                route[key] = clean;
            }
        }
    }
    return Object.keys(route).length > 0 ? route : undefined;
}

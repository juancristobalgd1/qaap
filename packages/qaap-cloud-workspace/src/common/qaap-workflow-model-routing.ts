// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Bridges the workflow orchestrator's per-node evaluation (`capability` + `costTier` on
 * {@link QaapWorkflowAgentTurnNode}) to the agent-task model-routing classification
 * ({@link QaapAgentTaskKind}). Without this, a dispatched turn's cost/capability judgment never
 * reaches model selection, and the runner falls back to guessing the task kind from prompt text —
 * meaning a cheap `explore` node and a `premium` `implement` node could both land on the same
 * model. This is a pure function so it can be unit tested without spinning up the dispatcher.
 */

import type { QaapAgentTaskKind } from './qaap-agent-task';
import { QaapWorkflowAgentTurnNode, QaapWorkflowCapability, QaapWorkflowCostTier } from './qaap-workflow-ir';

/**
 * Translate a node's capability + cost tier into a model-routing task kind.
 *
 * Precedence: an explicit `costTier` outranks `capability` — `'cheap'` always routes to
 * `'exploration'` and `'premium'` always routes to `'implementation'`, regardless of what the
 * capability is (e.g. a `'cheap'` `judge` still gets the exploration/cheap alias). Only when
 * `costTier` is `'standard'` or omitted does the mapping fall back to `capability`.
 *
 * The capability fallback deliberately mirrors {@link DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE}, which
 * orders backends for getting it right the first time rather than for unit cost: only a caller
 * asking for `'cheap'` gets the cheap answer. So `explore` does NOT downgrade itself here — its
 * findings are what the implement turn builds on, and a wrong map costs far more than the turn
 * saved. Keeping the two axes (which backend, which model) on the same principle is the point:
 * - `measure` — mechanical metric gathering, cheap by nature → `'exploration'`.
 * - `implement` — writes changes to the workspace → `'implementation'` (the `code` alias).
 * - `judge` — deliberately NOT `'implementation'`, even though a review needs real reasoning.
 *   Pinning it to the same `code` alias as the writer guarantees the reviewer is the same model
 *   that wrote the change whenever both turns land on the same backend — which is exactly what the
 *   judge-independence routing exists to prevent, and it is a regression against the prompt-text
 *   heuristic this hint replaced (that one already sent a judge prompt to `'general'` and an
 *   implement prompt to `'implementation'`). Independence is enforced on the backend axis; the
 *   model axis must at least not undo it. Note the limitation: `'general'` only means "not pinned
 *   to the writer's alias" — real model independence would need a dedicated reviewer alias, and
 *   the alias set has none today.
 * - `explore` / `synthesize` / `creative` / `general` — no signal that justifies either specialized
 *   alias, so they route to `'general'`: the operator's configured default model, i.e. exactly what
 *   would run with no routing at all. `explore` reaches the cheaper alias only via `costTier: 'cheap'`.
 */
export function resolveQaapWorkflowTaskKind(
    capability: QaapWorkflowCapability,
    costTier?: QaapWorkflowCostTier,
): QaapAgentTaskKind {
    if (costTier === 'cheap') {
        return 'exploration';
    }
    if (costTier === 'premium') {
        return 'implementation';
    }
    switch (capability) {
        case 'measure':
            return 'exploration';
        case 'implement':
            return 'implementation';
        case 'judge':
        case 'explore':
        case 'synthesize':
        case 'creative':
        case 'general':
        default:
            return 'general';
    }
}

/** Human-readable summary of a node's routing assignment, for run-transcript logging. */
export function describeQaapWorkflowAssignment(node: QaapWorkflowAgentTurnNode): string {
    const kind = resolveQaapWorkflowTaskKind(node.capability, node.costTier);
    return `${node.capability}/${node.costTier ?? 'standard'} -> taskKind:${kind}`;
}

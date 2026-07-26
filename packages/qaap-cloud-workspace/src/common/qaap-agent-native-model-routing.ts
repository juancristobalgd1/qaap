// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Capability-driven model routing for agents that run a NATIVE CLI catalog (claude, codex,
 * copilot, …) rather than the Settings alias catalog (QAIQ).
 *
 * Why this exists: the workflow orchestrator already evaluates every node (`capability` +
 * `costTier`) and hands the verdict down as a {@link QaapAgentTaskKind}, but that verdict only ever
 * reached QAIQ's Settings aliases. On a normal install — claude and/or codex present — the routing
 * table sends `explore`/`implement`/`judge` to a native CLI, so the node's evaluation was discarded
 * and a trivial `measure` turn ran on the same expensive default model as an `implement` turn.
 *
 * SAFETY CONTRACT — read before adding an entry. An unknown `--model` does not degrade, it kills the
 * turn ("There's an issue with the selected model (…). It may not exist or you may not have access
 * to it."). So this module NEVER emits a model id it cannot verify:
 *  1. the id must appear in the table below (or the operator override) for that exact agent, and
 *  2. it must be present in the agent's live catalog at resolve time
 *     ({@link listNativeAgentModels}: CLI discovery first, curated static list as fallback), and
 *  3. the emitted provider/vendor are taken FROM the catalog entry, never from the table.
 * If any of those fails we return `undefined`, no flag is emitted and the CLI runs its own default
 * model — i.e. exactly the behaviour before this module existed. Silent degradation to today is
 * correct; guessing an id is not.
 *
 * WHY THE DEFAULT TABLE ONLY COVERS `claude`. Two things must be verifiable to route a capability:
 * that the id exists, and that the model sits where we think it does in the ladder. For Anthropic
 * both hold (haiku < sonnet < opus/fable is public, documented tiering, and each id below was
 * checked against the installed CLI). For Codex's `gpt-5.6-{sol,terra,luna}` the ids exist but
 * nothing verifies their relative cost/latency, so routing them would be a guess about *which* is
 * cheap — the second half of the safety contract. Codex therefore keeps its default model until an
 * operator states an ordering via {@link QAAP_AGENT_TASK_MODELS_ENV}.
 */

import type { QaapQaiqModelOption } from '@theia/qaap-mobile-shell/lib/common/qaap-agent-task-client';
import { QaapAgentTaskKind, type QaapCreateAgentTaskQaiqModel } from './qaap-agent-task';
import { agentUsesNativeModelCatalog } from './qaap-agent-native-model-catalog';

/** Model id to use per task kind for one agent. A missing kind means "no flag, CLI default". */
export type QaapNativeModelRoutingEntry = Readonly<Partial<Record<QaapAgentTaskKind, string>>>;

/** Agent id (lower-case) → its per-task-kind model pins. */
export type QaapNativeModelRoutingTable = Readonly<Record<string, QaapNativeModelRoutingEntry>>;

/** Operator override, JSON. Same spirit as `QAAP_WORKFLOW_AGENT_ROUTES` for the backend axis. */
export const QAAP_AGENT_TASK_MODELS_ENV = 'QAAP_AGENT_TASK_MODELS';

/**
 * Default pins. Ordered by the same principle as {@link DEFAULT_QAAP_WORKFLOW_ROUTING_TABLE}:
 * getting it right the first time beats saving on the turn, because a turn that has to be re-run
 * costs a whole extra cycle of wall-clock time.
 *
 * - `exploration` — reached by `capability: 'measure'` (mechanical metric gathering) or by an
 *   explicit `costTier: 'cheap'`, i.e. a caller stating this node is worth less than a good answer.
 *   This is the ONLY downgrade, and it is where the latency win comes from: these nodes are the
 *   ones a graph emits in bulk.
 * - `implementation` — the writer turn. Pinned to the flagship rather than left on the CLI default,
 *   because the default is whatever the operator last picked interactively and may well be a small
 *   model; an implement turn that silently changes nothing is the single most expensive failure
 *   mode this fork has recorded.
 * - `review` — a judge turn. Deliberately a DIFFERENT model from `implementation`: backend-level
 *   judge independence (`QaapWorkflowAgentTurnAdapter.resolveBackend`) collapses when only one
 *   strong CLI is installed, and then the reviewer would be the very model that wrote the change.
 *   Pinning both slots restores independence on the model axis too. Both are frontier models — the
 *   judge is not the place to save.
 */
export const DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE: QaapNativeModelRoutingTable = {
    claude: {
        exploration: 'claude-haiku-4-5',
        implementation: 'claude-fable-5',
        review: 'claude-opus-4-8',
    },
};

/**
 * Resolve the model a native-CLI agent should run for this task kind, or `undefined` to leave the
 * CLI on its own default. The returned model is always a catalog entry, never a table literal.
 *
 * @param catalog the agent's live model list (see {@link listNativeAgentModels}).
 */
export function resolveNativeAgentModelForTaskKind(
    agentId: string | undefined,
    kind: QaapAgentTaskKind,
    catalog: readonly QaapQaiqModelOption[],
    table: QaapNativeModelRoutingTable = DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE,
): QaapCreateAgentTaskQaiqModel | undefined {
    const normalized = agentId?.trim().toLowerCase();
    if (!normalized || !agentUsesNativeModelCatalog(normalized)) {
        return undefined;
    }
    const pinned = table[normalized]?.[kind]?.trim().toLowerCase();
    if (!pinned) {
        return undefined;
    }
    // The catalog is the only authority on what this CLI accepts: a pin the agent does not list is
    // treated as absent rather than passed through, so a stale table can never break a run.
    const option = catalog.find(candidate => candidate.modelId.trim().toLowerCase() === pinned);
    if (!option) {
        return undefined;
    }
    return {
        provider: option.provider,
        vendor: option.vendor,
        modelId: option.modelId,
    };
}

/**
 * Parse {@link QAAP_AGENT_TASK_MODELS_ENV} into a routing table, falling back to the defaults on any
 * problem. Shape: `{ "<agentId>": { "exploration"|"implementation"|"review"|"general": "<modelId>" } }`.
 *
 * Merge semantics mirror `parseQaapWorkflowRoutingTable`: an agent named in the override replaces
 * its OWN entry wholesale (so an operator can shrink it), agents left out keep their defaults. An
 * agent mapped to `{}` is therefore the documented off-switch for that agent — e.g.
 * `QAAP_AGENT_TASK_MODELS={"claude":{}}` restores pre-routing behaviour for claude alone.
 * Unknown task kinds and non-string / empty model ids are dropped, not guessed at.
 */
export function parseQaapNativeModelRoutingTable(raw: string | undefined): QaapNativeModelRoutingTable {
    if (!raw?.trim()) {
        return DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE;
    }
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE;
        }
        const overrides: Record<string, QaapNativeModelRoutingEntry> = {};
        for (const [agentId, value] of Object.entries(parsed as Record<string, unknown>)) {
            const key = agentId.trim().toLowerCase();
            const entry = sanitizeEntry(value);
            if (key && entry) {
                overrides[key] = entry;
            }
        }
        if (Object.keys(overrides).length === 0) {
            return DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE;
        }
        return { ...DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE, ...overrides };
    } catch {
        return DEFAULT_QAAP_NATIVE_MODEL_ROUTING_TABLE;
    }
}

function sanitizeEntry(value: unknown): QaapNativeModelRoutingEntry | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined;
    }
    const entry: Partial<Record<QaapAgentTaskKind, string>> = {};
    for (const [kind, modelId] of Object.entries(value as Record<string, unknown>)) {
        if (!QaapAgentTaskKind.is(kind)) {
            continue;
        }
        if (typeof modelId === 'string' && modelId.trim()) {
            entry[kind] = modelId.trim();
        }
    }
    return entry;
}

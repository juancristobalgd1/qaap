// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The canonical Work Hub chat-turn lifecycle as a workflow definition (ADR-002).
 *
 * One run corresponds to one human root turn; auto-continue, model fallback and restart-resume
 * are node re-visits inside that run, so the persisted `visits` / trace of the run IS the durable
 * ledger the imperative store keeps today in per-message counters and in-memory maps.
 *
 * This definition is deliberately NOT registered in {@code QaapWorkflowTemplateRegistry}: chat
 * turns are never started through the HTTP template API. Runs are created by the conversation
 * store (adoption after a restart, later pieces for fresh turns), and the template-workflow
 * dispatcher is told to ignore them (see the `governs` predicate in the backend module).
 */

import { QaapAgentTaskState } from './qaap-agent-task';
import {
    QaapWorkflowDef,
    QaapWorkflowEdge,
    QaapWorkflowNode,
    QaapWorkflowNodeOutcome,
} from './qaap-workflow-ir';
import { QaapWorkflowRunBudget } from './qaap-workflow-run';

export const QAAP_CHAT_TURN_WORKFLOW_ID = 'qaap.chat-turn';

/**
 * Run artifact holding the JSON array of model keys already tried by the fallback ladder. Durable
 * on purpose: the imperative tried-set lives in process memory and forgets every failed model on
 * a backend restart, so a bad model could be retried forever across OOM cycles.
 */
export const QAAP_CHAT_TURN_TRIED_MODELS_ARTIFACT = 'fallback.tried';

/** Node ids of the canonical chat-turn graph, shared by the store, specs and future pieces. */
export const QAAP_CHAT_TURN_NODE = 'turn';
export const QAAP_CHAT_TURN_FALLBACK_NODE = 'turn-fallback';
export const QAAP_CHAT_TURN_CONTINUE_NODE = 'turn-continue';

/**
 * The turn nodes an agent CLI actually runs. Every one of them settles through the same three
 * emits and can be resumed in place after a backend restart (the `resume:restart` self-loop).
 */
const TURN_NODES = [QAAP_CHAT_TURN_NODE, QAAP_CHAT_TURN_FALLBACK_NODE, QAAP_CHAT_TURN_CONTINUE_NODE] as const;

/**
 * Outcome of a finished chat-turn task, mirroring how the conversation store classifies
 * {@code applyTaskOutcome} today — NOT {@code resolveAgentTurnOutcome}, which maps
 * `completed_with_warnings` to `'fail'` for review templates. The chat treats a clean exit with a
 * red self-verification as a DELIVERED turn (warning trace, no auto-continue), so it gets its own
 * outcome and the definition routes it to the delivered settle.
 *
 * `retry:model`, `continue:auto` and `resume:restart` are never emitted here: fallback and
 * auto-continue stay imperative until their migration pieces, and a resume is decided by boot
 * reconciliation, not by a task terminal.
 */
export function resolveChatTurnOutcome(state: QaapAgentTaskState): QaapWorkflowNodeOutcome {
    switch (state) {
        case 'completed':
            return 'success';
        case 'completed_with_warnings':
            return 'success:warned';
        // The agent explicitly asked for the user; a user cancel is an equally deliberate stop.
        case 'blocked':
        case 'cancelled':
            return 'blocked';
        default:
            return 'fail';
    }
}

/**
 * Run budget for a chat-turn run. No wall clocks on purpose: until the watchdog consolidation
 * piece, {@code sweepZombieStreamingTurns} remains the one executioner of a stuck chat turn, and
 * a second clock on the run would race it. The visit ceiling is a BACKSTOP above the product
 * ceilings (resumes ≤ maxRestartResumes, continues < 2, shared spawns ≤ 4) — it must never bite
 * first, only bound a counter that went wrong.
 */
export function resolveChatTurnRunBudget(maxRestartResumes: number): QaapWorkflowRunBudget {
    const resumes = Number.isFinite(maxRestartResumes) && maxRestartResumes > 0 ? Math.floor(maxRestartResumes) : 1;
    return {
        // Worst legitimate case: initial turn + fallbacks/continues within the shared 4-spawn
        // ceiling + one resume per node visit, with slack so the backstop stays a backstop.
        maxNodeRuns: Math.max(12, (resumes + 2) * TURN_NODES.length),
        maxVisitsPerNode: Math.max(4, resumes + 2),
        maxNodeMs: undefined,
        maxRunMs: undefined,
    };
}

/** Prompt refs are resolved by the chat-turn port against the conversation, never by the template prompt registry. */
const TURN_PROMPT_REF: Readonly<Record<(typeof TURN_NODES)[number], string>> = {
    [QAAP_CHAT_TURN_NODE]: 'chat-turn',
    [QAAP_CHAT_TURN_FALLBACK_NODE]: 'chat-turn-fallback',
    [QAAP_CHAT_TURN_CONTINUE_NODE]: 'chat-turn-continue',
};

/**
 * The canonical chat-turn graph. The fallback and continue nodes are declared from v1 — the
 * definition travels embedded in every persisted run, so declaring the full shape now means runs
 * adopted today can route those edges the moment a later piece's resolver starts emitting
 * `retry:model` / `continue:auto`. Until then the edges are simply never taken.
 */
export function buildChatTurnWorkflow(): QaapWorkflowDef {
    const nodes: QaapWorkflowNode[] = [
        ...TURN_NODES.map((id): QaapWorkflowNode => ({
            kind: 'agent-turn',
            id,
            capability: 'general',
            isolation: 'cwd',
            promptRef: TURN_PROMPT_REF[id],
        })),
        { kind: 'emit', id: 'settle-delivered', bindingKey: 'turn.delivered' },
        { kind: 'emit', id: 'settle-failed', bindingKey: 'turn.failed' },
        { kind: 'emit', id: 'settle-blocked', bindingKey: 'turn.blocked' },
    ];
    const edges: QaapWorkflowEdge[] = [];
    for (const id of TURN_NODES) {
        edges.push(
            { from: id, to: 'settle-delivered', when: 'success' },
            // Delivered-with-warnings: the runner already spent its fix budget; the turn settles.
            { from: id, to: 'settle-delivered', when: 'success:warned' },
            { from: id, to: 'settle-failed', when: 'fail' },
            { from: id, to: 'settle-blocked', when: 'blocked' },
            // Restart-resume is a re-visit of the SAME unit of work, whichever turn node it was.
            { from: id, to: id, when: 'resume:restart' },
        );
    }
    edges.push(
        { from: QAAP_CHAT_TURN_NODE, to: QAAP_CHAT_TURN_FALLBACK_NODE, when: 'retry:model' },
        { from: QAAP_CHAT_TURN_FALLBACK_NODE, to: QAAP_CHAT_TURN_FALLBACK_NODE, when: 'retry:model' },
        { from: QAAP_CHAT_TURN_NODE, to: QAAP_CHAT_TURN_CONTINUE_NODE, when: 'continue:auto' },
        { from: QAAP_CHAT_TURN_FALLBACK_NODE, to: QAAP_CHAT_TURN_CONTINUE_NODE, when: 'continue:auto' },
        { from: QAAP_CHAT_TURN_CONTINUE_NODE, to: QAAP_CHAT_TURN_CONTINUE_NODE, when: 'continue:auto' },
    );
    return {
        id: QAAP_CHAT_TURN_WORKFLOW_ID,
        version: 1,
        name: 'Work Hub chat turn',
        entry: QAAP_CHAT_TURN_NODE,
        nodes,
        edges,
    };
}

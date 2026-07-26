// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** HTTP contract for Dynamic Workflow runs (ADR-001). */

import { QaapWorkflowRun } from './qaap-workflow-run';
import { QaapWorkflowTraceEntry } from './qaap-workflow-trace';

/** HTTP base path for workflow runs. */
export const QAAP_WORKFLOW_API_PATH = '/qaap/api/workflows';

/**
 * A run start is addressed by template id, never by an inline definition: the set of runnable
 * graphs is a server-side allowlist, so an arbitrary caller cannot craft a graph that spawns
 * agents with unexpected prompts, isolation or fan-out.
 */
export interface QaapStartWorkflowRequest {
    readonly templateId: string;
    readonly cwd: string;
    /** Template inputs, e.g. `{ task: 'fix the login bug' }`. */
    readonly inputs?: Readonly<Record<string, string>>;
    /**
     * Add a graph-level verification step with its own fix-loop after the implement turn. Off by
     * default because the runner already verifies each turn and repairs it in place; turning it on
     * buys a SECOND, independent repair attempt (a fresh turn against the failing scripts) at the
     * cost of running the scripts twice.
     */
    readonly verify?: boolean;
    /**
     * This run's own wall clocks, in minutes. `maxNodeMinutes` bounds one dispatched node — a
     * wedged agent CLI then fails its node and the graph routes on, instead of holding the run
     * forever — and `maxRunMinutes` bounds the whole run. Both are clamped to [1 min, 24 h]; out of
     * range or absent falls back to the defaults (30 min per node, 4 h per run).
     */
    readonly maxNodeMinutes?: number;
    readonly maxRunMinutes?: number;
    /**
     * For a goal run: the npm SCRIPT NAME whose exit code decides whether the goal is met. Never a
     * command — it is looked up in the repository's own `package.json` and invoked as
     * `npm run <name>`, so a caller cannot turn a success check into arbitrary execution. An
     * unknown name falls back to the repository's usual verification scripts.
     */
    readonly checkScript?: string;
}

/** A workflow template a client may start, safe to expose (no prompt bodies). */
export interface QaapWorkflowTemplateSummary {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    /** Input keys the template requires, so the client can collect them before starting. */
    readonly requiredInputs: readonly string[];
}

export interface QaapWorkflowTemplateListResponse {
    readonly templates: readonly QaapWorkflowTemplateSummary[];
}

/**
 * What a person is being asked to decide, while a run sits at a human gate. `detail` is the
 * artifact the gate names — the proposed plan, typically. It is the one piece of run content the
 * API returns on purpose: approving something you cannot read is not approval. Owner-scoped like
 * every other read, so it only ever reaches the person the run belongs to.
 */
export interface QaapWorkflowPendingDecision {
    readonly nodeId: string;
    readonly reasonRef: string;
    readonly detail?: string;
}

/** Public view of a run — the persisted graph state without cwd or template inputs. */
export interface QaapWorkflowRunSummary {
    readonly run: QaapWorkflowRun;
    readonly templateId: string;
    /** The declared success check of a goal run, so asking for its status says what "done" means. */
    readonly checkScript?: string;
    /** Present only while the run waits for a person; POST `/:id/continue` with its `nodeId`. */
    readonly pendingDecision?: QaapWorkflowPendingDecision;
    /**
     * What the run did, step by step. Returned when fetching ONE run — the list stays a list. Every
     * `detail` is a phrase the backend composes; repository output never travels through here.
     */
    readonly trace?: readonly QaapWorkflowTraceEntry[];
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface QaapWorkflowRunListResponse {
    readonly runs: readonly QaapWorkflowRunSummary[];
}

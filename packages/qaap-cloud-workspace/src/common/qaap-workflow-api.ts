// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** HTTP contract for Dynamic Workflow runs (ADR-001). */

import { QaapWorkflowRun } from './qaap-workflow-run';

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

/** Public view of a run — the persisted graph state without cwd or template inputs. */
export interface QaapWorkflowRunSummary {
    readonly run: QaapWorkflowRun;
    readonly templateId: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface QaapWorkflowRunListResponse {
    readonly runs: readonly QaapWorkflowRunSummary[];
}

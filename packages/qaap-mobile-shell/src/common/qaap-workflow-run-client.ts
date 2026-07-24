// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Frontend client for Dynamic Workflow runs (ADR-001).
 *
 * Types mirror `@theia/qaap-cloud-workspace/src/common/qaap-workflow-api.ts` — kept local, like
 * the other hub clients, so the frontend package does not depend on the backend package.
 */

/** Keep in sync with `@theia/qaap-cloud-workspace` {@code QAAP_WORKFLOW_API_PATH}. */
export const QAAP_WORKFLOW_API_PATH = '/qaap/api/workflows';

export type QaapWorkflowRunStatus = 'running' | 'awaiting-human' | 'succeeded' | 'failed' | 'budget-exhausted';

export interface QaapWorkflowRunState {
    readonly id: string;
    readonly defId: string;
    readonly status: QaapWorkflowRunStatus;
    readonly active: readonly string[];
    readonly visits: Readonly<Record<string, number>>;
    readonly bindings: Readonly<Record<string, string>>;
}

export interface QaapWorkflowRunSummary {
    readonly run: QaapWorkflowRunState;
    readonly templateId: string;
    readonly createdAt: number;
    readonly updatedAt: number;
}

export interface QaapWorkflowTemplateSummary {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly requiredInputs: readonly string[];
}

export async function fetchWorkflowTemplates(): Promise<readonly QaapWorkflowTemplateSummary[]> {
    const response = await fetch(`${QAAP_WORKFLOW_API_PATH}/templates`, { credentials: 'include' });
    if (!response.ok) {
        throw new Error(response.statusText);
    }
    const body = await response.json() as { templates: readonly QaapWorkflowTemplateSummary[] };
    return body.templates ?? [];
}

export async function fetchWorkflowRuns(): Promise<readonly QaapWorkflowRunSummary[]> {
    const response = await fetch(QAAP_WORKFLOW_API_PATH, { credentials: 'include' });
    if (!response.ok) {
        throw new Error(response.statusText);
    }
    const body = await response.json() as { runs: readonly QaapWorkflowRunSummary[] };
    return body.runs ?? [];
}

export async function startWorkflowRun(body: {
    readonly templateId: string;
    readonly cwd: string;
    readonly inputs?: Readonly<Record<string, string>>;
}): Promise<QaapWorkflowRunSummary> {
    const response = await fetch(QAAP_WORKFLOW_API_PATH, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(extractApiError(text) || response.statusText);
    }
    return response.json() as Promise<QaapWorkflowRunSummary>;
}

export async function continueWorkflowRun(runId: string, nodeId: string): Promise<QaapWorkflowRunSummary> {
    const response = await fetch(`${QAAP_WORKFLOW_API_PATH}/${encodeURIComponent(runId)}/continue`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId }),
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(extractApiError(text) || response.statusText);
    }
    return response.json() as Promise<QaapWorkflowRunSummary>;
}

function extractApiError(raw: string): string | undefined {
    try {
        const parsed = JSON.parse(raw) as { error?: unknown };
        return typeof parsed.error === 'string' ? parsed.error : undefined;
    } catch {
        return raw.trim() || undefined;
    }
}

/** True while the backend may still change this run without user input. */
export function isWorkflowRunActive(summary: QaapWorkflowRunSummary): boolean {
    return summary.run.status === 'running';
}

/**
 * One outcome word for a finished run, derived from the emitted bindings — the run status alone
 * says "succeeded" even when the review was skipped, which is what the user wants to see.
 */
export function workflowRunOutcomeKey(summary: QaapWorkflowRunSummary): string | undefined {
    const keys = Object.keys(summary.run.bindings);
    return keys.length > 0 ? keys[keys.length - 1] : undefined;
}

export function filterWorkflowRunsByQuery(
    runs: readonly QaapWorkflowRunSummary[],
    query: string,
): QaapWorkflowRunSummary[] {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [...runs];
    }
    return runs.filter(summary => [
        summary.templateId,
        summary.run.status,
        workflowRunOutcomeKey(summary) ?? '',
    ].join(' ').toLowerCase().includes(needle));
}

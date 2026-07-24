// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Deterministic workflow steps, registered as typed job functions (ADR-001).
 *
 * These run on the job runtime like any other function job — same lanes, leases, timeouts and
 * retries — and return `{ outcome }` so the graph routes on their result instead of on a plain
 * exit code. The risk rules themselves are reused from the review module, not re-derived.
 */

import { nls } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parseGitNumstat, resolveTaskReviewRisk } from '../common/qaap-agent-review';
import { QaapWorkflowNodeOutcome } from '../common/qaap-workflow-ir';
import { QaapJobFunctionContribution, QaapJobFunctionContext, QaapJobFunctionRegistry } from './qaap-job-function-registry';

const execFileAsync = promisify(execFile);

/** Cap the captured diff so one huge change cannot blow up the job result. */
const MAX_DIFF_BYTES = 256 * 1024;
const GIT_TIMEOUT_MS = 60_000;

export const QAAP_WORKFLOW_CLASSIFY_RISK_FUNCTION = 'qaap.workflow.classify-risk';
export const QAAP_WORKFLOW_GIT_DIFF_FUNCTION = 'qaap.workflow.git-diff';

interface ClassifyRiskOutput {
    readonly outcome: QaapWorkflowNodeOutcome;
    readonly files: readonly { readonly path: string; readonly added: number; readonly removed: number }[];
}

interface GitDiffOutput {
    readonly outcome: QaapWorkflowNodeOutcome;
    readonly diff: string;
    readonly truncated: boolean;
}

@injectable()
export class QaapWorkflowJobFunctions implements QaapJobFunctionContribution {

    registerFunctions(registry: QaapJobFunctionRegistry): void {
        registry.register<undefined, ClassifyRiskOutput>({
            descriptor: {
                id: QAAP_WORKFLOW_CLASSIFY_RISK_FUNCTION,
                label: nls.localize('qaap/workflows/functions/classifyRiskLabel', 'Classify change risk'),
                description: nls.localize(
                    'qaap/workflows/functions/classifyRiskDescription',
                    'Classifies the working-tree change as low or high risk so a workflow can decide whether to review it.',
                ),
                resourceClass: 'workspace',
                workspaceAccess: 'read',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} },
                outputSchema: { type: 'object' },
            },
            normalizeInput: () => undefined,
            execute: async context => {
                const numstat = await this.git(context, ['diff', '--numstat', 'HEAD']);
                const files = parseGitNumstat(numstat);
                return { outcome: resolveTaskReviewRisk(files) === 'high' ? 'risk:high' : 'risk:low', files };
            },
        });

        registry.register<undefined, GitDiffOutput>({
            descriptor: {
                id: QAAP_WORKFLOW_GIT_DIFF_FUNCTION,
                label: nls.localize('qaap/workflows/functions/gitDiffLabel', 'Capture working-tree diff'),
                description: nls.localize(
                    'qaap/workflows/functions/gitDiffDescription',
                    'Captures the working-tree diff so a later workflow node can judge the actual change.',
                ),
                resourceClass: 'workspace',
                workspaceAccess: 'read',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} },
                outputSchema: { type: 'object' },
            },
            normalizeInput: () => undefined,
            execute: async context => {
                const diff = await this.git(context, ['diff', 'HEAD']);
                const truncated = Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES;
                return {
                    outcome: 'success',
                    diff: truncated ? `${diff.slice(0, MAX_DIFF_BYTES)}\n… diff truncated …` : diff,
                    truncated,
                };
            },
        });
    }

    /** `execFile`, never a shell string: workflow inputs must never reach a shell. */
    protected async git(context: QaapJobFunctionContext, args: readonly string[]): Promise<string> {
        const { stdout } = await execFileAsync('git', [...args], {
            cwd: context.cwd,
            signal: context.signal,
            timeout: GIT_TIMEOUT_MS,
            maxBuffer: MAX_DIFF_BYTES * 4,
        });
        return stdout;
    }
}

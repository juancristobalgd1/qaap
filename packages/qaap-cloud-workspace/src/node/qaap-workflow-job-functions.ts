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
import * as fsp from 'fs/promises';
import * as path from 'path';
import { promisify } from 'util';
import { parseGitNumstat, QaapReviewChangedFile, resolveTaskReviewRisk } from '../common/qaap-agent-review';
import { QaapWorkflowNodeOutcome } from '../common/qaap-workflow-ir';
import { resolveQaapAgentVerificationScripts } from './qaap-agent-verification';
import { QaapJobFunctionContribution, QaapJobFunctionContext, QaapJobFunctionRegistry } from './qaap-job-function-registry';

const execFileAsync = promisify(execFile);

/** Cap the captured diff so one huge change cannot blow up the job result. */
const MAX_DIFF_BYTES = 256 * 1024;
const GIT_TIMEOUT_MS = 60_000;
/** Per-script wall clock for verification; the whole node is additionally bounded by the job timeout. */
const VERIFY_SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VERIFY_OUTPUT_BYTES = 64 * 1024;

export const QAAP_WORKFLOW_CLASSIFY_RISK_FUNCTION = 'qaap.workflow.classify-risk';
export const QAAP_WORKFLOW_GIT_DIFF_FUNCTION = 'qaap.workflow.git-diff';
export const QAAP_WORKFLOW_VERIFY_FUNCTION = 'qaap.workflow.verify';

interface ClassifyRiskOutput {
    readonly outcome: QaapWorkflowNodeOutcome;
    readonly files: readonly { readonly path: string; readonly added: number; readonly removed: number }[];
}

interface GitDiffOutput {
    readonly outcome: QaapWorkflowNodeOutcome;
    readonly diff: string;
    readonly truncated: boolean;
}

interface VerifyOutput {
    readonly outcome: QaapWorkflowNodeOutcome;
    readonly scripts?: readonly string[];
    readonly failedScript?: string;
    readonly summary?: string;
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
                const files = await this.changedFiles(context);
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
                const tracked = await this.git(context, ['diff', 'HEAD']);
                const untracked = (await this.git(context, ['ls-files', '--others', '--exclude-standard']))
                    .split('\n').map(line => line.trim()).filter(Boolean);
                // New files are absent from `git diff HEAD`; name them so the reviewer knows they
                // exist and can read them, instead of judging a change it cannot see.
                const diff = untracked.length > 0
                    ? `${tracked}\n# new files (untracked, not shown in the diff above):\n${untracked.map(file => `#   ${file}`).join('\n')}\n`
                    : tracked;
                const truncated = Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES;
                return {
                    outcome: 'success',
                    diff: truncated ? `${diff.slice(0, MAX_DIFF_BYTES)}\n… diff truncated …` : diff,
                    truncated,
                };
            },
        });

        registry.register<undefined, VerifyOutput>({
            descriptor: {
                id: QAAP_WORKFLOW_VERIFY_FUNCTION,
                label: nls.localize('qaap/workflows/functions/verifyLabel', 'Verify the workspace'),
                description: nls.localize(
                    'qaap/workflows/functions/verifyDescription',
                    'Runs the workspace verification scripts (typecheck, build, test, lint) and stops at the first failure.',
                ),
                resourceClass: 'workspace',
                workspaceAccess: 'read',
                inputSchema: { type: 'object', additionalProperties: false, properties: {} },
                outputSchema: { type: 'object' },
            },
            normalizeInput: () => undefined,
            execute: async context => this.verify(context),
        });
    }

    /**
     * Mirrors {@code QaapAgentTaskRunner.runVerificationScripts}: run each resolved npm script in
     * order via `npm run <script>` and stop at the first non-zero exit. No scripts means nothing to
     * verify, which is a success (the node exists to gate on failure, not to require config).
     */
    protected async verify(context: QaapJobFunctionContext): Promise<VerifyOutput> {
        const scripts = resolveQaapAgentVerificationScripts(await this.readPackageJson(context));
        for (const script of scripts) {
            context.emitOutput(`\n[qaap-workflow] verifying: npm run ${script}\n`);
            const failure = await this.runVerificationScript(context, script);
            if (failure) {
                return { outcome: 'fail', failedScript: script, summary: failure.slice(0, MAX_VERIFY_OUTPUT_BYTES) };
            }
        }
        return { outcome: 'success', scripts };
    }

    /** Run one npm script; return an error summary on failure, or undefined on success. Overridable for tests. */
    protected async runVerificationScript(context: QaapJobFunctionContext, script: string): Promise<string | undefined> {
        try {
            await execFileAsync('npm', ['run', script], {
                cwd: context.cwd,
                signal: context.signal,
                timeout: VERIFY_SCRIPT_TIMEOUT_MS,
                maxBuffer: MAX_VERIFY_OUTPUT_BYTES * 8,
            });
            return undefined;
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    protected async readPackageJson(context: QaapJobFunctionContext): Promise<unknown> {
        try {
            const raw = await fsp.readFile(path.join(context.cwd, 'package.json'), 'utf8');
            return JSON.parse(raw) as unknown;
        } catch {
            // No manifest or unreadable → no scripts → nothing to verify.
            return undefined;
        }
    }

    /**
     * Every file the turn touched, tracked and untracked.
     *
     * Untracked (new) files never appear in `git diff HEAD`, so counting only the diff classifies a
     * turn that CREATED files — a new `src/auth/session.ts`, say — as an empty, low-risk change and
     * silently skips the adversarial review. Mirrors the runner's own review path, which lists
     * untracked files for exactly this reason; their line counts are unknown and stay at 0, so they
     * still feed the file-count and sensitive-path signals.
     */
    protected async changedFiles(context: QaapJobFunctionContext): Promise<QaapReviewChangedFile[]> {
        const numstat = await this.git(context, ['diff', '--numstat', 'HEAD']);
        const untracked = await this.git(context, ['ls-files', '--others', '--exclude-standard']);
        return [
            ...parseGitNumstat(numstat),
            ...untracked.split('\n').map(line => line.trim()).filter(Boolean)
                .map(file => ({ path: file, added: 0, removed: 0 })),
        ];
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

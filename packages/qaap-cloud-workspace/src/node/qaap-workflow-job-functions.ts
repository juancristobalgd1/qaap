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
import {
    DEFAULT_REVIEW_DIFF_CAP_CHARS,
    parseGitNumstat,
    QaapReviewChangedFile,
    resolveTaskReviewRisk,
} from '../common/qaap-agent-review';
import { QaapWorkflowNodeOutcome } from '../common/qaap-workflow-ir';
import {
    isQaapVerificationScriptName,
    resolveQaapAgentVerificationScripts,
    resolveQaapDeclaredVerificationScript,
} from './qaap-agent-verification';
import { QaapJobFunctionContribution, QaapJobFunctionContext, QaapJobFunctionRegistry } from './qaap-job-function-registry';

const execFileAsync = promisify(execFile);

/** Cap the captured diff so one huge change cannot blow up the job result. */
const MAX_DIFF_BYTES = 256 * 1024;
const GIT_TIMEOUT_MS = 60_000;
/** Per-script wall clock for verification; the whole node is additionally bounded by the job timeout. */
const VERIFY_SCRIPT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_VERIFY_OUTPUT_BYTES = 64 * 1024;
/**
 * How much of the failing output the fix turn is handed. Far below the 64 KB capture: a prompt that
 * carries a whole build log buries the three lines that matter, and the run store caps artifacts
 * anyway.
 */
const MAX_VERIFY_ARTIFACT_CHARS = 12_000;

/**
 * What the run compares against. A workflow's change is everything since the run STARTED, so the
 * caller passes the commit the repository was on back then.
 *
 * `HEAD` is not a safe default at read time: the default agent prompt tells a coding turn to work
 * toward a reviewable PR, so agents commit. Observed live — an agent committed its fix, left a
 * clean tree, and `git diff HEAD` reported an empty change: risk `low`, adversarial review skipped
 * on work that was never reviewed.
 */
export interface QaapWorkflowBaseRefInput {
    readonly baseRef?: string;
    /**
     * The run's declared success check: the one npm script that decides whether the goal is met.
     * Only meaningful to the `verify` op. A name, never a command — see
     * {@link resolveQaapDeclaredVerificationScript}.
     */
    readonly script?: string;
}

/** Git refs only — this value reaches `git` as an argument. */
const SAFE_GIT_REF = /^[0-9a-zA-Z._\-/]{1,255}$/;

const BASE_REF_INPUT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: { baseRef: { type: 'string' }, script: { type: 'string' } },
} as const;

function normalizeBaseRefInput(input: unknown): QaapWorkflowBaseRefInput {
    if (input === undefined || input === null) {
        return {};
    }
    if (typeof input !== 'object' || Array.isArray(input)) {
        throw new Error(nls.localize('qaap/workflows/functions/inputMustBeObject', 'Function input must be an object.'));
    }
    const record = input as Record<string, unknown>;
    const baseRef = record.baseRef;
    if (baseRef !== undefined && (typeof baseRef !== 'string' || !SAFE_GIT_REF.test(baseRef))) {
        throw new Error(nls.localize('qaap/workflows/functions/invalidBaseRef', '"baseRef" must be a git ref.'));
    }
    const script = record.script;
    if (script !== undefined && (typeof script !== 'string' || !isQaapVerificationScriptName(script))) {
        throw new Error(nls.localize('qaap/workflows/functions/invalidScript', '"script" must be an npm script name.'));
    }
    return {
        ...(typeof baseRef === 'string' ? { baseRef } : {}),
        ...(typeof script === 'string' ? { script } : {}),
    };
}

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
    /**
     * The diff again, capped at what a reviewer prompt can carry. The dispatcher stores this under
     * the node's `artifactKey` so the judge downstream inlines the real change instead of an empty
     * diff. Kept separate from {@link diff} so the run index never holds the full 256 KB capture.
     */
    readonly artifact: string;
}

interface VerifyOutput {
    readonly outcome: QaapWorkflowNodeOutcome;
    readonly scripts?: readonly string[];
    readonly failedScript?: string;
    readonly summary?: string;
    /**
     * The failure again, cut down to what a fix prompt can carry. Named `artifact` for the same
     * reason `git-diff` is: the dispatcher stores exactly this field under the node's `artifactKey`,
     * so a deterministic op declares what it publishes instead of the dispatcher learning the shape
     * of every op's result. Kept separate from {@link summary} so the run index never holds the
     * whole 64 KB capture.
     */
    readonly artifact?: string;
}

@injectable()
export class QaapWorkflowJobFunctions implements QaapJobFunctionContribution {

    registerFunctions(registry: QaapJobFunctionRegistry): void {
        registry.register<QaapWorkflowBaseRefInput, ClassifyRiskOutput>({
            descriptor: {
                id: QAAP_WORKFLOW_CLASSIFY_RISK_FUNCTION,
                label: nls.localize('qaap/workflows/functions/classifyRiskLabel', 'Classify change risk'),
                description: nls.localize(
                    'qaap/workflows/functions/classifyRiskDescription',
                    'Classifies the working-tree change as low or high risk so a workflow can decide whether to review it.',
                ),
                resourceClass: 'workspace',
                workspaceAccess: 'read',
                inputSchema: BASE_REF_INPUT_SCHEMA,
                outputSchema: { type: 'object' },
            },
            normalizeInput: normalizeBaseRefInput,
            execute: async (context, input) => {
                const files = await this.changedFiles(context, input.baseRef);
                return { outcome: resolveTaskReviewRisk(files) === 'high' ? 'risk:high' : 'risk:low', files };
            },
        });

        registry.register<QaapWorkflowBaseRefInput, GitDiffOutput>({
            descriptor: {
                id: QAAP_WORKFLOW_GIT_DIFF_FUNCTION,
                label: nls.localize('qaap/workflows/functions/gitDiffLabel', 'Capture working-tree diff'),
                description: nls.localize(
                    'qaap/workflows/functions/gitDiffDescription',
                    'Captures the working-tree diff so a later workflow node can judge the actual change.',
                ),
                resourceClass: 'workspace',
                workspaceAccess: 'read',
                inputSchema: BASE_REF_INPUT_SCHEMA,
                outputSchema: { type: 'object' },
            },
            normalizeInput: normalizeBaseRefInput,
            execute: async (context, input) => {
                const tracked = await this.git(context, ['diff', input.baseRef ?? 'HEAD']);
                const untracked = (await this.git(context, ['ls-files', '--others', '--exclude-standard']))
                    .split('\n').map(line => line.trim()).filter(Boolean);
                // New files are absent from `git diff HEAD`; name them so the reviewer knows they
                // exist and can read them, instead of judging a change it cannot see.
                const diff = untracked.length > 0
                    ? `${tracked}\n# new files (untracked, not shown in the diff above):\n${untracked.map(file => `#   ${file}`).join('\n')}\n`
                    : tracked;
                const truncated = Buffer.byteLength(diff, 'utf8') > MAX_DIFF_BYTES;
                const captured = truncated ? `${diff.slice(0, MAX_DIFF_BYTES)}\n… diff truncated …` : diff;
                return {
                    outcome: 'success',
                    diff: captured,
                    truncated,
                    artifact: captured.slice(0, DEFAULT_REVIEW_DIFF_CAP_CHARS),
                };
            },
        });

        registry.register<QaapWorkflowBaseRefInput, VerifyOutput>({
            descriptor: {
                id: QAAP_WORKFLOW_VERIFY_FUNCTION,
                label: nls.localize('qaap/workflows/functions/verifyLabel', 'Verify the workspace'),
                description: nls.localize(
                    'qaap/workflows/functions/verifyDescription',
                    'Runs the workspace verification scripts (typecheck, build, test, lint) and stops at the first failure.',
                ),
                resourceClass: 'workspace',
                workspaceAccess: 'read',
                inputSchema: BASE_REF_INPUT_SCHEMA,
                outputSchema: { type: 'object' },
            },
            normalizeInput: normalizeBaseRefInput,
            execute: async (context, input) => this.verify(context, input.script),
        });
    }

    /**
     * Mirrors {@code QaapAgentTaskRunner.runVerificationScripts}: run each resolved npm script in
     * order via `npm run <script>` and stop at the first non-zero exit. No scripts means nothing to
     * verify, which is a success (the node exists to gate on failure, not to require config).
     */
    protected async verify(context: QaapJobFunctionContext, declaredScript?: string): Promise<VerifyOutput> {
        const packageJson = await this.readPackageJson(context);
        // A run that declared its own success check is measured by THAT, and by nothing else: the
        // point of a goal is that the caller, not the repository layout, decides what "done" means.
        // An unknown name falls back to the repository's scripts rather than verifying nothing.
        const declared = resolveQaapDeclaredVerificationScript(packageJson, declaredScript);
        const scripts = declared ? [declared] : resolveQaapAgentVerificationScripts(packageJson);
        for (const script of scripts) {
            context.emitOutput(`\n[qaap-workflow] verifying: npm run ${script}\n`);
            const failure = await this.runVerificationScript(context, script);
            if (failure) {
                return {
                    outcome: 'fail',
                    failedScript: script,
                    summary: failure.slice(0, MAX_VERIFY_OUTPUT_BYTES),
                    artifact: this.failureArtifact(script, failure),
                };
            }
        }
        return { outcome: 'success', scripts };
    }

    /**
     * The failing output as the fix turn receives it: the script that failed, then the END of what
     * it printed. The tail, not the head — the head of `npm run` is npm's own banner, while the
     * reason for a non-zero exit (the failing assertion, `Found 12 errors.`) lands last.
     */
    protected failureArtifact(script: string, failure: string): string {
        const trimmed = failure.trim();
        const tail = trimmed.length > MAX_VERIFY_ARTIFACT_CHARS
            ? `…(earlier output trimmed)\n${trimmed.slice(-MAX_VERIFY_ARTIFACT_CHARS)}`
            : trimmed;
        return `\`npm run ${script}\` failed:\n\n${tail}`;
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
            return this.describeScriptFailure(error);
        }
    }

    /**
     * What the script actually printed. `error.message` alone is `Command failed: npm run compile`
     * plus stderr — and the tools this repository verifies with (tsc, mocha) report on STDOUT, so a
     * fix turn given only the message is told that something failed and nothing about what.
     */
    protected describeScriptFailure(error: unknown): string {
        const streams = error as { readonly stdout?: unknown; readonly stderr?: unknown } | undefined;
        const stdout = typeof streams?.stdout === 'string' ? streams.stdout.trim() : '';
        const stderr = typeof streams?.stderr === 'string' ? streams.stderr.trim() : '';
        const message = error instanceof Error ? error.message : String(error);
        // execFile already folds stderr into its message; only add it when it is not there already.
        return [message, stdout, stderr && !message.includes(stderr) ? stderr : ''].filter(Boolean).join('\n');
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
    protected async changedFiles(context: QaapJobFunctionContext, baseRef?: string): Promise<QaapReviewChangedFile[]> {
        const numstat = await this.git(context, ['diff', '--numstat', baseRef ?? 'HEAD']);
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

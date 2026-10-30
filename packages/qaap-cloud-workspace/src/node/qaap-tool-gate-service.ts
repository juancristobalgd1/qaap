// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';
import { QaapBashReadOnlyClassifier } from '@theia/qaap-shared-core/lib/common/qaap-bash-readonly-classifier';
import {
    QAAP_TOOL_GATE_MAX_ASK_TTL_SEC,
    type QaapToolGateDecision,
    type QaapToolGateRequest,
} from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import type { QaapToolGateAskOutcome } from './qaap-tool-gate-ask-broker';
import { findQaiqDestructiveCommandGuardDenial } from '../common/qaap-agent-destructive-command-guard';
import { findQaiqDevServerGuardDenial } from '../common/qaap-agent-dev-server-guard';
import {
    buildQaiqAutoDeniedToolMessage,
    resolveQaiqControlRequestAutoAction,
    resolveQaiqControlRequestAutoDecision,
    type QaapQaiqControlAutoAction,
    type QaapQaiqControlAutoOptions,
    type QaapQaiqControlAutoReason,
} from '../common/qaap-qaiq-control-auto-response';
import type { QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';

/** Everything the service needs to decide one QAIQ `can_use_tool` control request. */
export interface QaapQaiqToolGateInput {
    /** Spawned CLI command line; the approval flags in it are the policy signal. */
    readonly command: string;
    /** Task `autoApprove`: `false` is request-approval, anything else auto-approves what the guards allow. */
    readonly autoApprove: boolean | undefined;
    readonly request: QaapQaiqPendingControlRequest;
    readonly cwd: string;
    /** Read-only shell preference and the runtime safety checks the classifier needs. */
    readonly options: QaapQaiqControlAutoOptions;
    /** Lazy: only consulted when the request is answered without queueing, like the legacy inline code. */
    readonly reservedPort?: () => number | undefined;
}

export interface QaapQaiqToolGateOutcome {
    readonly action: QaapQaiqControlAutoAction;
    readonly reason?: QaapQaiqControlAutoReason;
    readonly detail?: string;
    /** Set when a read-only shell command was NOT auto-approved because of a runtime safety check. */
    readonly readOnlyBlockedReason?: string;
    readonly devServerDenial?: string;
    readonly destructiveDenial?: string;
    /** The reserved dev-preview port the dev-server denial was built with (resolved once per request). */
    readonly reservedPort?: number;
    /** Deny guidance for the agent; set only when {@link action} is not `queue`. */
    readonly denyMessage?: string;
    /** The `decision` the observability record carries for this answer. */
    readonly observabilityDecision: 'approve' | 'reject' | 'queue';
    /** True when a queued request must get the unattended-run grace timeout (auto-approve runs only). */
    readonly scheduleQueueTimeout: boolean;
}

/** What the PreToolUse hooks decided for one tool call (see `QaapAgentHookService.evaluatePreToolUse`). */
export interface QaapToolGateHookOutcome {
    readonly decision?: 'allow' | 'deny' | 'ask';
    readonly reason?: string;
    readonly updatedInput?: Record<string, unknown>;
}

/** What {@link QaapToolGateService.evaluate} needs to know about the task a gate token belongs to. */
export interface QaapToolGateEvaluationEnv {
    readonly taskId: string;
    readonly owner: string | undefined;
    /** Workspace the task runs in; the request cwd must lie inside it. */
    readonly workspace: string;
    /** Task `autoApprove`: `false` is request-approval, anything else auto-approves what the guards allow. */
    readonly autoApprove: boolean | undefined;
    readonly readOnlyWorkspace: boolean;
    /** One-shot grants: only read tools and read-only shell commands pass; every other tool kind is denied. */
    readonly strictReadOnly?: boolean;
    /** PreToolUse hooks for this task's workspace; absent for one-shot grants. */
    readonly hooks?: (toolName: string, input: Record<string, unknown>, toolUseId: string | undefined) => Promise<QaapToolGateHookOutcome>;
    /**
     * Same runtime checks QAIQ requires before it trusts the read-only shell classifier: a reason when
     * git could run a program from config (fsmonitor, pager, textconv...), and when a path argument leaves
     * `cwd` once symlinks are resolved. Absent checks mean "not verified", i.e. NOT read-only.
     */
    readonly checkGitExecConfig?: (cwd: string) => string | undefined;
    readonly checkPathsInsideCwd?: (cwd: string, paths: readonly string[]) => string | undefined;
    /** Max seconds one ask may block (capability registry); capped at {@link QAAP_TOOL_GATE_MAX_ASK_TTL_SEC}. 0 = cannot ask. */
    readonly askTtlSec: number;
    /** Raises an approval card (same cards as QAIQ) and waits for the human. */
    readonly ask: (request: QaapQaiqPendingControlRequest, ttlMs: number, signal?: AbortSignal) => Promise<QaapToolGateAskOutcome>;
}

/**
 * The single place that decides whether a tool call runs. P0-1: the QAIQ stdio decision logic moved
 * here from the task runner, byte-for-byte; the runner keeps only the side effects (stdin response,
 * approval queue, observability, logging). Stateless and synchronous on purpose, so the golden
 * corpus (`qaap-tool-gate-service.spec.ts`) can lock it.
 */
@injectable()
export class QaapToolGateService {

    /**
     * Precedence: dev-server deny > destructive guard > core `--tools` allowlist deny > read-only shell
     * auto-approval > preset rules (see {@link resolveQaiqControlRequestAutoDecision}); then, for any
     * answer other than queue, the dev-server / destructive guard messages take priority over the
     * generic headless-tool deny message.
     */
    evaluateQaiqControlRequest(input: QaapQaiqToolGateInput): QaapQaiqToolGateOutcome {
        const { command, autoApprove, request, cwd } = input;
        const autoDecision = resolveQaiqControlRequestAutoDecision(command, autoApprove, request, input.options);
        const action = autoDecision.action;
        let devServerDenial: string | undefined;
        let destructiveDenial: string | undefined;
        let denyMessage: string | undefined;
        let reservedPort: number | undefined;
        if (action !== 'queue') {
            reservedPort = input.reservedPort?.();
            devServerDenial = findQaiqDevServerGuardDenial(request, { reservedPort });
            destructiveDenial = findQaiqDestructiveCommandGuardDenial(request, cwd);
            denyMessage = devServerDenial
                ?? destructiveDenial
                ?? (action === 'deny' && request.toolName
                    ? buildQaiqAutoDeniedToolMessage(request.toolName, request.toolInput)
                    : undefined);
        }
        return {
            action,
            ...(autoDecision.reason !== undefined ? { reason: autoDecision.reason } : {}),
            ...(autoDecision.detail !== undefined ? { detail: autoDecision.detail } : {}),
            ...(autoDecision.readOnlyBlockedReason !== undefined ? { readOnlyBlockedReason: autoDecision.readOnlyBlockedReason } : {}),
            ...(devServerDenial !== undefined ? { devServerDenial } : {}),
            ...(destructiveDenial !== undefined ? { destructiveDenial } : {}),
            ...(reservedPort !== undefined ? { reservedPort } : {}),
            ...(denyMessage !== undefined ? { denyMessage } : {}),
            observabilityDecision: action === 'allow' ? 'approve' : action === 'deny' ? 'reject' : 'queue',
            scheduleQueueTimeout: action === 'queue' && autoApprove !== false,
        };
    }

    protected readonly inflight = new Map<string, Promise<QaapToolGateDecision>>();

    /**
     * Decision for one tool call made by an external harness (HTTP gate). The task, owner and workspace
     * come from `env` (derived from the gate token), never from `req`. Order: workspace containment,
     * read-only policy, destructive guard, dev-server guard, then the approval policy. A repeated
     * `(taskId, harnessCallId)` while one is pending shares the pending answer. Any internal error is a deny.
     */
    async evaluate(req: QaapToolGateRequest, env: QaapToolGateEvaluationEnv, signal?: AbortSignal): Promise<QaapToolGateDecision> {
        const key = req.harnessCallId ? `${env.taskId}:${req.harnessCallId}` : undefined;
        const existing = key ? this.inflight.get(key) : undefined;
        if (existing) {
            return existing;
        }
        const run = this.decide(req, env, signal).catch((): QaapToolGateDecision => ({
            kind: 'deny',
            source: 'gate-error',
            retryable: true,
            reason: nls.localize('theia/qaap-cloud-workspace/toolGateError', 'The Qaap safety gate failed to evaluate this tool call; it was blocked.'),
        }));
        if (key) {
            this.inflight.set(key, run);
            void run.finally(() => this.inflight.delete(key));
        }
        return run;
    }

    protected async decide(req: QaapToolGateRequest, env: QaapToolGateEvaluationEnv, signal?: AbortSignal): Promise<QaapToolGateDecision> {
        if (!this.isInsideWorkspace(req.cwd, env.workspace)) {
            return {
                kind: 'deny',
                source: 'policy',
                reason: nls.localize('theia/qaap-cloud-workspace/toolGateOutsideWorkspace', 'The tool call targets a directory outside the task workspace.'),
            };
        }
        const isShell = req.toolKind === 'shell';
        // Guards key on the QAIQ shell tool name; the adapter already normalized the kind.
        const toolName = isShell ? 'Bash' : req.rawToolName;
        const requestFor = (toolInput: Record<string, unknown>): QaapQaiqPendingControlRequest => ({
            requestId: `gate-${req.harnessCallId ?? randomUUID()}`,
            toolUseId: req.harnessCallId,
            toolName,
            toolInput,
        });
        // Steps 1-3 (read-only, destructive guard, dev-server guard) run in every mode, and again on any
        // input a hook rewrites, so a hook can never smuggle a guarded command past them.
        const denialFor = (toolInput: Record<string, unknown>): QaapToolGateDecision | undefined => {
            if (env.strictReadOnly && req.toolKind !== 'read' && !isShell) {
                return {
                    kind: 'deny',
                    source: 'read-only',
                    reason: nls.localize('theia/qaap-cloud-workspace/toolGateStrictReadOnly', 'This call may only read the workspace; this tool was blocked.'),
                };
            }
            if (env.readOnlyWorkspace) {
                const command = typeof toolInput.command === 'string' ? toolInput.command : undefined;
                const writes = req.toolKind === 'edit' || req.toolKind === 'write'
                    || (isShell && !this.isVerifiedReadOnlyShell(command, req.cwd, env));
                if (writes) {
                    return {
                        kind: 'deny',
                        source: 'read-only',
                        reason: nls.localize('theia/qaap-cloud-workspace/toolGateReadOnly', 'This task is read-only; it may not modify the workspace.'),
                    };
                }
            }
            const guarded = requestFor(toolInput);
            const destructive = findQaiqDestructiveCommandGuardDenial(guarded, req.cwd);
            if (destructive) {
                return { kind: 'deny', source: 'destructive-guard', reason: destructive };
            }
            const devServer = findQaiqDevServerGuardDenial(guarded);
            return devServer ? { kind: 'deny', source: 'dev-server-guard', reason: devServer } : undefined;
        };
        const firstDenial = denialFor(req.input);
        if (firstDenial) {
            return firstDenial;
        }
        // Step 4: user / workspace PreToolUse hooks (digest-trusted by the hook service, so an untrusted
        // workspace's hooks never run). Same semantics as QAIQ: deny rejects, allow approves (only past the
        // guards above), ask forces a user card, no decision falls through to the approval policy, and a
        // hook that fails never blocks (the hook service surfaces it as a warning).
        let input = req.input;
        let updatedInput: Record<string, unknown> | undefined;
        let forceAsk = false;
        if (env.hooks) {
            let outcome: QaapToolGateHookOutcome = {};
            try {
                outcome = await env.hooks(toolName, req.input, req.harnessCallId);
            } catch {
                outcome = {};
            }
            if (outcome.decision !== 'deny' && outcome.updatedInput) {
                const rewrittenDenial = denialFor({ ...req.input, ...outcome.updatedInput });
                if (rewrittenDenial) {
                    return rewrittenDenial;
                }
                // Hooks may return a partial input; clients replace the whole input, so the merge on top of the
                // original happens here and the gate only ever returns the COMPLETE input.
                updatedInput = { ...req.input, ...outcome.updatedInput };
                input = updatedInput;
            }
            if (outcome.decision === 'deny') {
                return {
                    kind: 'deny',
                    source: 'hook',
                    reason: nls.localize('theia/qaap-cloud-workspace/toolGateHookDenied', 'Blocked by a PreToolUse hook: {0}', outcome.reason ?? 'Denied by a PreToolUse hook.'),
                };
            }
            if (outcome.decision === 'allow') {
                return { kind: 'allow', source: 'hook', ...(updatedInput ? { updatedInput } : {}) };
            }
            forceAsk = outcome.decision === 'ask';
        }
        const request = requestFor(input);
        if (!forceAsk && (env.autoApprove !== false || req.toolKind === 'read')) {
            return { kind: 'allow', source: 'policy', ...(updatedInput ? { updatedInput } : {}) };
        }
        const ttlSec = Math.min(env.askTtlSec, QAAP_TOOL_GATE_MAX_ASK_TTL_SEC);
        if (!(ttlSec > 0)) {
            return {
                kind: 'deny',
                source: 'policy',
                reason: nls.localize('theia/qaap-cloud-workspace/toolGateCannotAsk',
                    'This agent cannot ask for approval, so the tool call was blocked.'),
            };
        }
        const outcome = await env.ask(request, ttlSec * 1000, signal);
        if (outcome === 'approve') {
            return { kind: 'allow', source: 'user', ...(updatedInput ? { updatedInput } : {}) };
        }
        if (outcome === 'reject') {
            return {
                kind: 'deny',
                source: 'user',
                reason: nls.localize('theia/qaap-cloud-workspace/toolGateRejected', 'The user rejected this tool call.'),
            };
        }
        if (outcome === 'ttl') {
            return {
                kind: 'deny',
                source: 'ttl',
                retryable: true,
                reason: nls.localize('theia/qaap-cloud-workspace/toolGateExpired', 'Approval timed out; ask the user again.'),
            };
        }
        return {
            kind: 'deny',
            source: 'policy',
            reason: nls.localize('theia/qaap-cloud-workspace/toolGateCancelled', 'The task ended before this tool call was approved.'),
        };
    }

    /** Read-only per the classifier AND the git-config and path-containment checks, exactly like QAIQ. */
    protected isVerifiedReadOnlyShell(command: string | undefined, cwd: string, env: QaapToolGateEvaluationEnv): boolean {
        const verdict = QaapBashReadOnlyClassifier.classifyCommand(command, { cwd });
        if (!verdict.readOnly) {
            return false;
        }
        try {
            if (verdict.commands?.includes('git')) {
                const gitRisk = env.checkGitExecConfig ? env.checkGitExecConfig(cwd) : 'git config not verified';
                if (gitRisk) {
                    return false;
                }
            }
            if (verdict.paths?.length) {
                const pathRisk = env.checkPathsInsideCwd ? env.checkPathsInsideCwd(cwd, verdict.paths) : 'paths not verified';
                if (pathRisk) {
                    return false;
                }
            }
        } catch {
            return false;
        }
        return true;
    }

    protected isInsideWorkspace(cwd: string, workspace: string): boolean {
        if (typeof cwd !== 'string' || !cwd || !path.isAbsolute(cwd)) {
            return false;
        }
        const real = (value: string): string => {
            try {
                return fs.realpathSync(value);
            } catch {
                return path.resolve(value);
            }
        };
        const relative = path.relative(real(workspace), real(cwd));
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }

    /**
     * A PreToolUse hook may approve, but never past a Qaap deny rule (core `--tools` allowlist,
     * dev-server guard, destructive-command guard): such requests fall through to the normal path.
     */
    isHookAllowBlocked(command: string | undefined, autoApprove: boolean | undefined,
        request: QaapQaiqPendingControlRequest, cwd: string): boolean {
        return resolveQaiqControlRequestAutoAction(command ?? '', autoApprove, request) === 'deny'
            || !!findQaiqDevServerGuardDenial(request)
            || !!findQaiqDestructiveCommandGuardDenial(request, cwd);
    }
}

/** Stateless fallback for bare test harnesses that build a runner context without DI. */
export const DEFAULT_QAAP_TOOL_GATE_SERVICE = new QaapToolGateService();

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { nls } from '@theia/core/lib/common/nls';
import {
    QAAP_TOOL_GATE_API_PATH,
    QAAP_TOOL_GATE_ARM_NONCE_HEADER,
    QAAP_TOOL_GATE_CLIENT_ERRORS_HEADER,
    QAAP_TOOL_GATE_MAX_CONSECUTIVE_ERRORS,
    QAAP_TOOL_GATE_TOKEN_HEADER,
    type QaapToolGateDecision,
    type QaapToolGateRequest,
} from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { resolveQaapHarnessCapabilities, type QaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { agentHookContextForTask } from './qaap-agent-task-runner-hooks';
import { QaapToolGateAskBroker } from './qaap-tool-gate-ask-broker';
import { QaapToolGateService } from './qaap-tool-gate-service';
import { QaapToolGateTokenService, type QaapToolGateTokenGrant } from './qaap-tool-gate-token-service';

/** Max asks one task may have waiting at the same time; more are denied. */
export const QAAP_TOOL_GATE_MAX_PENDING_ASKS = 5;
/** Max evaluate calls per task per minute. */
export const QAAP_TOOL_GATE_MAX_CALLS_PER_MINUTE = 60;

/**
 * HTTP surface of the tool gate for external harnesses (Pi, Codex, OpenCode, Claude hooks).
 * Authentication is the per-task gate token and nothing else: the session / API-token / task-token
 * guards are deliberately not consulted, and the gate token is not accepted anywhere else.
 */
@injectable()
export class QaapToolGateEndpoint implements BackendApplicationContribution {

    @inject(QaapToolGateTokenService)
    protected readonly tokens: QaapToolGateTokenService;

    @inject(QaapToolGateService)
    protected readonly gate: QaapToolGateService;

    @inject(QaapToolGateAskBroker)
    protected readonly asks: QaapToolGateAskBroker;

    @inject(QaapAgentTaskRunner)
    protected readonly runner: QaapAgentTaskRunner;

    protected readonly callTimes = new Map<string, number[]>();
    /** Consecutive gate-side failures per task (decisions with source `gate-error`); reset on any other answer. */
    protected readonly gateErrors = new Map<string, number>();

    configure(app: Application): void {
        app.get(`${QAAP_TOOL_GATE_API_PATH}/health`, (req, res) => {
            this.handleHealth(req, res);
        });
        app.post(`${QAAP_TOOL_GATE_API_PATH}/arm`, (req, res) => {
            this.handleArm(req, res);
        });
        app.post(`${QAAP_TOOL_GATE_API_PATH}/evaluate`, (req, res) => {
            this.handleEvaluate(req, res).catch(() => {
                // An internal failure is a 5xx the client counts as a gate error (fail closed on its side).
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Tool gate failure' });
                }
            });
        });
    }

    protected handleHealth(req: Request, res: Response): void {
        if (!this.requireGrant(req, res)) {
            return;
        }
        res.set('Cache-Control', 'no-store');
        res.json({ ok: true });
    }

    /** A harness plugin reports that it loaded: the runner cancels the task if this never arrives. */
    protected handleArm(req: Request, res: Response): void {
        const grant = this.requireGrant(req, res);
        if (!grant) {
            return;
        }
        res.set('Cache-Control', 'no-store');
        // The token is inherited by everything the agent runs; only the plugin holds the one-time nonce.
        const nonce = req.header(QAAP_TOOL_GATE_ARM_NONCE_HEADER);
        if (!this.tokens.arm(grant.taskId, nonce)) {
            res.status(403).json({ ok: false });
            return;
        }
        res.json({ ok: true });
    }

    protected async handleEvaluate(req: Request, res: Response): Promise<void> {
        const grant = this.requireGrant(req, res);
        if (!grant) {
            return;
        }
        res.set('Cache-Control', 'no-store');
        // A one-shot grant has no task behind it: it is read-only, valid until its process ends.
        const task = grant.oneShot
            ? { autoApprove: true, readOnlyWorkspace: true, state: 'running' as const }
            : await this.runner.detail(grant.taskId);
        if (!task || task.state !== 'running') {
            this.tokens.revoke(grant.taskId);
            this.callTimes.delete(grant.taskId);
            this.gateErrors.delete(grant.taskId);
            this.unauthorized(res);
            return;
        }
        const body = (req.body ?? {}) as Partial<QaapToolGateRequest>;
        if (typeof body.rawToolName !== 'string' || !body.rawToolName || typeof body.cwd !== 'string') {
            res.status(400).json(this.deny('policy', nls.localize('theia/qaap-cloud-workspace/toolGateBadRequest', 'Malformed tool gate request.')));
            return;
        }
        if (this.rateLimited(grant.taskId)) {
            res.json(this.deny('policy', nls.localize('theia/qaap-cloud-workspace/toolGateRateLimited', 'Too many tool gate requests; slow down.'), true));
            return;
        }
        // The agent, tool kind, owner and task all come from the server side: a harness can lie
        // about `toolKind` (for example "read") to dodge an ask, so it is recomputed here.
        const agentId = grant.oneShot ? grant.oneShot.agentId : this.runner.resolveTaskAgentId(task as Parameters<QaapAgentTaskRunner['resolveTaskAgentId']>[0]);
        const caps = this.resolveCapabilities(agentId);
        const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input)
            ? body.input as Record<string, unknown>
            : {};
        const request: QaapToolGateRequest = {
            taskId: grant.taskId,
            agentId,
            toolKind: caps.mapToolKind(body.rawToolName, input),
            rawToolName: body.rawToolName,
            input,
            cwd: body.cwd,
            ...(typeof body.harnessCallId === 'string' && body.harnessCallId ? { harnessCallId: body.harnessCallId } : {}),
        };
        const abort = new AbortController();
        res.on('close', () => {
            if (!res.writableEnded) {
                abort.abort();
            }
        });
        const decision = await this.gate.evaluate(request, {
            taskId: grant.taskId,
            owner: grant.owner,
            workspace: grant.workspace,
            autoApprove: task.autoApprove,
            readOnlyWorkspace: !!task.readOnlyWorkspace,
            strictReadOnly: !!grant.oneShot,
            hooks: grant.oneShot || !this.runner.agentHooks ? undefined : async (toolName, toolInput, toolUseId) => {
                const hooks = this.runner.agentHooks!;
                const hookContext = agentHookContextForTask(this.runner, task as unknown as QaapAgentTask);
                return hooks.hasHooks(hookContext, 'PreToolUse', toolName)
                    ? hooks.evaluatePreToolUse(hookContext, toolName, toolInput, toolUseId)
                    : {};
            },
            checkGitExecConfig: cwd => this.runner.checkGitExecConfig(cwd),
            checkPathsInsideCwd: (cwd, paths) => this.runner.checkShellPathsInsideCwd(cwd, paths),
            askTtlSec: caps.canAsk && !grant.oneShot ? caps.askTtlSec : 0,
            ask: (pending, ttlMs, signal) => this.asks.count(grant.taskId) >= QAAP_TOOL_GATE_MAX_PENDING_ASKS
                ? Promise.resolve('cancelled')
                : this.asks.ask(grant.taskId, pending, ttlMs, signal),
        }, abort.signal);
        this.audit(grant, agentId, request, decision);
        if (!grant.oneShot) {
            this.trackGateHealth(grant, agentId, decision, this.reportedClientErrors(req));
        }
        if (!res.writableEnded && !res.destroyed) {
            res.json({ decision });
        }
    }

    protected reportedClientErrors(req: Request): number {
        const value = Number.parseInt(req.header(QAAP_TOOL_GATE_CLIENT_ERRORS_HEADER) ?? '', 10);
        return Number.isFinite(value) && value > 0 ? Math.min(value, 100) : 0;
    }

    /**
     * Section 6 of the design: after {@link QAAP_TOOL_GATE_MAX_CONSECUTIVE_ERRORS} consecutive gate errors the
     * task is stopped (interrupted, so the user can Continue) instead of denying every tool. A gate error is a
     * `gate-error` decision made here, plus the transport failures the client reports with its next request.
     * A normal deny (policy, guard, hook, user, ttl) is an answer, not an error, and resets the counter.
     */
    protected trackGateHealth(grant: QaapToolGateTokenGrant, agentId: string, decision: QaapToolGateDecision, clientErrors: number): void {
        const previous = this.gateErrors.get(grant.taskId) ?? 0;
        const failed = decision.kind === 'deny' && decision.source === 'gate-error';
        const consecutive = (failed ? previous + 1 : 0) + clientErrors;
        if (failed) {
            this.gateErrors.set(grant.taskId, previous + 1);
        } else {
            this.gateErrors.delete(grant.taskId);
        }
        if (consecutive < QAAP_TOOL_GATE_MAX_CONSECUTIVE_ERRORS) {
            return;
        }
        this.gateErrors.delete(grant.taskId);
        const message = nls.localize('theia/qaap-cloud-workspace/toolGateUnavailable',
            'The Qaap safety gate failed {0} times in a row, so the run was stopped. Continue the task to retry.', consecutive);
        try {
            this.runner.appendAndFireOutput(grant.taskId, `\n[qaap] ${message}\n`);
            this.runner.observability?.recordAgentToolCommand({
                taskId: grant.taskId,
                tenantLogin: grant.owner,
                agentId,
                toolName: 'qaap-tool-gate',
                command: `gate unavailable: ${consecutive} consecutive errors`,
                decision: 'reject',
            });
        } catch {
            // Reporting must not stop the cancel below.
        }
        this.runner.cancel(grant.taskId, { interrupt: true });
    }

    /**
     * Audit record of the decision with the input that actually runs. Pi's own JSONL keeps the ORIGINAL
     * arguments even when the gate rewrites them, so the final (updated) input is logged here.
     */
    protected audit(grant: QaapToolGateTokenGrant, agentId: string, request: QaapToolGateRequest, decision: QaapToolGateDecision): void {
        try {
            const finalInput = decision.kind === 'allow' && decision.updatedInput ? decision.updatedInput : request.input;
            const command = typeof finalInput.command === 'string'
                ? finalInput.command
                : JSON.stringify(finalInput).slice(0, 2000);
            this.runner.observability?.recordAgentToolCommand({
                taskId: grant.taskId,
                tenantLogin: grant.owner,
                agentId,
                requestId: `gate-${request.harnessCallId ?? grant.taskId}`,
                toolUseId: request.harnessCallId,
                toolName: request.rawToolName,
                command,
                decision: decision.kind === 'allow' ? 'approve' : 'reject',
                ...(decision.kind === 'allow' && decision.updatedInput ? { autoApprovalReason: 'input-rewritten' } : {}),
            });
        } catch {
            // Auditing must never change the decision.
        }
    }

    protected resolveCapabilities(agentId: string): QaapHarnessCapabilities {
        return resolveQaapHarnessCapabilities(agentId);
    }

    /** 401 unless the gate token header resolves to a live grant. Reads no other credential. */
    protected requireGrant(req: Request, res: Response): QaapToolGateTokenGrant | undefined {
        const grant = this.tokens.resolve(req.header(QAAP_TOOL_GATE_TOKEN_HEADER));
        if (!grant) {
            this.unauthorized(res);
            return undefined;
        }
        return grant;
    }

    protected unauthorized(res: Response): void {
        res.status(401).json({ error: 'Invalid or expired tool gate token' });
    }

    protected deny(source: 'policy' | 'gate-error', reason: string, retryable?: boolean): { decision: QaapToolGateDecision } {
        return { decision: { kind: 'deny', source, reason, ...(retryable ? { retryable } : {}) } };
    }

    protected rateLimited(taskId: string): boolean {
        const now = Date.now();
        // Drop the buckets of tasks that went quiet (finished or revoked), so the map cannot grow forever.
        for (const [id, times] of this.callTimes) {
            if (id !== taskId && !times.some(time => now - time < 60_000)) {
                this.callTimes.delete(id);
            }
        }
        const recent = (this.callTimes.get(taskId) ?? []).filter(time => now - time < 60_000);
        recent.push(now);
        this.callTimes.set(taskId, recent);
        return recent.length > QAAP_TOOL_GATE_MAX_CALLS_PER_MINUTE;
    }
}

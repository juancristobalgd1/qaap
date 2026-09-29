// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

// Glue between QaapAgentTaskRunner and QaapAgentHookService (SessionStart / UserPromptSubmit /
// PreToolUse / Stop). Kept out of the runner cluster files so the wiring there stays a few lines.

import * as fs from 'fs';
import * as path from 'path';
import type { QaapAgentTask, QaapAgentTaskState } from '../common/qaap-agent-task';
import { findQaiqDestructiveCommandGuardDenial } from '../common/qaap-agent-destructive-command-guard';
import { findQaiqDevServerGuardDenial } from '../common/qaap-agent-dev-server-guard';
import { resolveQaiqControlRequestAutoAction } from '../common/qaap-qaiq-control-auto-response';
import { buildQaiqControlResponseLine, type QaapQaiqPendingControlRequest } from '../common/qaap-qaiq-stdio-approvals';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import type { QaapAgentHookRunContext } from './qaap-agent-hook-service';

export function agentHookContextForTask(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask): QaapAgentHookRunContext {
    return {
        cwd: task.cwd,
        ...(task.ownerLogin ? { ownerLogin: task.ownerLogin } : {}),
        sessionId: ctx.conversationIdForTask?.(task.id) ?? task.id,
        taskId: task.id,
    };
}

/**
 * Runs SessionStart + UserPromptSubmit before the CLI is built. Returns the (possibly extended)
 * prompt, or `undefined` when the turn must not continue — then the task is already finished:
 * `failed` with the hook's stderr in its log when blocked, untouched when cancelled meanwhile.
 */
export async function applyPreTurnAgentHooks(
    ctx: QaapAgentTaskRunnerContext,
    task: QaapAgentTask,
    prompt: string,
    requestedAgent: string | undefined,
): Promise<string | undefined> {
    const hooks = ctx.agentHooks;
    if (!hooks || requestedAgent === 'shell') {
        return prompt;
    }
    let outcome: { readonly blockedReason?: string; readonly additionalContext?: string };
    try {
        outcome = await hooks.runPreTurn(agentHookContextForTask(ctx, task), prompt);
    } catch (error) {
        console.warn('[qaap-agent-hooks] pre-turn hooks failed:', error instanceof Error ? error.message : String(error));
        return prompt;
    }
    if (ctx.tasks.get(task.id)?.state !== 'running') {
        return undefined;
    }
    if (outcome.blockedReason !== undefined) {
        fs.mkdirSync(path.dirname(ctx.logPath(task.id)), { recursive: true });
        fs.writeFileSync(ctx.logPath(task.id), `Prompt blocked by a UserPromptSubmit hook: ${outcome.blockedReason}\n`, 'utf8');
        ctx.finishTask(task.id, 'failed', 1);
        return undefined;
    }
    return outcome.additionalContext
        ? `${prompt}\n\n<user-prompt-submit-hook>\n${outcome.additionalContext}\n</user-prompt-submit-hook>`
        : prompt;
}

/** Fire-and-forget Stop hook for a task that just left the running/queued state. */
export function fireStopAgentHook(ctx: QaapAgentTaskRunnerContext, task: QaapAgentTask, previousState: QaapAgentTaskState | undefined, state: QaapAgentTaskState): void {
    if (!ctx.agentHooks || previousState === undefined || previousState === state
        || (previousState !== 'running' && previousState !== 'queued')) {
        return;
    }
    try {
        ctx.agentHooks.fireStop(agentHookContextForTask(ctx, task), state, task.exitCode);
    } catch {
        // Hooks must never affect task completion.
    }
}

export interface QaiqPreToolUseHookGate {
    /** `true` when the request was taken over by PreToolUse hooks (the caller must skip it). */
    screen(request: QaapQaiqPendingControlRequest, line: string): boolean;
    /** The CLI withdrew a request while its hooks were still running. */
    cancel(requestId: string): void;
}

/**
 * PreToolUse for QAIQ stdio approvals. When hooks match, the control request is held while they
 * run: `deny` rejects with the hook's reason, `allow` approves (unless a Qaap safety guard would
 * deny, then normal handling applies), `ask` queues it for the user, and no decision re-feeds
 * the original line through the normal auto-approval path via `refeed`.
 */
export function createQaiqPreToolUseHookGate(
    ctx: QaapAgentTaskRunnerContext,
    task: QaapAgentTask,
    logStream: fs.WriteStream,
    refeed: (line: string) => void,
): QaiqPreToolUseHookGate {
    const screened = new Set<string>();
    const cancelled = new Set<string>();
    const record = (request: QaapQaiqPendingControlRequest, decision: 'approve' | 'reject' | 'queue'): void => {
        ctx.observability?.recordAgentToolCommand({
            taskId: task.id,
            tenantLogin: task.ownerLogin,
            agentId: task.agentId,
            requestId: request.requestId,
            toolUseId: request.toolUseId,
            toolName: request.toolName,
            command: typeof request.toolInput?.command === 'string' ? request.toolInput.command : undefined,
            decision,
        });
    };
    const respond = (request: QaapQaiqPendingControlRequest, action: 'approve' | 'reject', denyMessage?: string): void => {
        try {
            ctx.processes.get(task.id)?.stdin?.write(buildQaiqControlResponseLine(request, action, denyMessage ? { denyMessage } : {}));
        } catch {
            // stdin already closed — the turn is over anyway.
        }
    };
    return {
        screen(request, line): boolean {
            const hooks = ctx.agentHooks;
            const toolName = request.toolName;
            if (!hooks || !toolName || screened.has(request.requestId)) {
                return false;
            }
            const hookContext = agentHookContextForTask(ctx, task);
            if (!hooks.hasHooks(hookContext, 'PreToolUse', toolName)) {
                return false;
            }
            screened.add(request.requestId);
            const settle = (result: { readonly decision?: 'allow' | 'deny' | 'ask'; readonly reason?: string }): void => {
                if (cancelled.delete(request.requestId) || !ctx.processes.get(task.id) || ctx.tasks.get(task.id)?.state !== 'running') {
                    return;
                }
                if (result.decision === 'deny') {
                    const reason = result.reason ?? 'Denied by a PreToolUse hook.';
                    logStream.write(`\n[qaap] PreToolUse hook denied ${toolName}: ${reason}\n`);
                    record(request, 'reject');
                    respond(request, 'reject', `Blocked by a PreToolUse hook: ${reason}`);
                    return;
                }
                // A hook may approve, but never past a Qaap deny rule (core `--tools` allowlist, dev-server
                // guard): those requests fall through to the normal path, which rejects them with its message.
                const qaapDenies = resolveQaiqControlRequestAutoAction(task.command ?? '', task.autoApprove, request) === 'deny';
                if (result.decision === 'allow' && !qaapDenies
                    && !findQaiqDevServerGuardDenial(request) && !findQaiqDestructiveCommandGuardDenial(request)) {
                    record(request, 'approve');
                    respond(request, 'approve');
                    return;
                }
                if (result.decision === 'ask') {
                    record(request, 'queue');
                    const pending = ctx.pendingQaiqControlRequests.get(task.id) ?? [];
                    pending.push(request);
                    ctx.pendingQaiqControlRequests.set(task.id, pending);
                    if (task.autoApprove !== false) {
                        ctx.scheduleQueuedApprovalTimeout(task.id, request, logStream);
                    }
                    return;
                }
                refeed(line);
            };
            hooks.evaluatePreToolUse(hookContext, toolName, request.toolInput, request.toolUseId)
                .then(settle, () => settle({}));
            return true;
        },
        cancel(requestId): void {
            if (screened.has(requestId)) {
                cancelled.add(requestId);
            }
        },
    };
}

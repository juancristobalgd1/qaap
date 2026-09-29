// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import * as path from 'path';
import {
    QAAP_WORKSPACE_HOOKS_RELATIVE_PATH,
    flattenQaapAgentHookDeclaration,
    interpretQaapAgentHookResult,
    selectQaapAgentHookCommands,
    type QaapAgentHookCommand,
    type QaapAgentHookEventName,
    type QaapAgentHookPermissionDecision,
    type QaapAgentHookSource,
    type QaapAgentHooksStatusResponse,
    type QaapAgentHookTrustResponse,
    type QaapAgentHookWarning,
    type QaapAgentPendingWorkspaceHooks,
    type QaapAgentWorkspaceHooksStatus,
    type QaapAgentWorkspaceHookTrustState,
} from '../common/qaap-agent-hooks';
import { QaapAgentHookConfigLoader, type QaapLoadedUserHooks, type QaapLoadedWorkspaceHooks } from './qaap-agent-hook-config-loader';
import { QaapAgentHookProcessRunner } from './qaap-agent-hook-process-runner';
import { QaapAgentHookTrustStore } from './qaap-agent-hook-trust-store';

/** Where a hook fires: the turn's workspace, owner and conversation. */
export interface QaapAgentHookRunContext {
    readonly cwd: string;
    readonly ownerLogin?: string;
    /** Conversation id when known, else the task id. */
    readonly sessionId: string;
    readonly taskId?: string;
}

export interface QaapAgentHookAggregateResult {
    readonly blocked: boolean;
    readonly reason?: string;
    readonly additionalContext?: string;
    readonly permissionDecision?: QaapAgentHookPermissionDecision;
    readonly ranCount: number;
}

interface QaapResolvedAgentHooks {
    readonly user: QaapLoadedUserHooks;
    readonly workspace?: QaapLoadedWorkspaceHooks;
    readonly workspaceState: QaapAgentWorkspaceHookTrustState;
}

interface QaapSelectedAgentHook {
    readonly source: QaapAgentHookSource;
    readonly hook: QaapAgentHookCommand;
}

const CONFIG_CACHE_TTL_MS = 3_000;
const MAX_WARNINGS_PER_WORKSPACE = 20;
const MAX_TRACKED_SESSIONS = 5_000;
const MAX_PENDING_WORKSPACES = 200;

/**
 * Product-level lifecycle hooks around agent turns, independent of the CLI (codex, claude, qaiq…).
 * User hooks (settings key `qaap.agentHooks`) always run; workspace hooks (`.qaap/hooks.json`) run
 * only after the owner trusted the exact declaration digest. Hook failures never fail a turn: they
 * are logged and kept as warnings the Work Hub can show.
 */
@injectable()
export class QaapAgentHookService {

    @inject(QaapAgentHookConfigLoader)
    protected readonly loader: QaapAgentHookConfigLoader;

    @inject(QaapAgentHookTrustStore)
    protected readonly trustStore: QaapAgentHookTrustStore;

    @inject(QaapAgentHookProcessRunner)
    protected readonly processRunner: QaapAgentHookProcessRunner;

    protected readonly onDidWarnEmitter = new Emitter<QaapAgentHookWarning & { readonly cwd: string; readonly ownerLogin?: string }>();
    readonly onDidWarn: Event<QaapAgentHookWarning & { readonly cwd: string; readonly ownerLogin?: string }> = this.onDidWarnEmitter.event;

    protected readonly warnings = new Map<string, QaapAgentHookWarning[]>();
    protected readonly startedSessions = new Set<string>();
    protected readonly announcedPending = new Set<string>();
    protected readonly configCache = new Map<string, { readonly at: number; readonly resolved: QaapResolvedAgentHooks }>();
    /** Keyed by owner + workspace root; see {@link listPending}. */
    protected readonly pendingWorkspaces = new Map<string, { readonly ownerLogin: string; readonly root: string; readonly cwd: string }>();

    // ---- configuration & trust -------------------------------------------------------------

    protected resolve(cwd: string, ownerLogin: string | undefined): QaapResolvedAgentHooks {
        const cacheKey = `${ownerLogin ?? ''}\u0000${cwd}`;
        const cached = this.configCache.get(cacheKey);
        const now = Date.now();
        if (cached && now - cached.at < CONFIG_CACHE_TTL_MS) {
            return cached.resolved;
        }
        const user = this.loader.loadUser(ownerLogin, cwd);
        const workspace = this.loader.loadWorkspace(cwd);
        let workspaceState: QaapAgentWorkspaceHookTrustState = 'none';
        if (workspace?.digest) {
            workspaceState = this.trustStore.decisionFor(ownerLogin, workspace.root, workspace.digest) ?? 'pending';
        }
        const resolved: QaapResolvedAgentHooks = { user, workspace, workspaceState };
        this.configCache.set(cacheKey, { at: now, resolved });
        if (this.configCache.size > 500) {
            this.configCache.delete(this.configCache.keys().next().value!);
        }
        return resolved;
    }

    protected invalidateCache(): void {
        this.configCache.clear();
    }

    status(cwd: string, ownerLogin: string | undefined): QaapAgentHooksStatusResponse {
        this.invalidateCache();
        const resolved = this.resolve(cwd, ownerLogin);
        return {
            workspace: this.workspaceStatus(resolved),
            user: { hooks: flattenQaapAgentHookDeclaration(resolved.user.declaration), errors: resolved.user.errors },
            warnings: [...(this.warnings.get(this.warningKey(cwd, ownerLogin, resolved)) ?? [])],
        };
    }

    trust(cwd: string, ownerLogin: string | undefined, digest: string): QaapAgentHookTrustResponse {
        return this.decide(cwd, ownerLogin, digest, 'trusted');
    }

    ignore(cwd: string, ownerLogin: string | undefined, digest: string): QaapAgentHookTrustResponse {
        return this.decide(cwd, ownerLogin, digest, 'ignored');
    }

    revoke(cwd: string, ownerLogin: string | undefined): QaapAgentHookTrustResponse {
        this.invalidateCache();
        const workspace = this.loader.loadWorkspace(cwd);
        if (!workspace) {
            return { ok: false, error: 'No workspace hooks declaration found.' };
        }
        this.trustStore.revoke(ownerLogin, workspace.root);
        this.invalidateCache();
        return { ok: true, status: this.workspaceStatus(this.resolve(cwd, ownerLogin)) };
    }

    /**
     * Workspaces whose hooks agent turns of `ownerLogin` skipped because they await review — any project
     * the agents ran in, not only the IDE root the frontend has open. Entries that are no longer pending
     * (trusted, ignored, file removed) are dropped.
     */
    listPending(ownerLogin: string | undefined): QaapAgentPendingWorkspaceHooks[] {
        this.invalidateCache();
        const pending: QaapAgentPendingWorkspaceHooks[] = [];
        for (const [key, entry] of this.pendingWorkspaces) {
            if (entry.ownerLogin !== (ownerLogin ?? '')) {
                continue;
            }
            let status: QaapAgentWorkspaceHooksStatus;
            try {
                status = this.workspaceStatus(this.resolve(entry.cwd, ownerLogin));
            } catch {
                continue;
            }
            if (status.state === 'pending' && status.root === entry.root) {
                pending.push({ ...status, cwd: entry.cwd });
            } else {
                this.pendingWorkspaces.delete(key);
            }
        }
        return pending;
    }

    protected rememberPendingWorkspace(context: QaapAgentHookRunContext, root: string): void {
        const ownerLogin = context.ownerLogin ?? '';
        const key = `${ownerLogin}\u0000${root}`;
        // Re-insert so the map keeps the most recently seen workspaces when it is trimmed.
        this.pendingWorkspaces.delete(key);
        this.pendingWorkspaces.set(key, { ownerLogin, root, cwd: context.cwd });
        if (this.pendingWorkspaces.size > MAX_PENDING_WORKSPACES) {
            this.pendingWorkspaces.delete(this.pendingWorkspaces.keys().next().value!);
        }
    }

    protected decide(cwd: string, ownerLogin: string | undefined, digest: string, decision: 'trusted' | 'ignored'): QaapAgentHookTrustResponse {
        this.invalidateCache();
        const workspace = this.loader.loadWorkspace(cwd);
        if (!workspace?.digest) {
            return { ok: false, error: 'No workspace hooks declaration found.' };
        }
        // The review is bound to what the user saw: a file edited after the listing needs a new review.
        if (workspace.digest !== digest) {
            return { ok: false, error: 'The hooks declaration changed since it was reviewed. Review it again.' };
        }
        this.trustStore.record(ownerLogin, workspace.root, digest, decision);
        this.invalidateCache();
        return { ok: true, status: this.workspaceStatus(this.resolve(cwd, ownerLogin)) };
    }

    protected workspaceStatus(resolved: QaapResolvedAgentHooks): QaapAgentWorkspaceHooksStatus {
        const workspace = resolved.workspace;
        return {
            state: resolved.workspaceState,
            ...(workspace ? { root: workspace.root } : {}),
            ...(workspace?.digest ? { digest: workspace.digest } : {}),
            hooks: workspace ? flattenQaapAgentHookDeclaration(workspace.declaration) : [],
            ...(workspace?.coveredFiles?.length ? { coveredFiles: workspace.coveredFiles } : {}),
            errors: workspace?.errors ?? [],
        };
    }

    // ---- selection & execution --------------------------------------------------------------

    protected select(context: QaapAgentHookRunContext, event: QaapAgentHookEventName, matchValue?: string): QaapSelectedAgentHook[] {
        let resolved: QaapResolvedAgentHooks;
        try {
            resolved = this.resolve(context.cwd, context.ownerLogin);
        } catch (error) {
            console.warn('[qaap-agent-hooks] failed to load hook configuration:', this.errorMessage(error));
            return [];
        }
        const selected: QaapSelectedAgentHook[] = selectQaapAgentHookCommands(resolved.user.declaration, event, matchValue)
            .map(hook => ({ source: 'user' as const, hook }));
        const workspace = resolved.workspace;
        if (workspace?.digest) {
            const workspaceHooks = selectQaapAgentHookCommands(workspace.declaration, event, matchValue);
            if (resolved.workspaceState === 'pending') {
                // Any turn in this workspace (whatever event) surfaces it for review in the frontend.
                this.rememberPendingWorkspace(context, workspace.root);
            }
            if (resolved.workspaceState === 'trusted') {
                selected.push(...workspaceHooks.map(hook => ({ source: 'workspace' as const, hook })));
            } else if (resolved.workspaceState === 'pending' && workspaceHooks.length > 0) {
                const announceKey = `${context.ownerLogin ?? ''}\u0000${workspace.root}\u0000${workspace.digest}`;
                if (!this.announcedPending.has(announceKey)) {
                    this.announcedPending.add(announceKey);
                    this.warn(context, resolved, {
                        source: 'workspace',
                        event,
                        message: `Workspace hooks in ${QAAP_WORKSPACE_HOOKS_RELATIVE_PATH} are waiting for review and did not run.`,
                    });
                }
            }
        }
        return selected;
    }

    hasHooks(context: Pick<QaapAgentHookRunContext, 'cwd' | 'ownerLogin'>, event: QaapAgentHookEventName, matchValue?: string): boolean {
        try {
            const resolved = this.resolve(context.cwd, context.ownerLogin);
            if (selectQaapAgentHookCommands(resolved.user.declaration, event, matchValue).length > 0) {
                return true;
            }
            return resolved.workspaceState === 'trusted' && !!resolved.workspace
                && selectQaapAgentHookCommands(resolved.workspace.declaration, event, matchValue).length > 0;
        } catch {
            return false;
        }
    }

    /** Runs every matching hook for `event` in parallel and folds their results. Never rejects. */
    async run(
        context: QaapAgentHookRunContext,
        event: QaapAgentHookEventName,
        payload: Record<string, unknown>,
        matchValue?: string,
    ): Promise<QaapAgentHookAggregateResult> {
        const selected = this.select(context, event, matchValue);
        if (selected.length === 0) {
            return { blocked: false, ranCount: 0 };
        }
        const resolved = this.resolve(context.cwd, context.ownerLogin);
        const projectDir = resolved.workspace?.root ?? context.cwd;
        const input = {
            session_id: context.sessionId,
            cwd: context.cwd,
            hook_event_name: event,
            ...payload,
            ...(context.taskId ? { qaap_task_id: context.taskId } : {}),
        };
        const results = await Promise.all(selected.map(async ({ source, hook }) => {
            try {
                const result = await this.processRunner.run(hook.command, {
                    cwd: context.cwd,
                    input,
                    timeoutMs: hook.timeoutSec * 1000,
                    ...(context.ownerLogin ? { ownerLogin: context.ownerLogin } : {}),
                    env: {
                        CLAUDE_PROJECT_DIR: projectDir,
                        QAAP_PROJECT_DIR: projectDir,
                        QAAP_HOOK_EVENT: event,
                        QAAP_HOOK_SOURCE: source,
                    },
                });
                const interpretation = interpretQaapAgentHookResult(event, result);
                if (interpretation.outcome === 'error') {
                    this.warn(context, resolved, {
                        source,
                        event,
                        command: hook.command,
                        message: interpretation.reason ?? 'Hook failed.',
                    });
                }
                return interpretation;
            } catch (error) {
                this.warn(context, resolved, { source, event, command: hook.command, message: this.errorMessage(error) });
                return { outcome: 'error' as const };
            }
        }));
        const blockReasons = results.filter(result => result.outcome === 'block').map(result => result.reason ?? '');
        const contexts = results.map(result => result.additionalContext).filter((value): value is string => !!value);
        const decisions = results.map(result => result.permissionDecision);
        const permissionDecision = decisions.includes('deny') ? 'deny'
            : decisions.includes('ask') ? 'ask'
                : decisions.includes('allow') ? 'allow'
                    : undefined;
        const allowReason = results.find(result => result.permissionDecision === permissionDecision && result.reason)?.reason;
        return {
            blocked: blockReasons.length > 0,
            ...(blockReasons.length > 0
                ? { reason: blockReasons.filter(Boolean).join('\n') || 'Blocked by hook.' }
                : allowReason ? { reason: allowReason } : {}),
            ...(contexts.length > 0 ? { additionalContext: contexts.join('\n\n') } : {}),
            ...(permissionDecision ? { permissionDecision } : {}),
            ranCount: selected.length,
        };
    }

    // ---- lifecycle entry points ---------------------------------------------------------------

    /**
     * SessionStart (first turn this backend sees for the session) then UserPromptSubmit.
     * Returns a block reason (exit 2) or extra context to append to the prompt.
     */
    async runPreTurn(context: QaapAgentHookRunContext, prompt: string): Promise<{ readonly blockedReason?: string; readonly additionalContext?: string }> {
        const contexts: string[] = [];
        if (!this.startedSessions.has(context.sessionId)) {
            this.rememberSession(context.sessionId);
            const sessionStart = await this.run(context, 'SessionStart', { source: 'startup' }, 'startup');
            if (sessionStart.additionalContext) {
                contexts.push(sessionStart.additionalContext);
            }
        }
        const submit = await this.run(context, 'UserPromptSubmit', { prompt });
        if (submit.blocked) {
            return { blockedReason: submit.reason ?? 'Prompt blocked by hook.' };
        }
        if (submit.additionalContext) {
            contexts.push(submit.additionalContext);
        }
        return contexts.length > 0 ? { additionalContext: contexts.join('\n\n') } : {};
    }

    async evaluatePreToolUse(
        context: QaapAgentHookRunContext,
        toolName: string,
        toolInput: Record<string, unknown> | undefined,
        toolUseId?: string,
    ): Promise<{ readonly decision?: QaapAgentHookPermissionDecision; readonly reason?: string }> {
        const result = await this.run(context, 'PreToolUse', {
            tool_name: toolName,
            tool_input: toolInput ?? {},
            ...(toolUseId ? { tool_use_id: toolUseId } : {}),
        }, toolName);
        if (result.blocked) {
            return { decision: 'deny', reason: result.reason };
        }
        return {
            ...(result.permissionDecision ? { decision: result.permissionDecision } : {}),
            ...(result.reason ? { reason: result.reason } : {}),
        };
    }

    /** Fire-and-forget notification after a tool finished. */
    firePostToolUse(context: QaapAgentHookRunContext, toolName: string, toolInput: unknown, toolResponse: unknown, toolUseId?: string): void {
        this.run(context, 'PostToolUse', {
            tool_name: toolName,
            tool_input: toolInput ?? {},
            tool_response: toolResponse ?? {},
            ...(toolUseId ? { tool_use_id: toolUseId } : {}),
        }, toolName).catch(() => undefined);
    }

    /** Fire-and-forget notification when a turn finished. */
    fireStop(context: QaapAgentHookRunContext, state: string, exitCode: number | undefined): void {
        this.run(context, 'Stop', {
            stop_hook_active: false,
            qaap_turn_state: state,
            ...(exitCode !== undefined ? { qaap_exit_code: exitCode } : {}),
        }).catch(() => undefined);
    }

    // ---- warnings -----------------------------------------------------------------------------

    protected warn(
        context: QaapAgentHookRunContext,
        resolved: QaapResolvedAgentHooks,
        warning: Omit<QaapAgentHookWarning, 'at'>,
    ): void {
        const entry: QaapAgentHookWarning = { at: Date.now(), ...warning };
        console.warn(`[qaap-agent-hooks] ${entry.event}${entry.command ? ` (${entry.command})` : ''}: ${entry.message}`);
        const key = this.warningKey(context.cwd, context.ownerLogin, resolved);
        const list = this.warnings.get(key) ?? [];
        list.push(entry);
        if (list.length > MAX_WARNINGS_PER_WORKSPACE) {
            list.splice(0, list.length - MAX_WARNINGS_PER_WORKSPACE);
        }
        this.warnings.set(key, list);
        this.onDidWarnEmitter.fire({ ...entry, cwd: context.cwd, ...(context.ownerLogin ? { ownerLogin: context.ownerLogin } : {}) });
    }

    protected warningKey(cwd: string, ownerLogin: string | undefined, resolved: QaapResolvedAgentHooks): string {
        return `${ownerLogin ?? ''}\u0000${resolved.workspace?.root ?? path.resolve(cwd)}`;
    }

    protected rememberSession(sessionId: string): void {
        this.startedSessions.add(sessionId);
        if (this.startedSessions.size > MAX_TRACKED_SESSIONS) {
            this.startedSessions.delete(this.startedSessions.values().next().value!);
        }
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

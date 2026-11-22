// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createHash, randomBytes } from 'crypto';
import { injectable } from '@theia/core/shared/inversify';
import { QAAP_AGENT_DELEGATION_MAX_DEPTH } from '../common/qaap-agent-delegation-protocol';

/**
 * What a token may authenticate. Every token holds `gate`. `delegate` additionally opens the
 * agent-delegation routes, and is granted only to tasks that may delegate (parents at depth 0).
 */
export type QaapToolGateTokenScope = 'gate' | 'delegate';

/** What a gate token stands for. The server reads it from here, never from a request body. */
export interface QaapToolGateTokenGrant {
    readonly taskId: string;
    readonly owner: string | undefined;
    /**
     * Workspace the task runs in. The gate checks only that the request `cwd` lies inside it; validating
     * paths inside the tool input (file arguments, shell words) is future work.
     */
    readonly workspace: string;
    /**
     * Set for the grant of a one-shot agent call (prompt improve, goal-loop evaluator): it has no running
     * task behind it, is read-only, and lives only as long as its process.
     */
    readonly oneShot?: { readonly agentId: string };
}

/** Hard ceiling on a token's life even if the task end is never reported. */
export const QAAP_TOOL_GATE_TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Hard ceiling for a one-shot grant, which should be revoked with its process long before this. */
export const QAAP_TOOL_GATE_ONE_SHOT_MAX_AGE_MS = 30 * 60 * 1000;

/** A grant plus the scopes it holds; returned by {@link QaapToolGateTokenService.authorize}. */
export interface QaapToolGateScopedGrant extends QaapToolGateTokenGrant {
    readonly scopes: readonly QaapToolGateTokenScope[];
    /** Per-task name of the delegation MCP server, on a delegation grant. */
    readonly mcpServerName?: string;
}

/** A delegation credential: its own token (scope `delegate` only) and the task's MCP server name. */
export interface QaapDelegationGrantIssued {
    readonly token: string;
    readonly mcpServerName: string;
}

/** Why {@link QaapToolGateTokenService.authorize} refused: unknown/revoked/expired, missing scope, other tenant. */
export type QaapToolGateAuthorizeFailure = 'invalid' | 'scope' | 'owner';

export type QaapToolGateAuthorizeResult =
    | { readonly ok: true; readonly grant: QaapToolGateScopedGrant }
    | { readonly ok: false; readonly reason: QaapToolGateAuthorizeFailure };

interface StoredGrant extends QaapToolGateTokenGrant {
    readonly expiresAt: number;
    readonly scopes: readonly QaapToolGateTokenScope[];
    readonly mcpServerName?: string;
}

/**
 * Per-task credential for the harness-facing tool gate. Tokens are random, live only in memory
 * (never persisted, never logged), are keyed by their SHA-256 so a heap or log dump of the map does
 * not leak usable tokens, and stop resolving once the task is revoked or the max age passes.
 */
@injectable()
export class QaapToolGateTokenService {

    protected readonly grants = new Map<string, StoredGrant>();
    protected readonly tokenHashByTask = new Map<string, string>();
    /** The separate delegation token of a task (scope `delegate` only), by task id. */
    protected readonly delegationHashByTask = new Map<string, string>();
    /** Tasks whose harness plugin reported in (`/arm`): the gate is really in the loop for them. */
    protected readonly armedTasks = new Set<string>();
    /** SHA-256 of the one-time nonce `/arm` requires, per task. Removed when used or when the task is revoked. */
    protected readonly armNonceHashByTask = new Map<string, string>();

    /**
     * Issue (or replace) the token for a task. Returns the secret exactly once. It holds only the `gate` scope:
     * the `delegate` scope lives in a separate token ({@link issueDelegation}).
     */
    issue(taskId: string, owner: string | undefined, workspace: string): string {
        // Replaces the gate token only; the task's separate delegation token (if any) stays valid.
        const delegationHash = this.delegationHashByTask.get(taskId);
        this.delegationHashByTask.delete(taskId);
        this.revoke(taskId);
        if (delegationHash && this.grants.has(delegationHash)) {
            this.delegationHashByTask.set(taskId, delegationHash);
        }
        const token = randomBytes(32).toString('hex');
        const hash = this.hash(token);
        this.grants.set(hash, { taskId, owner, workspace, scopes: ['gate'], expiresAt: this.now() + QAAP_TOOL_GATE_TOKEN_MAX_AGE_MS });
        this.tokenHashByTask.set(taskId, hash);
        return token;
    }

    /**
     * Issues (or replaces) the task's DELEGATION token: a second secret holding only the `delegate` scope, so the
     * gate token the harness and its tools carry cannot create children. It names the task's random MCP server,
     * against which the auto-allow compares tool names. Refused (undefined) for depth ≥ max: children never delegate.
     */
    issueDelegation(taskId: string, owner: string | undefined, workspace: string, delegationDepth: number = 0): QaapDelegationGrantIssued | undefined {
        if (!Number.isInteger(delegationDepth) || delegationDepth < 0 || delegationDepth >= QAAP_AGENT_DELEGATION_MAX_DEPTH) {
            return undefined;
        }
        this.revokeDelegation(taskId);
        const token = randomBytes(32).toString('hex');
        const hash = this.hash(token);
        const mcpServerName = `qaaq_${randomBytes(8).toString('hex')}`;
        this.grants.set(hash, { taskId, owner, workspace, scopes: ['delegate'], mcpServerName, expiresAt: this.now() + QAAP_TOOL_GATE_TOKEN_MAX_AGE_MS });
        this.delegationHashByTask.set(taskId, hash);
        return { token, mcpServerName };
    }

    /** The MCP server name of the task's live delegation grant, if any. */
    delegationServerName(taskId: string): string | undefined {
        const hash = this.delegationHashByTask.get(taskId);
        const grant = hash ? this.grants.get(hash) : undefined;
        return grant && grant.expiresAt > this.now() ? grant.mcpServerName : undefined;
    }

    /**
     * Ephemeral read-only grant for a one-shot agent call that is not a task. Returns the secret and a
     * `release` that revokes it (call it when the process ends); it also expires after 30 minutes.
     */
    issueOneShot(agentId: string, owner: string | undefined, workspace: string): { readonly token: string; readonly release: () => void } {
        const taskId = `one-shot:${randomBytes(8).toString('hex')}`;
        const token = randomBytes(32).toString('hex');
        const hash = this.hash(token);
        this.grants.set(hash, { taskId, owner, workspace, oneShot: { agentId }, scopes: ['gate'], expiresAt: this.now() + QAAP_TOOL_GATE_ONE_SHOT_MAX_AGE_MS });
        this.tokenHashByTask.set(taskId, hash);
        return { token, release: () => this.revoke(taskId) };
    }

    /**
     * The grant behind a presented token, or `undefined` when unknown, revoked or expired. This is the
     * tool gate's check: every token holds `gate`, so its result does not depend on scopes.
     */
    resolve(token: string | undefined): QaapToolGateTokenGrant | undefined {
        const grant = this.liveGrant(token);
        // A delegation-only token never authenticates the gate.
        if (!grant || !grant.scopes.includes('gate')) {
            return undefined;
        }
        return { taskId: grant.taskId, owner: grant.owner, workspace: grant.workspace, ...(grant.oneShot ? { oneShot: grant.oneShot } : {}) };
    }

    /**
     * Authenticates `token` for `scope`. The caller derives the task, owner and workspace from the returned
     * grant, never from its request. When `options` is given, the grant must also belong to
     * `options.expectedOwner` (the tenant this backend serves, or the authenticated user), so a token issued
     * for one tenant is refused by another. Logins compare trimmed and case-insensitively (GitHub logins are).
     */
    authorize(
        token: string | undefined,
        scope: QaapToolGateTokenScope,
        options?: { readonly expectedOwner: string | undefined },
    ): QaapToolGateAuthorizeResult {
        const grant = this.liveGrant(token);
        if (!grant) {
            return { ok: false, reason: 'invalid' };
        }
        if (options && this.normalizeOwner(grant.owner) !== this.normalizeOwner(options.expectedOwner)) {
            return { ok: false, reason: 'owner' };
        }
        if (!grant.scopes.includes(scope)) {
            return { ok: false, reason: 'scope' };
        }
        return {
            ok: true,
            grant: {
                taskId: grant.taskId,
                owner: grant.owner,
                workspace: grant.workspace,
                scopes: [...grant.scopes],
                ...(grant.mcpServerName ? { mcpServerName: grant.mcpServerName } : {}),
                ...(grant.oneShot ? { oneShot: grant.oneShot } : {}),
            },
        };
    }

    /** Whether the live token for `taskId` holds `scope` (false when the task has no live token). */
    hasScope(taskId: string, scope: QaapToolGateTokenScope): boolean {
        return [this.tokenHashByTask.get(taskId), this.delegationHashByTask.get(taskId)].some(hash => {
            const grant = hash ? this.grants.get(hash) : undefined;
            return !!grant && grant.expiresAt > this.now() && grant.scopes.includes(scope);
        });
    }

    /** The stored grant behind `token` if it is live; drops it when expired. */
    protected liveGrant(token: string | undefined): StoredGrant | undefined {
        if (!token) {
            return undefined;
        }
        const hash = this.hash(token);
        const grant = this.grants.get(hash);
        if (!grant) {
            return undefined;
        }
        if (grant.expiresAt <= this.now()) {
            this.grants.delete(hash);
            if (this.tokenHashByTask.get(grant.taskId) === hash) {
                this.tokenHashByTask.delete(grant.taskId);
            }
            if (this.delegationHashByTask.get(grant.taskId) === hash) {
                this.delegationHashByTask.delete(grant.taskId);
            }
            return undefined;
        }
        return grant;
    }

    /**
     * Issues the one-time nonce that `/arm` demands next to the token. The agent inherits the token, so the
     * token alone must not be able to claim "the plugin is running": the plugin takes the nonce from its env
     * and removes it from `process.env` on load, so tool subprocesses do not see it.
     */
    issueArmNonce(taskId: string): string | undefined {
        if (!this.tokenHashByTask.has(taskId)) {
            return undefined;
        }
        const nonce = randomBytes(16).toString('hex');
        this.armNonceHashByTask.set(taskId, this.hash(nonce));
        return nonce;
    }

    /** Marks the task armed if `nonce` is the live one-time nonce. A nonce works once. */
    arm(taskId: string, nonce: string | undefined): boolean {
        const expected = this.armNonceHashByTask.get(taskId);
        if (!nonce || !expected || !this.tokenHashByTask.has(taskId) || this.hash(nonce) !== expected) {
            return false;
        }
        this.armNonceHashByTask.delete(taskId);
        this.armedTasks.add(taskId);
        return true;
    }

    isArmed(taskId: string): boolean {
        return this.armedTasks.has(taskId);
    }

    /** Called when the task completes, fails or is cancelled. Idempotent. */
    revoke(taskId: string): void {
        this.armedTasks.delete(taskId);
        this.armNonceHashByTask.delete(taskId);
        const hash = this.tokenHashByTask.get(taskId);
        if (hash) {
            this.grants.delete(hash);
            this.tokenHashByTask.delete(taskId);
        }
        this.revokeDelegation(taskId);
    }

    protected revokeDelegation(taskId: string): void {
        const hash = this.delegationHashByTask.get(taskId);
        if (hash) {
            this.grants.delete(hash);
            this.delegationHashByTask.delete(taskId);
        }
    }

    protected normalizeOwner(owner: string | undefined): string {
        return owner?.trim().toLowerCase() ?? '';
    }

    protected now(): number {
        return Date.now();
    }

    protected hash(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }
}

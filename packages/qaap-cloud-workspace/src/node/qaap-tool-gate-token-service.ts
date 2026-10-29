// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { createHash, randomBytes } from 'crypto';
import { injectable } from '@theia/core/shared/inversify';

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

interface StoredGrant extends QaapToolGateTokenGrant {
    readonly expiresAt: number;
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

    /** Issue (or replace) the token for a task. Returns the secret exactly once. */
    issue(taskId: string, owner: string | undefined, workspace: string): string {
        this.revoke(taskId);
        const token = randomBytes(32).toString('hex');
        const hash = this.hash(token);
        this.grants.set(hash, { taskId, owner, workspace, expiresAt: this.now() + QAAP_TOOL_GATE_TOKEN_MAX_AGE_MS });
        this.tokenHashByTask.set(taskId, hash);
        return token;
    }

    /**
     * Ephemeral read-only grant for a one-shot agent call that is not a task. Returns the secret and a
     * `release` that revokes it (call it when the process ends); it also expires after 30 minutes.
     */
    issueOneShot(agentId: string, owner: string | undefined, workspace: string): { readonly token: string; readonly release: () => void } {
        const taskId = `one-shot:${randomBytes(8).toString('hex')}`;
        const token = randomBytes(32).toString('hex');
        const hash = this.hash(token);
        this.grants.set(hash, { taskId, owner, workspace, oneShot: { agentId }, expiresAt: this.now() + QAAP_TOOL_GATE_ONE_SHOT_MAX_AGE_MS });
        this.tokenHashByTask.set(taskId, hash);
        return { token, release: () => this.revoke(taskId) };
    }

    /** The grant behind a presented token, or `undefined` when unknown, revoked or expired. */
    resolve(token: string | undefined): QaapToolGateTokenGrant | undefined {
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
            this.tokenHashByTask.delete(grant.taskId);
            return undefined;
        }
        return { taskId: grant.taskId, owner: grant.owner, workspace: grant.workspace, ...(grant.oneShot ? { oneShot: grant.oneShot } : {}) };
    }

    /** Called when the task completes, fails or is cancelled. Idempotent. */
    revoke(taskId: string): void {
        const hash = this.tokenHashByTask.get(taskId);
        if (hash) {
            this.grants.delete(hash);
            this.tokenHashByTask.delete(taskId);
        }
    }

    protected now(): number {
        return Date.now();
    }

    protected hash(token: string): string {
        return createHash('sha256').update(token).digest('hex');
    }
}

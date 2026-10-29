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
    /** Workspace the task runs in; tool calls must target a path inside it. */
    readonly workspace: string;
}

/** Hard ceiling on a token's life even if the task end is never reported. */
export const QAAP_TOOL_GATE_TOKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

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
        return { taskId: grant.taskId, owner: grant.owner, workspace: grant.workspace };
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

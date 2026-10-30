// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as crypto from 'crypto';

/**
 * Control-plane ↔ tenant-backend contract for broker-mode sandboxes (doc/qaap-task-sandbox.md).
 *
 * A tenant backend has no Docker socket and no route to the control plane (internal bridge plus
 * the host loopback guard). The channel therefore runs the other way: the control plane opens a
 * long-lived "link" to each tenant backend through the same ingress relay it already uses for the
 * busy probe, and the tenant backend pushes sandbox requests down that stream as NDJSON. Replies
 * come back as separate POSTs. Both directions are authenticated with the tenant-scoped
 * `QAAP_TENANT_BACKEND_SECRET` (HMAC-SHA256): the link and replies with a short-lived probe, every
 * request with its own signature over the tenant login, id, time, op and arguments.
 */

export const QAAP_TASK_SANDBOX_LINK_PATH = '/task-sandbox/link';
export const QAAP_TASK_SANDBOX_REPLY_PATH = '/task-sandbox/reply';
export const QAAP_TASK_SANDBOX_LINK_HEADER = 'x-qaap-sandbox-link';

const MAX_AGE_MS = 60_000;
const MIN_SECRET_LENGTH = 32;

export type QaapTaskSandboxBrokerOp = 'create' | 'destroy' | 'list';

/** Fields of the repo's devcontainer that the broker honours (read by the tenant backend, validated by the broker). */
export interface QaapTaskSandboxBrokerDevcontainer {
    readonly image?: string;
    readonly containerEnv?: Readonly<Record<string, string>>;
}

export interface QaapTaskSandboxBrokerCreateArgs {
    /** Worktree root as the tenant backend sees it (e.g. `/tmp/qaap-worktrees/<login>/…`). */
    readonly root: string;
    readonly devcontainer?: QaapTaskSandboxBrokerDevcontainer;
    /** HOME entries to recreate inside the sandbox: `{ name: '.claude', target: '/home/theia/.qaap/…' }`. */
    readonly homeLinks?: ReadonlyArray<{ readonly name: string; readonly target: string }>;
}

export interface QaapTaskSandboxBrokerSandbox {
    readonly name: string;
    readonly root: string;
    /** Exec server endpoint on the tenant network (the container name resolves by Docker DNS). */
    readonly host: string;
    readonly port: number;
    readonly token: string;
    readonly image: string;
    readonly imageKind: 'base' | 'image';
    readonly startupMs: number;
    readonly created: boolean;
    /**
     * The tenant backend's address on the tenant INTERNAL network (where the sandbox also lives), so
     * the sandbox can reach the tool gate without going through loopback or the egress proxy. Absent
     * when the backend has no address there: callers must then fail closed, not fall back to loopback.
     */
    readonly backendHost?: string;
}

export interface QaapTaskSandboxBrokerDestroyArgs {
    readonly name: string;
    readonly mode?: 'destroy' | 'archive';
}

export interface QaapTaskSandboxBrokerListed {
    readonly name: string;
    readonly root: string;
    readonly running: boolean;
    readonly archived: boolean;
}

export interface QaapTaskSandboxBrokerRequest {
    readonly type: 'request';
    readonly id: string;
    readonly op: QaapTaskSandboxBrokerOp;
    readonly args: unknown;
    readonly issuedAt: number;
    readonly signature: string;
}

export interface QaapTaskSandboxBrokerReply {
    readonly id: string;
    readonly ok: boolean;
    readonly result?: unknown;
    readonly error?: string;
}

export namespace QaapTaskSandboxBrokerAuth {

    function usable(secret: string | undefined): secret is string {
        return !!secret && secret.trim().length >= MIN_SECRET_LENGTH;
    }

    function hmac(secret: string, input: string): string {
        return crypto.createHmac('sha256', secret).update(input).digest('base64url');
    }

    function equal(left: string, right: string): boolean {
        const a = Buffer.from(left);
        const b = Buffer.from(right);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    function fresh(issuedAt: number, now: number): boolean {
        return Number.isSafeInteger(issuedAt) && Math.abs(now - issuedAt) <= MAX_AGE_MS;
    }

    function requestInput(tenantLogin: string, id: string, issuedAt: number, op: string, args: unknown): string {
        const digest = crypto.createHash('sha256').update(JSON.stringify(args ?? null)).digest('hex');
        return `sandbox-rpc\u0000${tenantLogin.trim().toLowerCase()}\u0000${id}\u0000${issuedAt}\u0000${op}\u0000${digest}`;
    }

    /** Control plane → tenant backend: proves the caller holds this tenant's secret (link + replies). */
    export function createLinkProbe(tenantLogin: string, secret: string, now = Date.now()): string {
        if (!usable(secret)) {
            throw new Error('Task sandbox links require a secret of at least 32 characters.');
        }
        return `${now}.${hmac(secret, `sandbox-link\u0000${tenantLogin.trim().toLowerCase()}\u0000${now}`)}`;
    }

    export function verifyLinkProbe(probe: string | undefined, secret: string | undefined, tenantLogin: string | undefined, now = Date.now()): boolean {
        if (!probe || !tenantLogin?.trim() || !usable(secret)) {
            return false;
        }
        const separator = probe.indexOf('.');
        const issuedAt = Number(probe.slice(0, separator));
        return separator > 0 && fresh(issuedAt, now)
            && equal(probe.slice(separator + 1), hmac(secret, `sandbox-link\u0000${tenantLogin.trim().toLowerCase()}\u0000${issuedAt}`));
    }

    /** Tenant backend: a signed request for the link stream. */
    export function signRequest(
        tenantLogin: string, secret: string, id: string, op: QaapTaskSandboxBrokerOp, args: unknown, now = Date.now(),
    ): QaapTaskSandboxBrokerRequest {
        if (!usable(secret)) {
            throw new Error('Task sandbox requests require a secret of at least 32 characters.');
        }
        return { type: 'request', id, op, args, issuedAt: now, signature: hmac(secret, requestInput(tenantLogin, id, now, op, args)) };
    }

    /** Control plane: verify a request read from `tenantLogin`'s link without throwing on hostile input. */
    export function verifyRequest(request: unknown, tenantLogin: string, secret: string | undefined, now = Date.now()): request is QaapTaskSandboxBrokerRequest {
        if (!request || typeof request !== 'object' || !usable(secret)) {
            return false;
        }
        const candidate = request as Partial<QaapTaskSandboxBrokerRequest>;
        return candidate.type === 'request'
            && typeof candidate.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(candidate.id)
            && (candidate.op === 'create' || candidate.op === 'destroy' || candidate.op === 'list')
            && typeof candidate.issuedAt === 'number' && fresh(candidate.issuedAt, now)
            && typeof candidate.signature === 'string'
            && equal(candidate.signature, hmac(secret, requestInput(tenantLogin, candidate.id, candidate.issuedAt, candidate.op, candidate.args)));
    }
}

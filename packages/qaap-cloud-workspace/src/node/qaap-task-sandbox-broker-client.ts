// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import type { Application, Request, Response } from '@theia/core/shared/express';
import * as crypto from 'crypto';
import { QAAP_TENANT_RUNTIME_API_PATH } from '../common/qaap-cloud-api-types';
import {
    QAAP_TASK_SANDBOX_LINK_HEADER,
    QAAP_TASK_SANDBOX_LINK_PATH,
    QAAP_TASK_SANDBOX_REPLY_PATH,
    QaapTaskSandboxBrokerAuth,
    type QaapTaskSandboxBrokerCreateArgs,
    type QaapTaskSandboxBrokerDestroyArgs,
    type QaapTaskSandboxBrokerListed,
    type QaapTaskSandboxBrokerOp,
    type QaapTaskSandboxBrokerPrepareArgs,
    type QaapTaskSandboxBrokerReply,
    type QaapTaskSandboxBrokerSandbox,
} from './qaap-task-sandbox-broker-protocol';

const LINK_WAIT_MS = 15_000;
const CALL_TIMEOUT_MS = 90_000;
const HEARTBEAT_MS = 15_000;

interface PendingCall {
    readonly resolve: (value: unknown) => void;
    readonly reject: (error: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
}

/**
 * Tenant-backend side of the task-sandbox broker (doc/qaap-task-sandbox.md). Serves the link the
 * control plane opens (`GET …/task-sandbox/link`, NDJSON stream of signed requests) and the
 * replies it posts back (`POST …/task-sandbox/reply`). Both require the control plane's probe,
 * signed with this tenant's `QAAP_TENANT_BACKEND_SECRET`. Active only in tenant-backend mode.
 */
@injectable()
export class QaapTaskSandboxBrokerClient implements BackendApplicationContribution {

    protected link: Response | undefined;
    protected heartbeat: ReturnType<typeof setInterval> | undefined;
    protected readonly linkWaiters = new Set<() => void>();
    protected readonly linkListeners = new Set<() => void>();
    protected readonly pending = new Map<string, PendingCall>();

    isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        return /^(1|true)$/i.test(env.QAAP_TASK_SANDBOX?.trim() ?? '')
            && /^(1|true)$/i.test(env.QAAP_TENANT_BACKEND_MODE?.trim() ?? '');
    }

    configure(app: Application): void {
        if (!this.isEnabled()) {
            return;
        }
        app.get(`${QAAP_TENANT_RUNTIME_API_PATH}${QAAP_TASK_SANDBOX_LINK_PATH}`, (req, res) => this.handleLink(req, res));
        app.post(`${QAAP_TENANT_RUNTIME_API_PATH}${QAAP_TASK_SANDBOX_REPLY_PATH}`, (req, res) => {
            void this.handleReply(req, res);
        });
    }

    onStop(): void {
        this.link?.end();
    }

    isLinked(): boolean {
        return !!this.link;
    }

    create(args: QaapTaskSandboxBrokerCreateArgs): Promise<QaapTaskSandboxBrokerSandbox> {
        return this.call('create', args) as Promise<QaapTaskSandboxBrokerSandbox>;
    }

    async destroy(args: QaapTaskSandboxBrokerDestroyArgs): Promise<void> {
        await this.call('destroy', args);
    }

    list(): Promise<QaapTaskSandboxBrokerListed[]> {
        return this.call('list', {}) as Promise<QaapTaskSandboxBrokerListed[]>;
    }

    /** Ask the broker to keep a spare sandbox ready for these HOME links (doc/qaap-task-sandbox.md, "Spare sandbox"). */
    async prepare(args: QaapTaskSandboxBrokerPrepareArgs): Promise<void> {
        await this.call('prepare', args);
    }

    /** Called each time the control plane (re)opens the link: after a deploy or a control-plane restart. */
    onDidLink(listener: () => void): { dispose(): void } {
        this.linkListeners.add(listener);
        return { dispose: () => this.linkListeners.delete(listener) };
    }

    protected authorized(req: Request): boolean {
        const probe = req.headers[QAAP_TASK_SANDBOX_LINK_HEADER];
        return QaapTaskSandboxBrokerAuth.verifyLinkProbe(
            typeof probe === 'string' ? probe : undefined,
            process.env.QAAP_TENANT_BACKEND_SECRET,
            process.env.QAAP_TENANT_LOGIN,
        );
    }

    protected handleLink(req: Request, res: Response): void {
        if (!this.authorized(req)) {
            res.status(404).end();
            return;
        }
        // One live link: a reconnecting control plane replaces the previous one.
        this.link?.end();
        res.status(200);
        res.setHeader('content-type', 'application/x-ndjson');
        res.setHeader('cache-control', 'no-store');
        res.flushHeaders();
        req.socket.setKeepAlive(true, HEARTBEAT_MS);
        req.socket.setTimeout(0);
        res.write('{"type":"hello"}\n');
        this.link = res;
        if (this.heartbeat) {
            clearInterval(this.heartbeat);
        }
        this.heartbeat = setInterval(() => this.link?.write('{"type":"ping"}\n'), HEARTBEAT_MS);
        this.heartbeat.unref?.();
        const drop = (): void => {
            if (this.link === res) {
                this.link = undefined;
                if (this.heartbeat) {
                    clearInterval(this.heartbeat);
                    this.heartbeat = undefined;
                }
            }
        };
        // Not req 'close': it fires as soon as the (empty) GET body has been read.
        res.on('close', drop);
        req.socket.on('close', drop);
        for (const waiter of [...this.linkWaiters]) {
            waiter();
        }
        for (const listener of [...this.linkListeners]) {
            listener();
        }
    }

    protected async handleReply(req: Request, res: Response): Promise<void> {
        if (!this.authorized(req)) {
            res.status(404).end();
            return;
        }
        let reply = req.body as QaapTaskSandboxBrokerReply | undefined;
        if (!reply || typeof reply !== 'object' || typeof reply.id !== 'string') {
            reply = await this.readJson(req) as QaapTaskSandboxBrokerReply | undefined;
        }
        const call = reply && typeof reply.id === 'string' ? this.pending.get(reply.id) : undefined;
        if (call && reply) {
            this.pending.delete(reply.id);
            clearTimeout(call.timer);
            if (reply.ok) {
                call.resolve(reply.result);
            } else {
                call.reject(new Error(`Task sandbox broker: ${reply.error ?? 'request failed'}`));
            }
        }
        res.json({ ok: true });
    }

    protected readJson(req: Request): Promise<unknown> {
        return new Promise(resolve => {
            let body = '';
            req.setEncoding('utf8');
            req.on('data', (chunk: string) => {
                body += chunk;
                if (body.length > 1024 * 1024) {
                    req.destroy();
                }
            });
            req.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch {
                    resolve(undefined);
                }
            });
            req.on('error', () => resolve(undefined));
        });
    }

    protected async waitForLink(timeoutMs: number): Promise<Response> {
        if (this.link) {
            return this.link;
        }
        await new Promise<void>((resolve, reject) => {
            const waiter = (): void => {
                clearTimeout(timer);
                this.linkWaiters.delete(waiter);
                resolve();
            };
            const timer = setTimeout(() => {
                this.linkWaiters.delete(waiter);
                reject(new Error('The control plane has not linked to this tenant backend yet (task sandbox broker unavailable).'));
            }, timeoutMs);
            this.linkWaiters.add(waiter);
        });
        return this.link!;
    }

    protected async call(op: QaapTaskSandboxBrokerOp, args: unknown): Promise<unknown> {
        const secret = process.env.QAAP_TENANT_BACKEND_SECRET;
        const login = process.env.QAAP_TENANT_LOGIN;
        if (!secret || !login) {
            throw new Error('Task sandbox broker calls need QAAP_TENANT_BACKEND_SECRET and QAAP_TENANT_LOGIN.');
        }
        const link = await this.waitForLink(LINK_WAIT_MS);
        const id = crypto.randomBytes(12).toString('base64url');
        const request = QaapTaskSandboxBrokerAuth.signRequest(login, secret, id, op, args);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Task sandbox broker did not answer ${op} within ${CALL_TIMEOUT_MS / 1000} s.`));
            }, CALL_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timer });
            link.write(`${JSON.stringify(request)}\n`);
        });
    }
}

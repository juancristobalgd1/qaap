// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import {
    QAAP_TOOL_GATE_TOKEN_HEADER,
    type QaapToolGateDecision,
} from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { mapQaapToolKind, type QaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { QaapAgentApprovalEndpoint } from './qaap-agent-approval-endpoint';
import { QaapToolGateAskBroker } from './qaap-tool-gate-ask-broker';
import { QaapToolGateEndpoint } from './qaap-tool-gate-endpoint';
import { QaapToolGateService } from './qaap-tool-gate-service';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

const WORKSPACE = process.cwd();

class TestableGateEndpoint extends QaapToolGateEndpoint {
    askTtlSec = 0.05;
    evaluateForTest(req: Request, res: Response): Promise<void> {
        return this.handleEvaluate(req, res);
    }
    healthForTest(req: Request, res: Response): void {
        this.handleHealth(req, res);
    }
    protected override resolveCapabilities(): QaapHarnessCapabilities {
        return {
            agentId: 'test', gate: 'hook', canAsk: this.askTtlSec > 0, askTtlSec: this.askTtlSec,
            whenAskUnsupported: 'refuses', shellGuard: 'gate', untrustedFolderArgs: [], trustedFolderArgs: [],
            usage: 'none', costSource: 'none', mapToolKind: name => mapQaapToolKind(name),
        };
    }
}

interface FakeResponse {
    statusCode: number;
    body?: unknown;
    writableEnded: boolean;
    destroyed: boolean;
}

function fakeRes(): Response & FakeResponse {
    const res = {
        statusCode: 200, body: undefined as unknown, writableEnded: false, destroyed: false,
        set: () => res,
        on: () => res,
        status(code: number) { res.statusCode = code; return res; },
        json(body: unknown) { res.body = body; res.writableEnded = true; return res; },
    };
    return res as unknown as Response & FakeResponse;
}

function fakeReq(headers: Record<string, string>, body?: unknown): Request {
    return { headers, body, header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

function decisionOf(res: FakeResponse): QaapToolGateDecision {
    return (res.body as { decision: QaapToolGateDecision }).decision;
}

describe('QaapToolGateEndpoint', () => {

    let tokens: QaapToolGateTokenService;
    let asks: QaapToolGateAskBroker;
    let endpoint: TestableGateEndpoint;
    let token: string;
    let taskState: string;
    let task: Record<string, unknown>;

    beforeEach(() => {
        tokens = new QaapToolGateTokenService();
        asks = new QaapToolGateAskBroker();
        taskState = 'running';
        task = { id: 'task-1', autoApprove: false, readOnlyWorkspace: false };
        endpoint = Object.create(TestableGateEndpoint.prototype) as TestableGateEndpoint;
        endpoint.askTtlSec = 0.05;
        Object.assign(endpoint, {
            tokens,
            asks,
            gate: new QaapToolGateService(),
            callTimes: new Map(),
            runner: {
                detail: async () => ({ ...task, state: taskState }),
                resolveTaskAgentId: () => 'pi',
            },
        });
        token = tokens.issue('task-1', 'alice', WORKSPACE);
    });

    const call = (headers: Record<string, string>, body: Record<string, unknown> = {}): Promise<Response & FakeResponse> => {
        const res = fakeRes();
        return endpoint.evaluateForTest(fakeReq(headers, {
            rawToolName: 'Bash', input: { command: 'npm test' }, cwd: WORKSPACE, harnessCallId: 'c1', ...body,
        }), res).then(() => res);
    };

    describe('authentication', () => {
        it('rejects a missing or wrong gate token with 401', async () => {
            expect((await call({})).statusCode).to.equal(401);
            expect((await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: 'nope' })).statusCode).to.equal(401);
        });

        it('does not accept x-qaap-task-token, bearer tokens, cookies or tenant assertions as gate credentials', async () => {
            for (const headers of <Array<Record<string, string>>>[
                { 'x-qaap-task-token': token },
                { authorization: `Bearer ${token}` },
                { cookie: `qaap_session=${token}` },
                { 'x-qaap-tenant-assertion': token },
            ]) {
                expect((await call(headers)).statusCode).to.equal(401);
            }
        });

        it('rejects a revoked token with 401', async () => {
            tokens.revoke('task-1');
            expect((await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token })).statusCode).to.equal(401);
        });

        it('rejects an expired token with 401', async () => {
            class ExpiredTokens extends QaapToolGateTokenService {
                protected override now(): number {
                    return Date.now() + 13 * 60 * 60 * 1000;
                }
            }
            const expired = new ExpiredTokens();
            const expiredToken = tokens.issue('task-1', 'alice', WORKSPACE);
            (expired as unknown as { grants: Map<string, unknown> }).grants = (tokens as unknown as { grants: Map<string, unknown> }).grants;
            (endpoint as unknown as { tokens: QaapToolGateTokenService }).tokens = expired;
            expect((await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: expiredToken })).statusCode).to.equal(401);
        });

        it('revokes the token and answers 401 when the task is no longer running', async () => {
            taskState = 'completed';
            expect((await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token })).statusCode).to.equal(401);
            expect(tokens.resolve(token)).to.equal(undefined);
        });

        it('serves health only with a live token', () => {
            const denied = fakeRes();
            endpoint.healthForTest(fakeReq({}), denied);
            expect(denied.statusCode).to.equal(401);
            const ok = fakeRes();
            endpoint.healthForTest(fakeReq({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }), ok);
            expect(ok.statusCode).to.equal(200);
        });
    });

    describe('the gate token authenticates nothing else', () => {
        it('is unauthorized for the real auth guard and the approval routes', async () => {
            const saved = process.env.QAAP_SKIP_AUTH;
            delete process.env.QAAP_SKIP_AUTH;
            try {
                const guard = Object.create(QaapGithubAuthGuard.prototype) as QaapGithubAuthGuard;
                Object.assign(guard, { sessions: { getSession: () => undefined }, auditedApiTokenRequests: new WeakSet() });
                const req = fakeReq({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token, 'x-qaap-task-token': token, authorization: `Bearer ${token}` });
                expect(guard.authenticate(req).kind).to.equal('unauthorized');

                const approvals = Object.create(QaapAgentApprovalEndpoint.prototype) as QaapAgentApprovalEndpoint;
                let reached = false;
                const store = { list: async () => { reached = true; return []; }, approve: async () => { reached = true; return { ok: true }; }, reject: async () => { reached = true; return { ok: true }; } };
                Object.assign(approvals, { auth: guard, store });
                const approvalReq = { ...req, params: { id: 'c:tool:x' }, query: {} } as unknown as Request;
                for (const handler of ['handleList', 'handleApprove', 'handleReject'] as const) {
                    const res = fakeRes();
                    await (approvals as unknown as Record<string, (r: Request, s: Response) => Promise<void>>)[handler](approvalReq, res);
                    expect(res.statusCode, handler).to.equal(401);
                }
                expect(reached).to.equal(false);
            } finally {
                if (saved !== undefined) {
                    process.env.QAAP_SKIP_AUTH = saved;
                }
            }
        });
    });

    describe('one-shot grants (goal-loop evaluator, prompt improve)', () => {
        let oneShot: { token: string; release: () => void };

        beforeEach(() => {
            // No running task backs a one-shot: the runner must not be consulted.
            (endpoint as unknown as { runner: Record<string, unknown> }).runner.detail = async () => undefined;
            oneShot = tokens.issueOneShot('pi', 'alice', WORKSPACE);
        });

        const callOneShot = (body: Record<string, unknown>): Promise<Response & FakeResponse> =>
            call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: oneShot.token }, { harnessCallId: `os-${Math.random()}`, ...body });

        it('lets the evaluator read the workspace and run read-only commands without a running task', async () => {
            for (const body of [
                { rawToolName: 'read', input: { path: 'a.ts' } },
                { rawToolName: 'grep', input: { pattern: 'x' } },
                { rawToolName: 'bash', input: { command: 'git status' } },
            ]) {
                const res = await callOneShot(body);
                expect(res.statusCode, JSON.stringify(body)).to.equal(200);
                expect(decisionOf(res).kind, JSON.stringify(body)).to.equal('allow');
            }
            expect(asks.count(oneShot.token)).to.equal(0);
        });

        it('cannot write, edit, run destructive or mutating commands, or use other tools', async () => {
            for (const body of [
                { rawToolName: 'write', input: { path: 'a.ts', content: 'x' } },
                { rawToolName: 'edit', input: { path: 'a.ts' } },
                { rawToolName: 'bash', input: { command: 'touch pwned' } },
                { rawToolName: 'bash', input: { command: 'git push --force origin main' } },
                { rawToolName: 'bash', input: { command: 'rm -rf /' } },
                { rawToolName: 'mcp__server__tool', input: {} },
                { rawToolName: 'webfetch', input: { url: 'http://x' } },
                { rawToolName: 'some_new_tool', input: {} },
            ]) {
                const decision = decisionOf(await callOneShot(body));
                expect(decision.kind, JSON.stringify(body)).to.equal('deny');
            }
            expect(asks.count('one-shot')).to.equal(0);
        });

        it('never asks a human: a would-be ask is a deny', async () => {
            expect(decisionOf(await callOneShot({ rawToolName: 'bash', input: { command: 'make' } })).kind).to.equal('deny');
        });

        it('stays inside the workspace', async () => {
            expect(decisionOf(await callOneShot({ cwd: '/' })).kind).to.equal('deny');
        });

        it('is revoked when its process ends', async () => {
            oneShot.release();
            expect((await callOneShot({ rawToolName: 'read', input: {} })).statusCode).to.equal(401);
        });

        it('gets 401 once the grant has expired', async () => {
            class Expired extends QaapToolGateTokenService {
                protected override now(): number {
                    return Date.now() + 31 * 60 * 1000;
                }
            }
            const expired = new Expired();
            (expired as unknown as { grants: Map<string, unknown> }).grants = (tokens as unknown as { grants: Map<string, unknown> }).grants;
            (endpoint as unknown as { tokens: QaapToolGateTokenService }).tokens = expired;
            expect((await callOneShot({ rawToolName: 'read', input: {} })).statusCode).to.equal(401);
        });

        it('does not revoke or replace a live task token', async () => {
            const taskToken = token;
            tokens.issueOneShot('pi', 'alice', WORKSPACE).release();
            expect(tokens.resolve(taskToken)?.taskId).to.equal('task-1');
        });
    });

    describe('rate-limit bookkeeping', () => {
        it('prunes the buckets of tasks that went quiet and of a task that is no longer running', async () => {
            const callTimes = (endpoint as unknown as { callTimes: Map<string, number[]> }).callTimes;
            callTimes.set('old-task', [Date.now() - 120_000]);
            task.autoApprove = true;
            await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token });
            expect(callTimes.has('old-task')).to.equal(false);
            expect(callTimes.has('task-1')).to.equal(true);
            taskState = 'completed';
            await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token });
            expect(callTimes.has('task-1')).to.equal(false);
        });
    });

    describe('decisions', () => {
        it('derives task, owner and workspace from the token, never from the body', async () => {
            let seen: { taskId?: string; owner?: string; workspace?: string } | undefined;
            (endpoint as unknown as { gate: unknown }).gate = {
                evaluate: async (_req: unknown, env: typeof seen): Promise<QaapToolGateDecision> => {
                    seen = env;
                    return { kind: 'allow', source: 'policy' };
                },
            };
            const res = await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { taskId: 'task-2', owner: 'mallory', workspace: '/etc' });
            expect(res.statusCode).to.equal(200);
            expect(seen).to.include({ taskId: 'task-1', owner: 'alice', workspace: WORKSPACE });
        });

        it('allows without asking when the task auto-approves', async () => {
            task.autoApprove = true;
            const res = await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token });
            expect(decisionOf(res)).to.deep.equal({ kind: 'allow', source: 'policy' });
        });

        it('denies destructive shell commands even in full access', async () => {
            task.autoApprove = true;
            const res = await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { input: { command: 'git push --force origin main' } });
            const decision = decisionOf(res);
            expect(decision.kind).to.equal('deny');
            expect(decision.kind === 'deny' && decision.source).to.equal('destructive-guard');
        });

        it('denies a cwd outside the task workspace', async () => {
            task.autoApprove = true;
            const res = await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { cwd: '/' });
            expect(decisionOf(res).kind).to.equal('deny');
        });

        it('ignores a client-supplied toolKind: a shell call labelled "read" still asks', async () => {
            const pending = call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { toolKind: 'read' });
            await new Promise(resolve => setTimeout(resolve, 5));
            expect(asks.count('task-1')).to.equal(1);
            const res = await pending;
            expect(decisionOf(res)).to.include({ kind: 'deny', source: 'ttl' });
        });

        it('denies an ask that times out, and the card is gone afterwards', async () => {
            const res = await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token });
            const decision = decisionOf(res);
            expect(decision).to.include({ kind: 'deny', source: 'ttl', retryable: true });
            expect(asks.count('task-1')).to.equal(0);
        });

        it('allows once the user approves the card, and denies on reject', async () => {
            for (const [action, expected] of [['approve', 'allow'], ['reject', 'deny']] as const) {
                const pending = call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { harnessCallId: `c-${action}` });
                endpoint.askTtlSec = 5;
                await new Promise(resolve => setTimeout(resolve, 5));
                expect(asks.respond('task-1', action, `c-${action}`)).to.equal(true);
                expect(decisionOf(await pending).kind).to.equal(expected);
                endpoint.askTtlSec = 0.05;
            }
        });

        it('denies instead of asking when the harness cannot ask', async () => {
            endpoint.askTtlSec = 0;
            const res = await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token });
            expect(decisionOf(res).kind).to.equal('deny');
            expect(asks.count('task-1')).to.equal(0);
        });

        it('caps the asks waiting at once and the calls per minute', async () => {
            endpoint.askTtlSec = 5;
            const pending = Array.from({ length: 5 }, (_, index) =>
                call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { harnessCallId: `p${index}` }));
            await new Promise(resolve => setTimeout(resolve, 5));
            expect(asks.count('task-1')).to.equal(5);
            const sixth = await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { harnessCallId: 'p5' });
            expect(decisionOf(sixth).kind).to.equal('deny');
            asks.cancelTask('task-1');
            await Promise.all(pending);

            task.autoApprove = true;
            let lastKind = 'allow';
            for (let index = 0; index < 60; index++) {
                lastKind = decisionOf(await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { harnessCallId: `r${index}` })).kind;
            }
            expect(lastKind).to.equal('deny');
        });

        it('audits the FINAL (rewritten) input, not the original', async () => {
            task.autoApprove = true;
            const audits: Array<Record<string, unknown>> = [];
            (endpoint as unknown as { runner: Record<string, unknown> }).runner.observability = { recordAgentToolCommand: (a: Record<string, unknown>) => audits.push(a) };
            (endpoint as unknown as { gate: unknown }).gate = {
                evaluate: async (): Promise<QaapToolGateDecision> => ({ kind: 'allow', source: 'hook', updatedInput: { command: 'echo safe' } }),
            };
            await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { input: { command: 'echo original' } });
            expect(audits).to.have.length(1);
            expect(audits[0]).to.include({ command: 'echo safe', decision: 'approve', autoApprovalReason: 'input-rewritten', taskId: 'task-1' });
        });

        it('rejects a malformed body', async () => {
            const res = fakeRes();
            await endpoint.evaluateForTest(fakeReq({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token }, { cwd: 3 }), res);
            expect(res.statusCode).to.equal(400);
        });
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Request, Response } from '@theia/core/shared/express';
import { QaapGithubAuthGuard } from '@theia/qaap-shared-core/lib/node/qaap-github-auth-guard';
import {
    QAAP_TOOL_GATE_CLIENT_ERRORS_HEADER,
    QAAP_TOOL_GATE_TOKEN_HEADER,
    type QaapToolGateDecision,
} from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { mapQaapToolKind, type QaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { QaapAgentApprovalEndpoint } from './qaap-agent-approval-endpoint';
import { Emitter } from '@theia/core/lib/common/event';
import { QaapAgentHookService } from './qaap-agent-hook-service';
import { QaapGitExecConfigChecker } from './qaap-git-exec-config-checker';
import { QaapShellPathContainmentChecker } from './qaap-shell-path-containment-checker';
import { QaapToolGateAskBroker } from './qaap-tool-gate-ask-broker';
import { QaapToolGateEndpoint } from './qaap-tool-gate-endpoint';
import { QaapToolGateService } from './qaap-tool-gate-service';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

const WORKSPACE = process.cwd();
// Isolated from the developer's own git config (lfs filters, fsmonitor...) so the checks are deterministic.
const emptyGitConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-gate-gitcfg-')), 'config');
fs.writeFileSync(emptyGitConfig, '');
const isolatedGitEnv = { ...process.env, GIT_CONFIG_GLOBAL: emptyGitConfig, GIT_CONFIG_NOSYSTEM: '1' };
const gitChecker = new QaapGitExecConfigChecker((cwd, args) => spawnSync('git', [...args], { cwd, encoding: 'utf8', env: isolatedGitEnv }), os.tmpdir());
const TMP_ROOT = fs.realpathSync(os.tmpdir());

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
    let outputs: Array<{ id: string; text: string }>;
    let cancels: Array<{ id: string; options: unknown }>;

    beforeEach(() => {
        tokens = new QaapToolGateTokenService();
        asks = new QaapToolGateAskBroker();
        taskState = 'running';
        outputs = [];
        cancels = [];
        task = { id: 'task-1', autoApprove: false, readOnlyWorkspace: false, cwd: WORKSPACE, ownerLogin: 'alice' };
        endpoint = Object.create(TestableGateEndpoint.prototype) as TestableGateEndpoint;
        endpoint.askTtlSec = 0.05;
        Object.assign(endpoint, {
            tokens,
            asks,
            gate: new QaapToolGateService(),
            callTimes: new Map(),
            gateErrors: new Map(),
            runner: {
                detail: async () => ({ ...task, state: taskState }),
                resolveTaskAgentId: () => 'pi',
                appendAndFireOutput: (id: string, text: string) => outputs.push({ id, text }),
                cancel: (id: string, options: unknown) => { cancels.push({ id, options }); return undefined; },
                checkGitExecConfig: (cwd: string) => cwd.startsWith(TMP_ROOT) ? gitChecker.check(cwd) : undefined,
                checkShellPathsInsideCwd: (cwd: string, paths: readonly string[]) => new QaapShellPathContainmentChecker().check(cwd, paths),
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

        describe('runtime checks on read-only shell commands', () => {
            let repo: string;
            beforeEach(() => {
                repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-gate-readonly-')));
                spawnSync('git', ['init', '-q'], { cwd: repo });
                oneShot = tokens.issueOneShot('pi', 'alice', repo);
            });
            afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

            it('allows git status in a clean repo', async () => {
                const res = await callOneShot({ cwd: repo, rawToolName: 'bash', input: { command: 'git status' } });
                expect(decisionOf(res).kind).to.equal('allow');
            });

            it('denies git status when .git/config can make git run a program (core.fsmonitor)', async () => {
                fs.appendFileSync(path.join(repo, '.git', 'config'), '[core]\n\tfsmonitor = /tmp/evil.sh\n');
                const res = await callOneShot({ cwd: repo, rawToolName: 'bash', input: { command: 'git status' } });
                expect(decisionOf(res).kind).to.equal('deny');
            });

            it('denies reading a path outside the cwd, allows one inside', async () => {
                fs.writeFileSync(path.join(repo, 'a.txt'), 'hi');
                expect(decisionOf(await callOneShot({ cwd: repo, rawToolName: 'bash', input: { command: 'cat a.txt' } })).kind).to.equal('allow');
                expect(decisionOf(await callOneShot({ cwd: repo, rawToolName: 'bash', input: { command: 'cat /etc/passwd' } })).kind).to.equal('deny');
            });

            it('is also enforced for read-only tasks, and unverified (no checks) means not read-only', async () => {
                const service = new QaapToolGateService();
                const base = { taskId: 't', owner: 'alice', workspace: repo, autoApprove: true, readOnlyWorkspace: true, askTtlSec: 0, ask: async () => 'cancelled' as const };
                const request = { agentId: 'pi', toolKind: 'shell' as const, rawToolName: 'bash', input: { command: 'git status' }, cwd: repo };
                expect((await service.evaluate(request, base)).kind).to.equal('deny');
                expect((await service.evaluate(request, { ...base, checkGitExecConfig: () => undefined, checkPathsInsideCwd: () => undefined })).kind).to.equal('allow');
                expect((await service.evaluate(request, { ...base, checkGitExecConfig: () => 'core.fsmonitor', checkPathsInsideCwd: () => undefined })).kind).to.equal('deny');
            });
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

    describe('PreToolUse hooks (pipeline step 4)', () => {
        const gateHeaders = (): Record<string, string> => ({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token });
        let ran: string[];
        let warnings: string[];
        let hookResults: Record<string, { exitCode?: number; stdout: string; stderr: string; timedOut: boolean; error?: string }>;
        let workspaceState: 'trusted' | 'pending' | undefined;

        const decl = (command: string): Record<string, unknown> => ({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command, timeoutSec: 5 }] }] });

        beforeEach(() => {
            ran = [];
            warnings = [];
            hookResults = {};
            workspaceState = 'trusted';
            const service = Object.create(QaapAgentHookService.prototype) as QaapAgentHookService;
            const emitter = new Emitter<{ message: string }>();
            emitter.event(warning => warnings.push(warning.message));
            Object.assign(service, {
                loader: {
                    loadUser: () => ({ declaration: {}, errors: [] }),
                    loadWorkspace: () => ({ root: WORKSPACE, filePath: `${WORKSPACE}/.qaap/hooks.json`, declaration: decl('ws-hook'), digest: 'digest-1', errors: [] }),
                },
                trustStore: { decisionFor: () => workspaceState },
                processRunner: {
                    run: async (command: string) => {
                        ran.push(command);
                        return hookResults[command] ?? { exitCode: 0, stdout: '', stderr: '', timedOut: false };
                    },
                },
                onDidWarnEmitter: emitter,
                warnings: new Map(),
                startedSessions: new Set(),
                announcedPending: new Set(),
                configCache: new Map(),
                pendingWorkspaces: new Map(),
            });
            (endpoint as unknown as { runner: Record<string, unknown> }).runner.agentHooks = service;
            task.autoApprove = true;
        });

        it('a hook deny blocks the call with the hook reason, even in full access', async () => {
            hookResults['ws-hook'] = { exitCode: 2, stdout: '', stderr: 'no deploys here', timedOut: false };
            const decision = decisionOf(await call(gateHeaders()));
            expect(decision).to.include({ kind: 'deny', source: 'hook' });
            expect(decision.kind === 'deny' && decision.reason).to.contain('no deploys here');
        });

        it('a hook ask raises a user card even when the policy would auto-approve; approve allows', async () => {
            hookResults['ws-hook'] = { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask' } }), stderr: '', timedOut: false };
            endpoint.askTtlSec = 5;
            const pending = call(gateHeaders());
            await new Promise(resolve => setTimeout(resolve, 10));
            expect(asks.count('task-1')).to.equal(1);
            asks.respond('task-1', 'approve', 'c1');
            expect(decisionOf(await pending).kind).to.equal('allow');
        });

        it('a hook ask that nobody answers is denied on TTL', async () => {
            hookResults['ws-hook'] = { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask' } }), stderr: '', timedOut: false };
            expect(decisionOf(await call(gateHeaders()))).to.include({ kind: 'deny', source: 'ttl' });
        });

        it('returns the hook updatedInput to the client and audits the final input', async () => {
            const audits: Array<Record<string, unknown>> = [];
            (endpoint as unknown as { runner: Record<string, unknown> }).runner.observability = { recordAgentToolCommand: (a: Record<string, unknown>) => audits.push(a) };
            hookResults['ws-hook'] = { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', updatedInput: { command: 'echo safe' } } }), stderr: '', timedOut: false };
            const decision = decisionOf(await call(gateHeaders(), { input: { command: 'echo original' } }));
            expect(decision).to.deep.equal({ kind: 'allow', source: 'hook', updatedInput: { command: 'echo safe' } });
            expect(audits[0]).to.include({ command: 'echo safe', autoApprovalReason: 'input-rewritten' });
        });

        it('always returns the COMPLETE input: a partial hook rewrite is merged on top of the original', async () => {
            hookResults['ws-hook'] = { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', updatedInput: { command: 'echo safe' } } }), stderr: '', timedOut: false };
            const decision = decisionOf(await call(gateHeaders(), { input: { command: 'echo original', timeout: 5, cwd: 'sub' } }));
            expect(decision).to.deep.equal({ kind: 'allow', source: 'hook', updatedInput: { command: 'echo safe', timeout: 5, cwd: 'sub' } });
        });

        it('re-runs the guards on a rewritten input: a hook cannot smuggle a destructive command', async () => {
            hookResults['ws-hook'] = { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', updatedInput: { command: 'git push --force origin main' } } }), stderr: '', timedOut: false };
            expect(decisionOf(await call(gateHeaders()))).to.include({ kind: 'deny', source: 'destructive-guard' });
        });

        it('a hook allow never passes the destructive guard that precedes it', async () => {
            hookResults['ws-hook'] = { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow' } }), stderr: '', timedOut: false };
            expect(decisionOf(await call(gateHeaders(), { input: { command: 'rm -rf /' } })).kind).to.equal('deny');
            expect(ran).to.deep.equal([]);
        });

        it('workspace hooks that are not trusted do not run', async () => {
            workspaceState = undefined;
            hookResults['ws-hook'] = { exitCode: 2, stdout: '', stderr: 'would block', timedOut: false };
            expect(decisionOf(await call(gateHeaders())).kind).to.equal('allow');
            expect(ran).to.deep.equal([]);
        });

        it('a failing hook does not block and is surfaced as a warning', async () => {
            hookResults['ws-hook'] = { exitCode: 1, stdout: '', stderr: 'boom', timedOut: false };
            expect(decisionOf(await call(gateHeaders())).kind).to.equal('allow');
            expect(ran).to.deep.equal(['ws-hook']);
            expect(warnings).to.have.length(1);
            expect(warnings[0]).to.contain('boom');
        });

        it('one-shot grants never run hooks', async () => {
            hookResults['ws-hook'] = { exitCode: 2, stdout: '', stderr: 'x', timedOut: false };
            const oneShot = tokens.issueOneShot('pi', 'alice', WORKSPACE);
            (endpoint as unknown as { runner: Record<string, unknown> }).runner.detail = async () => undefined;
            const res = await call({ [QAAP_TOOL_GATE_TOKEN_HEADER]: oneShot.token }, { rawToolName: 'read', input: {} });
            expect(decisionOf(res).kind).to.equal('allow');
            expect(ran).to.deep.equal([]);
        });
    });

    describe('consecutive gate errors (design section 6)', () => {
        const gateHeaders = (extra: Record<string, string> = {}): Record<string, string> => ({ [QAAP_TOOL_GATE_TOKEN_HEADER]: token, ...extra });
        let failNext: boolean;

        beforeEach(() => {
            failNext = true;
            (endpoint as unknown as { gate: unknown }).gate = {
                evaluate: async (): Promise<QaapToolGateDecision> => failNext
                    ? { kind: 'deny', source: 'gate-error', retryable: true, reason: 'internal failure' }
                    : { kind: 'deny', source: 'policy', reason: 'normal deny' },
            };
        });

        it('cancels the task (interrupted, with a visible message) after 3 consecutive errors', async () => {
            await call(gateHeaders());
            await call(gateHeaders());
            expect(cancels).to.have.length(0);
            await call(gateHeaders());
            expect(cancels).to.deep.equal([{ id: 'task-1', options: { interrupt: true } }]);
            expect(outputs).to.have.length(1);
            expect(outputs[0].text).to.contain('safety gate failed 3 times');
        });

        it('two errors followed by a success do not cancel, and the count restarts', async () => {
            await call(gateHeaders());
            await call(gateHeaders());
            failNext = false;
            await call(gateHeaders());
            failNext = true;
            await call(gateHeaders());
            await call(gateHeaders());
            expect(cancels).to.have.length(0);
        });

        it('a normal deny is an answer, not an error', async () => {
            failNext = false;
            for (let index = 0; index < 6; index++) {
                await call(gateHeaders(), { harnessCallId: `d${index}` });
            }
            expect(cancels).to.have.length(0);
        });

        it('counts the transport failures the client reports with its next request', async () => {
            failNext = false;
            await call(gateHeaders({ [QAAP_TOOL_GATE_CLIENT_ERRORS_HEADER]: '2' }));
            expect(cancels).to.have.length(0);
            await call(gateHeaders({ [QAAP_TOOL_GATE_CLIENT_ERRORS_HEADER]: '3' }));
            expect(cancels).to.have.length(1);
        });

        it('a gate error plus reported client errors adds up to the threshold', async () => {
            await call(gateHeaders());
            await call(gateHeaders({ [QAAP_TOOL_GATE_CLIENT_ERRORS_HEADER]: '1' }));
            expect(cancels).to.have.length(1);
        });
    });
});

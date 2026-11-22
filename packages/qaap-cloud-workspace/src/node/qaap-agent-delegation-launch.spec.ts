// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { QaapAgentConversation } from '../common/qaap-agent-conversation';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { resolveQaiqControlRequestAutoDecision } from '../common/qaap-qaiq-control-auto-response';
import { buildTaskCreateRequest } from './qaap-agent-conversation-store-helpers2';
import {
    appendQaapDelegationLaunchArgs,
    applyQaapOpencodeDelegation,
    buildQaapDelegationMcpConfig,
    QAAP_AGENT_DELEGATION_GUIDANCE,
    QAAP_DELEGATION_CONFIG_DIR_PREFIX,
    QAAP_DELEGATION_MCP_TOOL_TIMEOUT_MS,
    releaseQaapDelegationMcpConfigFile,
    QAAP_DELEGATION_SANDBOX_DIRNAME,
    resolveQaapDelegateMcpPath,
    resolveQaapDelegationPlacement,
    withQaapDelegationOpencodeMcp,
    QAAP_DELEGATION_SWEEP_INTERVAL_MS,
    resetQaapDelegationSweepThrottle,
    sweepStaleQaapDelegationMcpConfigs,
    writeQaapDelegationMcpConfigFile,
    writeQaapDelegationTokenFile,
} from './qaap-agent-delegation-launch';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { buildChildEnvExtracted } from './qaap-agent-task-runner-tool-pills2';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { AGENT_PROMPT_REMOVE_SCRIPT, agentPromptOwnerRunner, quoteShellArg } from './qaap-agent-task-runner-utils';
import type { QaapTaskSandbox } from './qaap-task-sandbox';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

describe('agent delegation launch', () => {

    describe('MCP config and command line', () => {
        const wiring = { mcpServerName: 'qaaq_0123456789abcdef', url: 'http://127.0.0.1:4873', token: 'secret-token' };

        it('names the server per task and puts the credentials in the server env of the config (a 0600 file, never argv)', () => {
            const config = JSON.parse(buildQaapDelegationMcpConfig({ nodeBin: '/usr/bin/node', shimPath: '/opt/q/shim.mjs', electronRunAsNode: false }, wiring));
            expect(config).to.deep.equal({
                mcpServers: {
                    'qaaq_0123456789abcdef': {
                        type: 'stdio',
                        command: '/usr/bin/node',
                        args: ['/opt/q/shim.mjs'],
                        env: { QAAP_DELEGATION_URL: 'http://127.0.0.1:4873', QAAP_DELEGATION_TOKEN: 'secret-token' },
                    },
                },
            });
        });

        it('OpenCode wiring: a token-file write failure leaves the turn running without delegation, with no secret in the log', () => {
            const env: NodeJS.ProcessEnv = { OPENCODE_CONFIG_CONTENT: '{"model":"x"}' };
            const logged: string[] = [];
            const warn = console.warn;
            console.warn = (...args: unknown[]): void => { logged.push(args.map(String).join(' ')); };
            try {
                const failed = applyQaapOpencodeDelegation(env, 'task-1', wiring, undefined, () => {
                    throw Object.assign(new Error(`EACCES /secret/path ${wiring.token}`), { code: 'EACCES' });
                });
                expect(failed).to.equal(false);
            } finally {
                console.warn = warn;
            }
            expect(env.OPENCODE_CONFIG_CONTENT).to.equal('{"model":"x"}');
            expect(logged.join('\n')).to.contain('EACCES').and.to.not.contain(wiring.token).and.to.not.contain('/secret/path');

            const ok = applyQaapOpencodeDelegation(env, 'task-1', wiring, undefined, () => '/tmp/token-file');
            expect(ok).to.equal(true);
            expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT!).mcp[wiring.mcpServerName].environment.QAAP_DELEGATION_TOKEN_FILE).to.equal('/tmp/token-file');
            expect(env.OPENCODE_CONFIG_CONTENT).to.not.contain(wiring.token);
        });

        it('runs an Electron binary as node', () => {
            const config = JSON.parse(buildQaapDelegationMcpConfig({ nodeBin: '/Applications/Q.app/Q', shimPath: '/s.mjs', electronRunAsNode: true }, wiring));
            expect(config.mcpServers[wiring.mcpServerName].env.ELECTRON_RUN_AS_NODE).to.equal('1');
        });

        it('ships the shim where the resolver looks for it', () => {
            expect(fs.existsSync(resolveQaapDelegateMcpPath())).to.equal(true);
        });

        it('writes the config to a private 0600 file in a 0700 directory, removed when the task releases it', function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            const file = writeQaapDelegationMcpConfigFile('task-file', buildQaapDelegationMcpConfig({ nodeBin: 'node', shimPath: '/s.mjs', electronRunAsNode: false }, wiring));
            try {
                expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
                expect(fs.statSync(path.dirname(file)).mode & 0o777).to.equal(0o700);
                expect(JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers[wiring.mcpServerName].env.QAAP_DELEGATION_TOKEN).to.equal('secret-token');
            } finally {
                releaseQaapDelegationMcpConfigFile('task-file');
            }
            expect(fs.existsSync(path.dirname(file))).to.equal(false);
        });

        it('writes the OpenCode token alone to a 0600 file in a 0700 directory, removed with the task, and names only that path in the inline config', function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            const file = writeQaapDelegationTokenFile('task-token', wiring.token);
            try {
                expect(path.basename(file)).to.equal('token');
                expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
                expect(fs.statSync(path.dirname(file)).mode & 0o777).to.equal(0o700);
                expect(fs.readFileSync(file, 'utf8')).to.equal(wiring.token);
                const inline = withQaapDelegationOpencodeMcp(undefined, { nodeBin: 'node', shimPath: '/s.mjs', electronRunAsNode: false }, wiring, file);
                expect(inline).to.not.contain(wiring.token);
                expect(JSON.parse(inline).mcp[wiring.mcpServerName].environment).to.deep.equal({
                    QAAP_DELEGATION_URL: wiring.url, QAAP_DELEGATION_TOKEN_FILE: file,
                });
            } finally {
                releaseQaapDelegationMcpConfigFile('task-token');
            }
            expect(fs.existsSync(path.dirname(file))).to.equal(false);
        });

        it('sweeps directories a dead process left behind', () => {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-sweep-'));
            try {
                fs.mkdirSync(path.join(tmp, `qaap-agent-prompt-${QAAP_DELEGATION_CONFIG_DIR_PREFIX}abc`));
                fs.mkdirSync(path.join(tmp, 'unrelated'));
                // A fresh one may belong to another backend on this host: kept until it is old.
                expect(sweepStaleQaapDelegationMcpConfigs(tmp)).to.equal(0);
                expect(sweepStaleQaapDelegationMcpConfigs(tmp, 0)).to.equal(1);
                expect(fs.readdirSync(tmp)).to.deep.equal(['unrelated']);
            } finally {
                fs.rmSync(tmp, { recursive: true, force: true });
            }
        });

        it('appends the guidance and the config FILE last, so the variadic --mcp-config swallows nothing and no secret is on argv', function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            const command = appendQaapDelegationLaunchArgs("claude --print -p 'do it'", "/tmp/it's dir/mcp.json", quoteShellArg);
            expect(command).to.not.contain('secret-token');
            const printed = spawnSync('sh', ['-c', command.replace(/^claude/, "printf '%s\\n'")], { encoding: 'utf8' });
            const args = printed.stdout.split('\n').filter(Boolean);
            expect(args.slice(0, 3)).to.deep.equal(['--print', '-p', 'do it']);
            expect(args[3]).to.equal('--append-system-prompt');
            expect(args[4]).to.equal(QAAP_AGENT_DELEGATION_GUIDANCE);
            expect(args[5]).to.equal('--mcp-config');
            expect(args[6]).to.equal("/tmp/it's dir/mcp.json");
            expect(args).to.have.length(7);
        });
    });

    describe('QaapAgentTaskRunner.applyAgentDelegationEnv', () => {
        const helperApiUrl = 'http://127.0.0.1:4873/qaap/api/agent-tasks';
        const saved = process.env.QAAP_AGENT_DELEGATION;
        let tokens: QaapToolGateTokenService;

        beforeEach(() => {
            process.env.QAAP_AGENT_DELEGATION = '1';
            tokens = new QaapToolGateTokenService();
        });
        afterEach(() => {
            if (saved === undefined) {
                delete process.env.QAAP_AGENT_DELEGATION;
            } else {
                process.env.QAAP_AGENT_DELEGATION = saved;
            }
        });

        function runner(sandbox?: QaapTaskSandbox): QaapAgentTaskRunner {
            const instance = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            Object.assign(instance, { helperApiUrl, toolGateTokens: tokens, tenantSpawn: { agentSandboxFor: () => sandbox } });
            return instance;
        }
        const task = (extra: Partial<QaapAgentTask> = {}): QaapAgentTask =>
            ({ id: 'task-1', cwd: '/w', ownerLogin: 'alice', command: 'claude --print', agentId: 'claude', delegationRole: 'parent', ...extra }) as QaapAgentTask;

        it('wires a Claude parent with a separate delegate-only token and a per-task server name, none of it in the env', () => {
            const env: NodeJS.ProcessEnv = {};
            const wiring = runner().applyAgentDelegationEnv(env, task());
            expect(wiring?.transport).to.equal('claude-mcp-config');
            expect(wiring?.url).to.equal('http://127.0.0.1:4873');
            expect(wiring?.mcpServerName).to.match(/^qaaq_[0-9a-f]{16}$/);
            const grant = tokens.authorize(wiring?.token, 'delegate');
            expect(grant.ok && grant.grant.scopes).to.deep.equal(['delegate']);
            expect(tokens.delegationServerName('task-1')).to.equal(wiring?.mcpServerName);
            // Claude's own environment (inherited by its Bash and the repo's scripts) never holds the token.
            expect(env.QAAP_DELEGATION_TOKEN).to.equal(undefined);
            expect(env.QAAP_DELEGATION_URL).to.equal(undefined);
            expect(env.MCP_TOOL_TIMEOUT).to.equal(String(QAAP_DELEGATION_MCP_TOOL_TIMEOUT_MS));
            const kept: NodeJS.ProcessEnv = { MCP_TOOL_TIMEOUT: '5000' };
            runner().applyAgentDelegationEnv(kept, task());
            expect(kept.MCP_TOOL_TIMEOUT).to.equal('5000');
        });

        it('does nothing with the flag off, for a child, role-less, read-only (plan) task, a harness without the transport, or in a sandbox that shares no directory', () => {
            const cases: [() => unknown, string][] = [
                [() => { delete process.env.QAAP_AGENT_DELEGATION; return runner().applyAgentDelegationEnv({}, task()); }, 'flag off'],
                [() => runner().applyAgentDelegationEnv({}, task({ delegationRole: 'child' })), 'child'],
                [() => runner().applyAgentDelegationEnv({}, task({ delegationRole: undefined })), 'no role'],
                [() => runner().applyAgentDelegationEnv({}, task({ readOnlyWorkspace: true })), 'read-only / plan turn'],
                [() => runner().applyAgentDelegationEnv({}, task({ agentId: 'grok', command: 'grok' })), 'grok'],
                [() => runner({ name: 's', root: '/w', backendHost: '172.24.0.50' } as QaapTaskSandbox).applyAgentDelegationEnv({}, task()), 'sandbox without a shared dir'],
                [() => runner({ name: 's', root: '/w', sharedRoot: '/shared' } as QaapTaskSandbox).applyAgentDelegationEnv({}, task()), 'sandbox without a backend address'],
                [() => runner().applyAgentDelegationEnv({}, task({ agentId: 'codex', command: 'codex exec' })), 'codex without its gate token'],
            ];
            for (const [run, label] of cases) {
                process.env.QAAP_AGENT_DELEGATION = '1';
                expect(run(), label).to.equal(undefined);
            }
            expect(tokens.delegationServerName('task-1')).to.equal(undefined);
        });
    });

    describe('stdio gate', () => {
        const server = 'qaaq_0123456789abcdef';
        const request = (toolName: string): { requestId: string; toolName: string; toolInput: Record<string, unknown> } =>
            ({ requestId: 'r', toolName, toolInput: { prompt: 'x' } });
        const approveForMe = 'claude --permission-mode default --allowed-tools Edit Write NotebookEdit Bash --permission-prompt-tool stdio';

        it('allows the delegation tools of exactly the wired server without a card, in every approval mode', () => {
            for (const autoApprove of [true, false, undefined]) {
                expect(resolveQaiqControlRequestAutoDecision(approveForMe, autoApprove, request(`mcp__${server}__qaaq_delegate`), { delegationServer: server }).action)
                    .to.equal('allow');
            }
            expect(resolveQaiqControlRequestAutoDecision(approveForMe, false, request(`mcp__${server}__qaaq_delegate`), {}).action).to.equal('queue');
            expect(resolveQaiqControlRequestAutoDecision(approveForMe, true, request(`mcp__${server}__qaaq_delegate`), {}).action).to.not.equal('allow');
        });

        it('auto-allows qaaq_child_apply (a merge into the parent workspace) only when edits are auto-approved; request-approval queues a card', () => {
            const apply = request(`mcp__${server}__qaaq_child_apply`);
            const options = { delegationServer: server };
            expect(resolveQaiqControlRequestAutoDecision(approveForMe, false, apply, options).action).to.equal('queue');
            expect(resolveQaiqControlRequestAutoDecision(approveForMe, true, apply, options).action).to.equal('allow');
            expect(resolveQaiqControlRequestAutoDecision(approveForMe, undefined, apply, options).action).to.equal('allow');
            for (const tool of ['qaaq_delegate', 'qaaq_task_wait', 'qaaq_task_status', 'qaaq_task_cancel', 'qaaq_list_agents']) {
                expect(resolveQaiqControlRequestAutoDecision(approveForMe, false, request(`mcp__${server}__${tool}`), options).action, tool).to.equal('allow');
            }
        });

        it('never allows a look-alike: another tool of the server, the bare `qaaq` server, or another nonce', () => {
            const options = { delegationServer: server };
            for (const tool of [`mcp__${server}__run_shell`, 'mcp__qaaq__qaaq_delegate', 'mcp__qaaq_ffffffffffffffff__qaaq_delegate', 'mcp__other__qaaq_delegate']) {
                expect(resolveQaiqControlRequestAutoDecision(approveForMe, false, request(tool), options).action, tool).to.equal('queue');
            }
        });
    });

    describe('task plumbing', () => {

        it('marks a top-level conversation turn as parent, a delegated child as child, and a subtask as neither', () => {
            const savedFlag = process.env.QAAP_AGENT_DELEGATION;
            process.env.QAAP_AGENT_DELEGATION = '1';
            const conv = (extra: Partial<QaapAgentConversation>): QaapAgentConversation => ({
                id: 'c', cwd: '/w', agentId: 'claude', title: 't', status: 'idle', createdAt: 0, updatedAt: 0,
                messages: [{ id: 'u1', role: 'user', content: 'go', createdAt: 0 }], ...extra,
            });
            const deps = { stripLeadingAgentMention: (content: string) => content, buildPrompt: () => 'prompt' };
            expect(buildTaskCreateRequest(conv({}), 'claude', undefined, 'u1', deps).delegationRole).to.equal('parent');
            expect(buildTaskCreateRequest(conv({ parentConversationId: 'p', delegation: { isolation: 'worktree', depth: 1 } }), 'claude', undefined, 'u1', deps).delegationRole)
                .to.equal('child');
            expect(buildTaskCreateRequest(conv({ parentConversationId: 'p' }), 'claude', undefined, 'u1', deps).delegationRole).to.equal(undefined);
            expect(buildTaskCreateRequest(conv({}), 'shell', undefined, 'u1', deps).delegationRole).to.equal(undefined);
            // Only the turn the service started is a child turn: a person writing to the child later runs an ordinary turn.
            const later = conv({
                parentConversationId: 'p', delegation: { isolation: 'worktree', depth: 1 },
                messages: [{ id: 'u1', role: 'user', content: 'go', createdAt: 0 }, { id: 'u2', role: 'user', content: 'more', createdAt: 1 }],
            });
            expect(buildTaskCreateRequest(later, 'claude', undefined, 'u2', deps).delegationRole).to.equal(undefined);
            // With the flag off no task carries a role (zero impact).
            delete process.env.QAAP_AGENT_DELEGATION;
            expect(buildTaskCreateRequest(conv({}), 'claude', undefined, 'u1', deps).delegationRole).to.equal(undefined);
            if (savedFlag === undefined) {
                delete process.env.QAAP_AGENT_DELEGATION;
            } else {
                process.env.QAAP_AGENT_DELEGATION = savedFlag;
            }
        });

        it('never lets a repo-code child process inherit delegation credentials from the backend env', () => {
            const saved = { url: process.env.QAAP_DELEGATION_URL, token: process.env.QAAP_DELEGATION_TOKEN };
            process.env.QAAP_DELEGATION_URL = 'http://leak';
            process.env.QAAP_DELEGATION_TOKEN = 'leak';
            try {
                const stub: Record<string, unknown> = {
                    resolveAgentSpawnIdentity: () => ({ uid: undefined }),
                    resolveAgentCliPrefix: () => '/prefix',
                    isTenantPrivilegeDropActive: () => false,
                    isQaiqRunner: () => false,
                    applyHelperEnv: () => false,
                    toolGateWired: (): boolean => false,
                    preferenceReaderForOwner: () => () => undefined,
                    resolveAgentHome: () => '/h',
                };
                const ctx = new Proxy(stub, {
                    get: (target, key) => key in target ? target[key as string] : () => undefined,
                }) as unknown as QaapAgentTaskRunnerContext;
                const env = buildChildEnvExtracted(ctx, { id: 't', cwd: '/w', command: 'npm test' } as QaapAgentTask);
                expect(env.QAAP_DELEGATION_URL).to.equal(undefined);
                expect(env.QAAP_DELEGATION_TOKEN).to.equal(undefined);
            } finally {
                for (const [key, value] of [['QAAP_DELEGATION_URL', saved.url], ['QAAP_DELEGATION_TOKEN', saved.token]] as const) {
                    if (value === undefined) {
                        delete process.env[key];
                    } else {
                        process.env[key] = value;
                    }
                }
            }
        });
    });
    describe('inside a per-task sandbox', () => {
        const helperApiUrl = 'http://127.0.0.1:4873/qaap/api/agent-tasks';
        const saved = process.env.QAAP_AGENT_DELEGATION;
        let shared: string;
        let tokens: QaapToolGateTokenService;
        const sandbox = (extra: Partial<QaapTaskSandbox> = {}): QaapTaskSandbox =>
            ({ name: 's', root: '/w', backendHost: '172.24.0.50', sharedRoot: shared, ...extra }) as QaapTaskSandbox;
        const task = (extra: Partial<QaapAgentTask> = {}): QaapAgentTask =>
            ({ id: 'task-sb', cwd: '/w', ownerLogin: 'alice', command: 'claude --print', agentId: 'claude', delegationRole: 'parent', ...extra }) as QaapAgentTask;

        function runner(found: QaapTaskSandbox | undefined): QaapAgentTaskRunner {
            const instance = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            Object.assign(instance, { helperApiUrl, toolGateTokens: tokens, tenantSpawn: { agentSandboxFor: () => found } });
            return instance;
        }

        const originalRunner = agentPromptOwnerRunner.run;
        beforeEach(() => {
            resetQaapDelegationSweepThrottle();
            process.env.QAAP_AGENT_DELEGATION = '1';
            tokens = new QaapToolGateTokenService();
            shared = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-delegation-shared-'));
        });
        afterEach(() => {
            agentPromptOwnerRunner.run = originalRunner;
            releaseQaapDelegationMcpConfigFile('task-sb');
            fs.rmSync(shared, { recursive: true, force: true });
            if (saved === undefined) {
                delete process.env.QAAP_AGENT_DELEGATION;
            } else {
                process.env.QAAP_AGENT_DELEGATION = saved;
            }
        });

        it('wires a Claude parent with the backend address on the sandbox network, which bypasses the proxy', () => {
            const env: NodeJS.ProcessEnv = {};
            const wiring = runner(sandbox()).applyAgentDelegationEnv(env, task());
            expect(wiring?.transport).to.equal('claude-mcp-config');
            expect(wiring?.url).to.equal('http://172.24.0.50:4873');
            expect(env.NO_PROXY).to.contain('172.24.0.50');
        });

        it('wires Codex with the sandbox address in its environment (env_vars forwarding)', () => {
            const env: NodeJS.ProcessEnv = { QAAP_GATE_TOKEN: 'gate' };
            const wiring = runner(sandbox()).applyAgentDelegationEnv(env, task({ agentId: 'codex', command: 'codex exec' }));
            expect(wiring?.transport).to.equal('codex-config');
            expect(env.QAAP_DELEGATION_URL).to.equal('http://172.24.0.50:4873');
            expect(env.QAAP_DELEGATION_TOKEN).to.equal(wiring?.token);
        });

        it('issues no token when the sandbox shares no directory or has no backend address', () => {
            expect(runner(sandbox({ sharedRoot: undefined })).applyAgentDelegationEnv({}, task())).to.equal(undefined);
            expect(runner(sandbox({ backendHost: undefined })).applyAgentDelegationEnv({}, task())).to.equal(undefined);
            expect(tokens.delegationServerName('task-sb')).to.equal(undefined);
        });

        it('stays off with the flag off, also in a sandbox', () => {
            delete process.env.QAAP_AGENT_DELEGATION;
            expect(runner(sandbox()).applyAgentDelegationEnv({}, task())).to.equal(undefined);
        });

        it('places the shim, the Claude config and the OpenCode token below the shared root, which the sandbox sees at the same path', function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            const placement = resolveQaapDelegationPlacement('task-sb', sandbox());
            const base = fs.realpathSync(path.join(shared, QAAP_DELEGATION_SANDBOX_DIRNAME));
            const inside = (file: string): boolean => fs.realpathSync(file).startsWith(`${base}${path.sep}`);
            expect(placement.baseDir).to.equal(path.join(shared, QAAP_DELEGATION_SANDBOX_DIRNAME));
            // The staged copy is the shipped shim, run by the node of the sandbox (not the backend's execPath).
            expect(placement.options.nodeBin).to.equal('node');
            expect(placement.options.electronRunAsNode).to.equal(false);
            expect(inside(placement.options.shimPath)).to.equal(true);
            expect(fs.readFileSync(placement.options.shimPath, 'utf8')).to.equal(fs.readFileSync(resolveQaapDelegateMcpPath(), 'utf8'));
            expect(fs.statSync(path.dirname(placement.options.shimPath)).mode & 0o777).to.equal(0o700);

            const wiring = { mcpServerName: 'qaaq_0123456789abcdef', url: 'http://172.24.0.50:4873', token: 'secret-token' };
            const mcp = writeQaapDelegationMcpConfigFile('task-sb', buildQaapDelegationMcpConfig(placement.options, wiring), undefined, 'mcp.json', placement.baseDir);
            expect(inside(mcp)).to.equal(true);
            expect(fs.statSync(mcp).mode & 0o777).to.equal(0o600);
            expect(JSON.parse(fs.readFileSync(mcp, 'utf8')).mcpServers[wiring.mcpServerName].args).to.deep.equal([placement.options.shimPath]);

            const env: NodeJS.ProcessEnv = {};
            expect(applyQaapOpencodeDelegation(env, 'task-sb', wiring, undefined, writeQaapDelegationTokenFile, placement)).to.equal(true);
            const server = JSON.parse(env.OPENCODE_CONFIG_CONTENT!).mcp[wiring.mcpServerName];
            expect(server.command).to.deep.equal(['node', placement.options.shimPath]);
            const tokenFile = server.environment.QAAP_DELEGATION_TOKEN_FILE as string;
            expect(inside(tokenFile)).to.equal(true);
            expect(fs.statSync(tokenFile).mode & 0o777).to.equal(0o600);
            expect(env.OPENCODE_CONFIG_CONTENT).to.not.contain(wiring.token);

            releaseQaapDelegationMcpConfigFile('task-sb');
            expect(fs.readdirSync(base)).to.deep.equal([]);
        });

        it('keeps the host path unchanged without a sandbox, and refuses a sandbox that shares nothing', () => {
            const host = resolveQaapDelegationPlacement('task-sb', undefined);
            expect(host.baseDir).to.equal(undefined);
            expect(host.options.shimPath).to.equal(resolveQaapDelegateMcpPath());
            expect(() => resolveQaapDelegationPlacement('task-sb', sandbox({ sharedRoot: undefined }))).to.throw(/shares no directory/);
        });

        describe('sweep of the agent-writable base', () => {
            const prefix = `qaap-agent-prompt-${QAAP_DELEGATION_CONFIG_DIR_PREFIX}`;
            const posixOnly = (ctx: Mocha.Context): void => {
                if (process.platform === 'win32') {
                    ctx.skip();
                }
            };
            const age = (dir: string): void => {
                const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
                fs.utimesSync(dir, old, old);
            };

            it('never follows a planted symlink: the victim survives and the link is ignored', function (): void {
                posixOnly(this);
                const base = fs.mkdtempSync(path.join(shared, 'b-'));
                const victimDir = fs.mkdtempSync(path.join(shared, 'victim-'));
                fs.writeFileSync(path.join(victimDir, 'victim.txt'), 'keep');
                fs.symlinkSync(victimDir, path.join(base, `${prefix}evil`));
                fs.writeFileSync(path.join(base, `${prefix}file`), 'x');
                expect(sweepStaleQaapDelegationMcpConfigs(base, 0)).to.equal(0);
                expect(fs.readFileSync(path.join(victimDir, 'victim.txt'), 'utf8')).to.equal('keep');
                expect(fs.lstatSync(path.join(base, `${prefix}evil`)).isSymbolicLink()).to.equal(true);
                expect(fs.existsSync(path.join(base, `${prefix}file`))).to.equal(true);
            });

            it('does not remove, as the backend, a directory of another uid', function (): void {
                posixOnly(this);
                const base = fs.mkdtempSync(path.join(shared, 'b-'));
                const foreign = path.join(base, `${prefix}foreign`);
                fs.mkdirSync(foreign);
                const ran: string[] = [];
                agentPromptOwnerRunner.run = (_owner, _script, input) => { ran.push((input as { dir: string }).dir); return true; };
                // The process is simulated to be a backend with another uid, and no agent owner is known.
                expect(sweepStaleQaapDelegationMcpConfigs(base, 0, { backendUid: process.getuid!() + 1 })).to.equal(0);
                expect(fs.existsSync(foreign)).to.equal(true);
                expect(ran).to.deep.equal([]);
            });

            it('removes the agent\'s own directories by running the removal script as the agent uid', function (): void {
                posixOnly(this);
                const base = fs.mkdtempSync(path.join(shared, 'b-'));
                const theirs = path.join(base, `${prefix}agent`);
                fs.mkdirSync(theirs);
                const calls: Array<{ uid: number; script: string; dir: string }> = [];
                agentPromptOwnerRunner.run = (owner, script, input) => {
                    calls.push({ uid: owner.uid, script, dir: (input as { dir: string }).dir });
                    return true;
                };
                const agentUid = process.getuid!();
                expect(sweepStaleQaapDelegationMcpConfigs(base, 0, { backendUid: agentUid + 1, owner: { uid: agentUid } })).to.equal(1);
                expect(calls).to.deep.equal([{ uid: agentUid, script: AGENT_PROMPT_REMOVE_SCRIPT, dir: theirs }]);
            });

            it('removes an old directory of the backend and keeps a recent one', function (): void {
                posixOnly(this);
                const base = fs.mkdtempSync(path.join(shared, 'b-'));
                const old = path.join(base, `${prefix}old`);
                const fresh = path.join(base, `${prefix}fresh`);
                fs.mkdirSync(old);
                fs.mkdirSync(fresh);
                age(old);
                expect(sweepStaleQaapDelegationMcpConfigs(base)).to.equal(1);
                expect(fs.existsSync(old)).to.equal(false);
                expect(fs.existsSync(fresh)).to.equal(true);
            });

            it('looks at no more than the entry limit per pass', () => {
                const base = fs.mkdtempSync(path.join(shared, 'b-'));
                for (let i = 0; i < 5; i++) {
                    fs.mkdirSync(path.join(base, `${prefix}${i}`));
                }
                expect(sweepStaleQaapDelegationMcpConfigs(base, 0, { maxEntries: 2 })).to.equal(2);
                expect(fs.readdirSync(base)).to.have.length(3);
            });

            it('does not sweep the same base again within the throttle interval', function (): void {
                posixOnly(this);
                resolveQaapDelegationPlacement('task-sb', sandbox());
                const base = path.join(shared, QAAP_DELEGATION_SANDBOX_DIRNAME);
                const stale = path.join(base, `${prefix}stale`);
                fs.mkdirSync(stale);
                age(stale);
                resolveQaapDelegationPlacement('task-sb', sandbox());
                expect(fs.existsSync(stale)).to.equal(true);
                expect(QAAP_DELEGATION_SWEEP_INTERVAL_MS).to.equal(60000);
                resetQaapDelegationSweepThrottle();
                resolveQaapDelegationPlacement('task-sb', sandbox());
                expect(fs.existsSync(stale)).to.equal(false);
            });
        });

        it('keeps the base 1733 once it is shared, and creates it 1733 for an agent with another uid', function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            const base = path.join(shared, QAAP_DELEGATION_SANDBOX_DIRNAME);
            // The agent-side write runs locally in this spec, so the ownership check refuses; the base is made before that.
            agentPromptOwnerRunner.run = () => true;
            expect(() => resolveQaapDelegationPlacement('task-sb', sandbox(), { uid: process.getuid!() + 1 })).to.throw();
            expect(fs.lstatSync(base).mode & 0o7777).to.equal(0o1733);
            resolveQaapDelegationPlacement('task-sb', sandbox());
            expect(fs.lstatSync(base).mode & 0o7777).to.equal(0o1733);
        });

        it('refuses a base planted as a symlink or file instead of a real directory', function (): void {
            if (process.platform === 'win32') {
                this.skip();
            }
            fs.writeFileSync(path.join(shared, QAAP_DELEGATION_SANDBOX_DIRNAME), 'x');
            expect(() => resolveQaapDelegationPlacement('task-sb', sandbox())).to.throw();
        });
    });

});

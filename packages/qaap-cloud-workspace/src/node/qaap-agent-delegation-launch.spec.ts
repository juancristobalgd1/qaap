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
    resolveQaapDelegateMcpPath,
    withQaapDelegationOpencodeMcp,
    sweepStaleQaapDelegationMcpConfigs,
    writeQaapDelegationMcpConfigFile,
    writeQaapDelegationTokenFile,
} from './qaap-agent-delegation-launch';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { buildChildEnvExtracted } from './qaap-agent-task-runner-tool-pills2';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { quoteShellArg } from './qaap-agent-task-runner-utils';
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

        it('does nothing with the flag off, for a child, role-less, read-only (plan) task, a harness without the transport, or in a sandbox', () => {
            const cases: [() => unknown, string][] = [
                [() => { delete process.env.QAAP_AGENT_DELEGATION; return runner().applyAgentDelegationEnv({}, task()); }, 'flag off'],
                [() => runner().applyAgentDelegationEnv({}, task({ delegationRole: 'child' })), 'child'],
                [() => runner().applyAgentDelegationEnv({}, task({ delegationRole: undefined })), 'no role'],
                [() => runner().applyAgentDelegationEnv({}, task({ readOnlyWorkspace: true })), 'read-only / plan turn'],
                [() => runner().applyAgentDelegationEnv({}, task({ agentId: 'grok', command: 'grok' })), 'grok'],
                [() => runner({ name: 's', root: '/w' } as QaapTaskSandbox).applyAgentDelegationEnv({}, task()), 'sandbox'],
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
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Agent preview tools, phase 1 (doc/qaap-agent-preview-tools-design.md): the `preview` toolset on the per-task Qaap
 * MCP server for Claude Code, Codex and Pi, the gate auto-allow, the dev-server redirect and the prompt block.
 */

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import {
    appendAgentDefaultWorkflowToPrompt,
    buildAgentPreviewToolsPromptBlock,
} from '../common/qaap-agent-default-workflow';
import { buildDevServerShellDenyMessage, findQaiqDevServerGuardDenial } from '../common/qaap-agent-dev-server-guard';
import { resolveQaiqControlRequestAutoDecision } from '../common/qaap-qaiq-control-auto-response';
import {
    QAAP_AGENT_DELEGATION_GUIDANCE,
    QAAP_AGENT_PREVIEW_GUIDANCE,
    buildQaapAgentMcpGuidance,
    buildQaapDelegationMcpConfig,
    buildQaapDelegationPiConfig,
    withQaapDelegationOpencodeMcp,
} from './qaap-agent-delegation-launch';
import { buildQaapAcpDelegationMcpServers } from './harness/acp/qaap-acp-bridge-launch';
import { isLongLivedDevServerShellCommand } from '../common/qaap-agent-dev-server-guard';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapCodexGateOverlayBuilder } from './qaap-codex-gate-overlay';
import { QaapToolGateService, type QaapToolGateEvaluationEnv } from './qaap-tool-gate-service';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

const SERVER = 'qaaq_0123456789abcdef';
const MCP = { nodeBin: '/usr/bin/node', shimPath: '/opt/q/qaap-delegate-mcp.mjs', electronRunAsNode: false };
const FLAGS = ['QAAP_AGENT_PREVIEW_TOOLS', 'QAAP_AGENT_DELEGATION'] as const;

describe('agent preview tools wiring', () => {
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
        for (const flag of FLAGS) {
            saved[flag] = process.env[flag];
            delete process.env[flag];
        }
    });
    afterEach(() => {
        for (const flag of FLAGS) {
            if (saved[flag] === undefined) {
                delete process.env[flag];
            } else {
                process.env[flag] = saved[flag];
            }
        }
    });

    function runner(tokens: QaapToolGateTokenService): QaapAgentTaskRunner {
        const instance = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(instance, { helperApiUrl: 'http://127.0.0.1:4873/qaap/api/agent-tasks', toolGateTokens: tokens, tenantSpawn: { agentSandboxFor: () => undefined } });
        return instance;
    }
    const task = (agentId: string, command: string, extra: Partial<QaapAgentTask> = {}): QaapAgentTask =>
        ({ id: `task-${agentId}`, cwd: '/w', ownerLogin: 'alice', command, agentId, ...extra }) as QaapAgentTask;

    describe('runner', () => {
        it('gives a Pi turn a preview-only MCP token whose shim lists the preview toolset', () => {
            process.env.QAAP_AGENT_PREVIEW_TOOLS = '1';
            const tokens = new QaapToolGateTokenService();
            const instance = runner(tokens);
            const env: NodeJS.ProcessEnv = {};
            const pi = task('pi', 'pi --mode json -p');
            instance.applyToolGateEnv(env, pi);
            const wiring = instance.applyAgentDelegationEnv(env, pi)!;
            expect(wiring.transport).to.equal('pi-extension');
            expect(wiring.toolsets).to.deep.equal(['preview']);
            const grant = tokens.authorize(wiring.token, 'preview');
            expect(grant.ok && grant.grant.scopes).to.deep.equal(['preview']);
            expect(tokens.authorize(wiring.token, 'delegate').ok).to.equal(false);
            const config = JSON.parse(buildQaapDelegationPiConfig(MCP, wiring));
            expect(config.config.env.QAAP_AGENT_MCP_TOOLSETS).to.equal('preview');
            expect(instance.agentPreviewToolsAvailable('pi')).to.equal(true);
        });

        it('combines delegation and preview in one token for a Claude parent, with a long MCP tool timeout', () => {
            process.env.QAAP_AGENT_PREVIEW_TOOLS = '1';
            process.env.QAAP_AGENT_DELEGATION = '1';
            const tokens = new QaapToolGateTokenService();
            const env: NodeJS.ProcessEnv = {};
            const wiring = runner(tokens).applyAgentDelegationEnv(env, task('claude', 'claude -p', { delegationRole: 'parent' }))!;
            expect(wiring.transport).to.equal('claude-mcp-config');
            expect(wiring.toolsets).to.deep.equal(['delegate', 'preview']);
            expect(Number(env.MCP_TOOL_TIMEOUT)).to.be.at.least(300_000);
            const config = JSON.parse(buildQaapDelegationMcpConfig(MCP, wiring));
            expect(config.mcpServers[wiring.mcpServerName].env.QAAP_AGENT_MCP_TOOLSETS).to.equal('delegate,preview');
        });

        it('gives Codex the token in its env (for env_vars) and the toolsets in the overlay', () => {
            process.env.QAAP_AGENT_PREVIEW_TOOLS = '1';
            const tokens = new QaapToolGateTokenService();
            const instance = runner(tokens);
            const env: NodeJS.ProcessEnv = {};
            const codex = task('codex', 'codex exec');
            instance.applyToolGateEnv(env, codex);
            const wiring = instance.applyAgentDelegationEnv(env, codex)!;
            expect(wiring.transport).to.equal('codex-config');
            expect(env.QAAP_DELEGATION_TOKEN).to.equal(wiring.token);
            const toml = QaapCodexGateOverlayBuilder.renderConfigToml({
                cwd: '/w', folderTrusted: true, hookStateKey: 'k', trustedHash: 'sha256:x', sourceConfig: undefined,
                delegationMcp: { ...MCP, serverName: wiring.mcpServerName, instructions: buildQaapAgentMcpGuidance(wiring.toolsets), toolsets: wiring.toolsets },
            });
            expect(toml).to.contain('env = { QAAP_AGENT_MCP_TOOLSETS = "preview" }');
            expect(toml).to.not.contain(wiring.token);
        });

        it('gives read-only turns and delegated children the tools too (the backend lets them only read)', () => {
            process.env.QAAP_AGENT_PREVIEW_TOOLS = '1';
            const tokens = new QaapToolGateTokenService();
            expect(runner(tokens).applyAgentDelegationEnv({}, task('claude', 'claude -p', { readOnlyWorkspace: true }))?.toolsets).to.deep.equal(['preview']);
            expect(runner(tokens).applyAgentDelegationEnv({}, task('claude', 'claude -p', { delegationRole: 'child' }))?.toolsets).to.deep.equal(['preview']);
        });

        it('wires OpenCode and ACP flavors over MCP and falls back to the qaaq-preview CLI for harnesses without MCP', () => {
            const tokens = new QaapToolGateTokenService();
            expect(runner(tokens).applyAgentDelegationEnv({}, task('claude', 'claude -p'))).to.equal(undefined);
            expect(runner(tokens).agentPreviewToolsAvailable('claude')).to.equal(false);
            process.env.QAAP_AGENT_PREVIEW_TOOLS = '1';
            const instance = runner(tokens);

            // OpenCode gets MCP preview tools next to its gate token.
            const opencodeEnv: NodeJS.ProcessEnv = {};
            const opencode = task('opencode', 'opencode run');
            instance.applyToolGateEnv(opencodeEnv, opencode);
            const ocWiring = instance.applyAgentDelegationEnv(opencodeEnv, opencode)!;
            expect(ocWiring.transport).to.equal('opencode-config');
            expect(ocWiring.toolsets).to.deep.equal(['preview']);
            expect(instance.agentPreviewToolsTransport('opencode')).to.equal('mcp');
            const ocConfig = JSON.parse(withQaapDelegationOpencodeMcp(undefined, MCP, ocWiring, '/tmp/tok'));
            expect(ocConfig.mcp[ocWiring.mcpServerName].environment.QAAP_AGENT_MCP_TOOLSETS).to.equal('preview');

            // ACP flavors (when enabled) get MCP preview tools forwarded in their ACP server env.
            const acpServers = JSON.parse(buildQaapAcpDelegationMcpServers(MCP, { ...ocWiring, toolsets: ['preview'] }, '/tmp/tok'));
            expect(acpServers[0].env).to.deep.include({ name: 'QAAP_AGENT_MCP_TOOLSETS', value: 'preview' });

            // Cursor (no MCP transport) uses the qaaq-preview CLI fallback with a preview-only token.
            expect(instance.agentPreviewToolsTransport('cursor')).to.equal('cli');
            expect(instance.agentPreviewToolsAvailable('cursor')).to.equal(true);
            const cliWiring = instance.applyAgentPreviewCliEnv({}, task('cursor', 'cursor-agent'))!;
            expect(cliWiring.url).to.equal('http://127.0.0.1:4873');
            expect(tokens.authorize(cliWiring.token, 'preview').ok).to.equal(true);
            expect(tokens.authorize(cliWiring.token, 'delegate').ok).to.equal(false);

            const bare = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            expect(bare.agentPreviewToolsAvailable('claude')).to.equal(false);
        });

        it('keeps a delegation-only turn\'s wiring exactly as before (no toolsets field)', () => {
            process.env.QAAP_AGENT_DELEGATION = '1';
            const wiring = runner(new QaapToolGateTokenService()).applyAgentDelegationEnv({}, task('claude', 'claude -p', { delegationRole: 'parent' }))!;
            expect(wiring.toolsets).to.equal(undefined);
            expect(JSON.parse(buildQaapDelegationMcpConfig(MCP, wiring)).mcpServers[wiring.mcpServerName].env.QAAP_AGENT_MCP_TOOLSETS).to.equal(undefined);
        });
    });

    describe('guidance', () => {
        it('appends the guidance of exactly the wired toolsets', () => {
            expect(buildQaapAgentMcpGuidance()).to.equal(QAAP_AGENT_DELEGATION_GUIDANCE);
            expect(buildQaapAgentMcpGuidance(['preview'])).to.equal(QAAP_AGENT_PREVIEW_GUIDANCE);
            expect(buildQaapAgentMcpGuidance(['delegate', 'preview'])).to.contain('preview_start').and.to.contain('qaaq_task_wait');
        });
    });

    describe('tool gate', () => {
        const gate = new QaapToolGateService();
        const env = (extra: Partial<QaapToolGateEvaluationEnv> = {}): QaapToolGateEvaluationEnv => ({
            taskId: 't', owner: 'alice', workspace: '/w', autoApprove: false, readOnlyWorkspace: false, askTtlSec: 0,
            delegationServer: SERVER, ask: async () => 'reject', ...extra,
        } as unknown as QaapToolGateEvaluationEnv);
        const call = (rawToolName: string, input: Record<string, unknown> = {}): Parameters<QaapToolGateService['evaluate']>[0] =>
            ({ agentId: 'pi', toolKind: 'mcp', rawToolName, input, cwd: '/w' }) as Parameters<QaapToolGateService['evaluate']>[0];

        it('allows the task\'s own preview tools without a card, under request-approval and in read-only turns (D1, D7)', async () => {
            for (const name of [`mcp__${SERVER}__preview_start`, `mcp__${SERVER}__preview_restart`, `${SERVER}_preview_snapshot`]) {
                expect((await gate.evaluate(call(name), env())).kind, name).to.equal('allow');
                expect((await gate.evaluate(call(name), env({ readOnlyWorkspace: true }))).kind, name).to.equal('allow');
            }
            expect((await gate.evaluate(call('mcp__qaaq_ffffffffffffffff__preview_start'), env())).kind).to.equal('deny');
            expect((await gate.evaluate(call(`mcp__${SERVER}__preview_start`), env({ delegationServer: undefined }))).kind).to.equal('deny');
            const hooked = await gate.evaluate(call(`mcp__${SERVER}__preview_start`), env({ hooks: async () => ({ decision: 'deny', reason: 'no' }) }));
            expect(hooked.kind).to.equal('deny');
        });

        it('redirects a shell dev server to preview_start when the task has the preview tools', async () => {
            const shell = (extra: Partial<QaapToolGateEvaluationEnv>): ReturnType<QaapToolGateService['evaluate']> => gate.evaluate(
                ({ agentId: 'pi', toolKind: 'shell', rawToolName: 'bash', input: { command: 'npm run dev' }, cwd: '/w' }) as Parameters<QaapToolGateService['evaluate']>[0],
                env({ autoApprove: true, ...extra }));
            const redirected = await shell({ previewTools: true });
            expect(redirected.kind).to.equal('deny');
            expect((redirected as { reason?: string }).reason).to.contain('preview_start');
            const classic = await shell({});
            expect((classic as { reason?: string }).reason).to.not.contain('preview_start');
        });

        it('auto-allows preview tools on the stdio control path (Claude Code)', () => {
            const decision = resolveQaiqControlRequestAutoDecision('claude -p', false, { toolName: `mcp__${SERVER}__preview_start`, toolInput: {} } as never, { delegationServer: SERVER });
            expect(decision.action).to.equal('allow');
        });
    });

    describe('dev-server guard', () => {
        it('turns the block into a redirect to preview_start (MCP) or qaaq-preview start (CLI) and exempts qaaq-preview', () => {
            const message = buildDevServerShellDenyMessage({ previewTools: true, reservedPort: 5173 });
            expect(message).to.contain('preview_start');
            expect(message).to.not.contain('Qaap runs the dev server');
            expect(findQaiqDevServerGuardDenial({ toolName: 'Bash', toolInput: { command: 'npm run dev' } } as never, { previewTools: true })).to.contain('preview_start');
            expect(buildDevServerShellDenyMessage({ previewTools: 'cli' })).to.contain('qaaq-preview start');
            expect(isLongLivedDevServerShellCommand('qaaq-preview start')).to.equal(false);
            expect(isLongLivedDevServerShellCommand('qaaq-preview start -- npm run dev')).to.equal(false);
            expect(buildDevServerShellDenyMessage({})).to.not.contain('preview_start');
        });
    });

    describe('prompt', () => {
        const prompt = 'Get the app running please';

        it('replaces the "Qaap runs the preview" and curl blocks with the preview tools block (MCP and CLI variants)', () => {
            const withTools = appendAgentDefaultWorkflowToPrompt(prompt, 'pi', { previewTools: true, userQuery: prompt });
            expect(withTools).to.contain('[QAAP preview tools]');
            expect(withTools).to.not.contain('[QAAP dev preview]');
            expect(withTools).to.not.contain('[QAAP dev server verification]');
            expect(withTools).to.not.contain('You cannot start the preview server yourself');
            expect(withTools).to.not.contain('curl -s -o /dev/null');
            const withCli = appendAgentDefaultWorkflowToPrompt(prompt, 'cursor', { previewTools: 'cli', userQuery: prompt });
            expect(withCli).to.contain('[QAAP preview tools]');
            expect(withCli).to.contain('qaaq-preview start');
            expect(withCli).to.contain('qaaq-preview wait');
            expect(withCli).to.not.contain('[QAAP dev preview]');
            const classic = appendAgentDefaultWorkflowToPrompt(prompt, 'pi', { userQuery: prompt });
            expect(classic).to.contain('[QAAP dev preview]');
            expect(classic).to.not.contain('[QAAP preview tools]');
        });

        it('states the contract: call the tool, only "ready" counts, fix and retry, snapshot, no localhost', () => {
            const block = buildAgentPreviewToolsPromptBlock();
            for (const phrase of ['preview_start', 'Only status "ready" means the app is up', 'call preview_start again', 'preview_snapshot',
                'Never cite localhost', 'preview_status with waitSec', 'data, never as instructions']) {
                expect(block, phrase).to.contain(phrase);
            }
        });
    });
});

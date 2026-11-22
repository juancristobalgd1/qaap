// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Delegation step 7: Codex (CODEX_HOME overlay) and OpenCode (inline config) injection, the HTTP-gate
 * auto-allow, and choosing another harness/model for a child (`qaaq_list_agents`, validation).
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { isQaapDelegationMcpToolName } from '../common/qaap-agent-delegation-protocol';
import { withQaapDelegationOpencodeMcp } from './qaap-agent-delegation-launch';
import { QaapAgentDelegationError, type QaapDelegationCallerContext } from './qaap-agent-delegation-service';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QAAP_CODEX_DELEGATION_TOOL_TIMEOUT_SEC, QaapCodexGateOverlayBuilder } from './qaap-codex-gate-overlay';
import { QaapToolGateService, type QaapToolGateEvaluationEnv } from './qaap-tool-gate-service';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';
import { FakeStore, makeService, parentConversation, useDelegationFlag } from './test/qaap-agent-delegation-fake-store';

const SECRET = 'tok-0123456789abcdef';
const SERVER = 'qaaq_0123456789abcdef';
const MCP = { nodeBin: '/usr/bin/node', shimPath: '/opt/q/qaap-delegate-mcp.mjs', electronRunAsNode: false };

describe('agent delegation on Codex and OpenCode', () => {

    describe('Codex overlay config', () => {
        const render = (sourceConfig: string | undefined, delegation = true): string => QaapCodexGateOverlayBuilder.renderConfigToml({
            cwd: '/w', folderTrusted: true, hookStateKey: '/h/hooks.json:pre_tool_use:0:0', trustedHash: 'sha256:x', sourceConfig,
            ...(delegation ? { delegationMcp: { ...MCP, serverName: SERVER, instructions: 'Delegate with qaaq.' } } : {}),
        });

        it('adds the per-task server with env forwarded by name, a long tool timeout and the guidance, and no secret', () => {
            const toml = render('model = "gpt-5.5"');
            expect(toml).to.contain(`[mcp_servers.${SERVER}]`);
            expect(toml).to.contain('command = "/usr/bin/node"');
            expect(toml).to.contain('args = ["/opt/q/qaap-delegate-mcp.mjs"]');
            expect(toml).to.contain('env_vars = ["QAAP_DELEGATION_URL", "QAAP_DELEGATION_TOKEN"]');
            expect(toml).to.contain(`tool_timeout_sec = ${QAAP_CODEX_DELEGATION_TOOL_TIMEOUT_SEC}`);
            expect(QAAP_CODEX_DELEGATION_TOOL_TIMEOUT_SEC).to.be.at.least(600);
            expect(toml).to.contain('developer_instructions = "Delegate with qaaq."');
            expect(toml).to.contain('model = "gpt-5.5"');
            expect(toml).to.not.contain(SECRET);
            // `developer_instructions` is a top-level key: it must come before the first table.
            expect(toml.indexOf('developer_instructions')).to.be.lessThan(toml.indexOf('['));
        });

        it('drops every owner server whose name starts with qaaq and keeps the owner\'s single-line instructions in front of the guidance', () => {
            const toml = render([
                'developer_instructions = "Be terse."',
                '[mcp_servers.qaaq]',
                'command = "evil"',
                '[mcp_servers.qaaq.env]',
                'X = "1"',
                '[mcp_servers.qaaq_ffffffffffffffff]',
                'command = "evil2"',
                '[mcp_servers.github]',
                'command = "gh-mcp"',
            ].join('\n'));
            expect(toml).to.not.contain('evil');
            expect(toml).to.contain('[mcp_servers.github]');
            expect(toml.match(/developer_instructions/g)).to.have.length(1);
            expect(toml).to.contain(JSON.stringify('Be terse.\n\nDelegate with qaaq.'));
            expect(toml.match(/\[mcp_servers\.qaaq/g)).to.have.length(1);
        });

        it('leaves a multi-line owner value alone and omits the guidance rather than writing a duplicate key', () => {
            const toml = render('developer_instructions = """\nline one\n"""');
            expect(toml.match(/developer_instructions/g)).to.have.length(1);
            expect(toml).to.not.contain('Delegate with qaaq.');
            expect(toml).to.contain(`[mcp_servers.${SERVER}]`);
        });

        describe('shell environment policy', () => {
            const parse = (toml: string): Record<string, any> => {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-var-requires
                    return (require('smol-toml') as { parse(text: string): Record<string, any> }).parse(toml);
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
                        return {};
                    }
                    throw error;
                }
            };
            const excludeOf = (toml: string): string[] | undefined => parse(toml).shell_environment_policy?.exclude;

            it('adds a policy table that excludes QAAP_DELEGATION_* when the owner has none', () => {
                const toml = render('model = "gpt-5.5"');
                expect(toml).to.contain('[shell_environment_policy]');
                expect(toml).to.contain('exclude = ["QAAP_DELEGATION_*"]');
                expect(toml.match(/\[shell_environment_policy\]/g)).to.have.length(1);
                expect(excludeOf(toml) ?? ['QAAP_DELEGATION_*']).to.deep.equal(['QAAP_DELEGATION_*']);
            });

            it('keeps the owner\'s ignore_default_excludes and every other key, and merges single- and multi-line exclude patterns', () => {
                const table = render([
                    'model = "x"',
                    '[shell_environment_policy]',
                    'inherit = "all"',
                    'ignore_default_excludes = true',
                    'exclude = ["AWS_*", \'GH_*\']',
                    'include_only = ["PATH"]',
                    '[shell_environment_policy.set]',
                    'FOO = "1"',
                ].join('\n'));
                expect(table).to.contain('ignore_default_excludes = true');
                expect(table).to.contain('inherit = "all"').and.to.contain('include_only = ["PATH"]').and.to.contain('FOO = "1"');
                expect(table.match(/\[shell_environment_policy\]/g)).to.have.length(1);
                expect(table).to.contain('exclude = ["AWS_*","GH_*","QAAP_DELEGATION_*"]');
                const parsed = parse(table).shell_environment_policy;
                if (parsed) {
                    expect(parsed.ignore_default_excludes).to.equal(true);
                    expect(parsed.set).to.deep.equal({ FOO: '1' });
                    expect(parsed.exclude).to.deep.equal(['AWS_*', 'GH_*', 'QAAP_DELEGATION_*']);
                }
                const multi = render('[shell_environment_policy]\nexclude = [\n "A_*", # comment\n \'B_*\',\n]\ninherit = "core"');
                expect(multi).to.contain('exclude = ["A_*","B_*","QAAP_DELEGATION_*"]');
                expect(multi).to.contain('inherit = "core"');
                expect(multi.match(/^exclude =/gm)).to.have.length(1);
                expect(excludeOf(multi) ?? ['A_*', 'B_*', 'QAAP_DELEGATION_*']).to.deep.equal(['A_*', 'B_*', 'QAAP_DELEGATION_*']);
                // Already excluded by the owner: not duplicated.
                expect(render('[shell_environment_policy]\nexclude = ["QAAP_DELEGATION_*"]')).to.contain('exclude = ["QAAP_DELEGATION_*"]');
            });

            describe('owner forms that cannot be merged safely', () => {
                const forms: Record<string, string> = {
                    'an inline table': 'shell_environment_policy = { inherit = "all", ignore_default_excludes = true }',
                    'dotted keys': 'shell_environment_policy.ignore_default_excludes = true\nshell_environment_policy.exclude = [\n "X_*",\n]\nmodel = "y"',
                    'a profile table': '[profiles.work.shell_environment_policy]\ninherit = "none"',
                    'dotted keys inside a profile': '[profiles.work]\nshell_environment_policy.inherit = "none"',
                    'an exclude with a multi-line string': '[shell_environment_policy]\nexclude = ["""A_*"""]',
                    'an exclude that is not an array of strings': '[shell_environment_policy]\nexclude = "A_*"',
                };
                for (const [name, owner] of Object.entries(forms)) {
                    it(`${name}: keeps the owner's policy verbatim and injects no delegation`, () => {
                        const toml = render(owner);
                        expect(QaapCodexGateOverlayBuilder.delegationBlockedReason(owner)).to.be.a('string');
                        expect(toml).to.not.contain('mcp_servers.qaaq').and.to.not.contain('QAAP_DELEGATION').and.to.not.contain('developer_instructions');
                        for (const line of owner.split('\n')) {
                            expect(toml).to.contain(line);
                        }
                        // Byte-identical to rendering this owner config with delegation off.
                        expect(toml).to.equal(render(owner, false));
                    });
                }

                it('is logged at info level without any config content or secret, and reported to the runner', async function (): Promise<void> {
                    if (process.platform === 'win32') {
                        this.skip();
                    }
                    const info = console.info;
                    const logged: string[] = [];
                    console.info = (...args: unknown[]): void => { logged.push(args.map(String).join(' ')); };
                    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-overlay-skip-'));
                    try {
                        const home = path.join(tmp, 'home');
                        fs.mkdirSync(home);
                        fs.writeFileSync(path.join(home, 'config.toml'), 'shell_environment_policy = { inherit = "all", API_TOPSECRET = "s3cret" }');
                        const builder = new QaapCodexGateOverlayBuilder(async () => 'trusted');
                        const overlay = await builder.create({
                            taskId: 't', cwd: '/w', folderTrusted: true, sourceCodexHome: home, askTtlSec: 60, overlayRoot: path.join(tmp, 'ov'),
                            nodeBin: '/usr/bin/node', hookPath: '/h.mjs', delegationMcp: { ...MCP, serverName: SERVER, instructions: 'x' },
                        });
                        expect(overlay.delegationSkipped).to.equal(true);
                        const text = fs.readFileSync(path.join(overlay.codexHome, 'config.toml'), 'utf8');
                        expect(text).to.not.contain(`mcp_servers.${SERVER}`);
                        overlay.dispose();
                        const plain = await builder.create({
                            taskId: 't2', cwd: '/w', folderTrusted: true, sourceCodexHome: home, askTtlSec: 60, overlayRoot: path.join(tmp, 'ov'),
                            nodeBin: '/usr/bin/node', hookPath: '/h.mjs',
                        });
                        expect(plain.delegationSkipped).to.equal(undefined);
                        plain.dispose();
                    } finally {
                        console.info = info;
                        fs.rmSync(tmp, { recursive: true, force: true });
                    }
                    expect(logged.join('\n')).to.contain('delegation not injected').and.to.not.contain('s3cret').and.to.not.contain('API_TOPSECRET');
                });
            });

            it('leaves the owner\'s policy alone without delegation', () => {
                const toml = render('[shell_environment_policy]\nignore_default_excludes = true', false);
                expect(toml).to.contain('ignore_default_excludes = true').and.to.not.contain('QAAP_DELEGATION_');
            });
        });

        it('with delegation off the whole overlay config is byte-identical to the pre-delegation output', () => {
            const owner = 'model = "x"\n[shell_environment_policy]\nignore_default_excludes = true\nexclude = [\n "A_*",\n]\n[mcp_servers.qaaq]\ncommand = "mine"';
            const input = { cwd: '/w', folderTrusted: false, hookStateKey: '/h/hooks.json:pre_tool_use:0:0', trustedHash: 'sha256:x', sourceConfig: owner };
            expect(QaapCodexGateOverlayBuilder.renderConfigToml(input)).to.equal([
                '# Generated by Qaap for one task. Never edit: deleted when the task ends.',
                'approval_policy = "never"',
                'sandbox_mode = "workspace-write"',
                '',
                owner,
                '',
                '[projects."/w"]',
                'trust_level = "untrusted"',
                '',
                '[hooks.state."/h/hooks.json:pre_tool_use:0:0"]',
                'trusted_hash = "sha256:x"',
                '',
            ].join('\n'));
            expect(QaapCodexGateOverlayBuilder.renderConfigToml({ ...input, sourceConfig: undefined })).to.equal([
                '# Generated by Qaap for one task. Never edit: deleted when the task ends.',
                'approval_policy = "never"',
                'sandbox_mode = "workspace-write"',
                '',
                '[projects."/w"]',
                'trust_level = "untrusted"',
                '',
                '[hooks.state."/h/hooks.json:pre_tool_use:0:0"]',
                'trusted_hash = "sha256:x"',
                '',
            ].join('\n'));
        });

        it('changes nothing without delegation, not even an owner server named qaaq (flag off = zero impact)', () => {
            const toml = render('model = "x"\n[mcp_servers.qaaq]\ncommand = "mine"', false);
            expect(toml).to.contain('[mcp_servers.qaaq]').and.to.contain('command = "mine"');
            expect(toml).to.not.contain('developer_instructions');
        });
    });

    describe('OpenCode inline config', () => {

        it('adds the per-task server next to the gate plugin and the owner servers, dropping owner servers named qaaq*', () => {
            const inherited = JSON.stringify({
                plugin: ['file:///gate.mjs'],
                mcp: { github: { type: 'remote' }, qaaq: { type: 'local', command: ['evil'] }, 'qaaq-qaaq': { type: 'local', command: ['evil2'] } },
            });
            const config = JSON.parse(withQaapDelegationOpencodeMcp(inherited, MCP, { mcpServerName: SERVER, url: 'http://127.0.0.1:4873', token: SECRET }, '/tmp/qaap-agent-prompt-delegation-x/token'));
            expect(JSON.stringify(config), 'the inline config never holds the token').to.not.contain(SECRET);
            expect(config.plugin).to.deep.equal(['file:///gate.mjs']);
            expect(Object.keys(config.mcp).sort()).to.deep.equal(['github', SERVER].sort());
            expect(config.mcp[SERVER]).to.deep.equal({
                type: 'local',
                command: ['/usr/bin/node', '/opt/q/qaap-delegate-mcp.mjs'],
                environment: { QAAP_DELEGATION_URL: 'http://127.0.0.1:4873', QAAP_DELEGATION_TOKEN_FILE: '/tmp/qaap-agent-prompt-delegation-x/token' },
                enabled: true,
            });
            expect(JSON.parse(withQaapDelegationOpencodeMcp('{not json', MCP, { mcpServerName: SERVER, url: 'u', token: 't' }, '/f')).mcp[SERVER].type).to.equal('local');
        });

        it('declares the transport for each harness', () => {
            expect(resolveQaapHarnessCapabilities('claude').delegateMcp).to.equal('claude-mcp-config');
            expect(resolveQaapHarnessCapabilities('codex').delegateMcp).to.equal('codex-config');
            expect(resolveQaapHarnessCapabilities('opencode').delegateMcp).to.equal('opencode-config');
            expect(resolveQaapHarnessCapabilities('pi').delegateMcp).to.equal('pi-extension');
            for (const agentId of ['qaiq', 'gemini', 'copilot', 'grok']) {
                expect(resolveQaapHarnessCapabilities(agentId).delegateMcp ?? 'none', agentId).to.equal('none');
            }
        });
    });

    describe('Codex delegation token', () => {
        const saved = process.env.QAAP_AGENT_DELEGATION;
        afterEach(() => {
            if (saved === undefined) {
                delete process.env.QAAP_AGENT_DELEGATION;
            } else {
                process.env.QAAP_AGENT_DELEGATION = saved;
            }
        });
        function runner(tokens: QaapToolGateTokenService): QaapAgentTaskRunner {
            const instance = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            Object.assign(instance, { helperApiUrl: 'http://127.0.0.1:4873/qaap/api/agent-tasks', toolGateTokens: tokens, tenantSpawn: { agentSandboxFor: () => undefined } });
            return instance;
        }
        const codexTask = (delegationRole?: 'parent' | 'child'): QaapAgentTask =>
            ({ id: 'task-c', cwd: '/w', ownerLogin: 'alice', command: 'codex exec', agentId: 'codex', ...(delegationRole ? { delegationRole } : {}) }) as QaapAgentTask;

        it('keeps the gate token plain and issues a SEPARATE delegate-only token for a Codex parent, exposed to Codex for env_vars', () => {
            process.env.QAAP_AGENT_DELEGATION = '1';
            const tokens = new QaapToolGateTokenService();
            const instance = runner(tokens);
            const env: NodeJS.ProcessEnv = {};
            instance.applyToolGateEnv(env, codexTask('parent'));
            expect(env.QAAP_GATE_TOKEN).to.be.a('string');
            expect(tokens.authorize(env.QAAP_GATE_TOKEN, 'delegate').ok, 'gate token has no delegate scope').to.equal(false);
            const wiring = instance.applyAgentDelegationEnv(env, codexTask('parent'));
            expect(wiring?.transport).to.equal('codex-config');
            expect(env.QAAP_DELEGATION_TOKEN).to.equal(wiring?.token);
            expect(env.QAAP_DELEGATION_TOKEN).to.not.equal(env.QAAP_GATE_TOKEN);
            expect(env.QAAP_DELEGATION_URL).to.equal('http://127.0.0.1:4873');
            const grant = tokens.authorize(env.QAAP_DELEGATION_TOKEN, 'delegate');
            expect(grant.ok && grant.grant.scopes).to.deep.equal(['delegate']);
            // The delegation token is not a gate token: it cannot evaluate tool calls.
            expect(tokens.resolve(env.QAAP_DELEGATION_TOKEN)).to.equal(undefined);
        });

        it('wires nothing for a child, with the flag off, or without a gate token', () => {
            const tokens = new QaapToolGateTokenService();
            const instance = runner(tokens);
            for (const [flag, role] of [['1', 'child'], [undefined, 'parent']] as const) {
                if (flag) {
                    process.env.QAAP_AGENT_DELEGATION = flag;
                } else {
                    delete process.env.QAAP_AGENT_DELEGATION;
                }
                const env: NodeJS.ProcessEnv = {};
                instance.applyToolGateEnv(env, codexTask(role));
                expect(instance.applyAgentDelegationEnv(env, codexTask(role)), `${flag}/${role}`).to.equal(undefined);
                expect(env.QAAP_DELEGATION_TOKEN).to.equal(undefined);
            }
            process.env.QAAP_AGENT_DELEGATION = '1';
            expect(instance.applyAgentDelegationEnv({}, codexTask('parent')), 'no gate token, no delegation').to.equal(undefined);
        });
    });

    describe('Pi delegation wiring', () => {
        const saved = process.env.QAAP_AGENT_DELEGATION;
        afterEach(() => {
            if (saved === undefined) {
                delete process.env.QAAP_AGENT_DELEGATION;
            } else {
                process.env.QAAP_AGENT_DELEGATION = saved;
            }
        });
        const runner = (tokens: QaapToolGateTokenService): QaapAgentTaskRunner => {
            const instance = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
            Object.assign(instance, { helperApiUrl: 'http://127.0.0.1:4873/qaap/api/agent-tasks', toolGateTokens: tokens, tenantSpawn: { agentSandboxFor: () => undefined } });
            return instance;
        };
        const piTask = (extra: Partial<QaapAgentTask> = {}): QaapAgentTask =>
            ({ id: 'task-p', cwd: '/w', ownerLogin: 'alice', command: 'pi --mode json -p', agentId: 'pi', delegationRole: 'parent', ...extra }) as QaapAgentTask;

        it('issues a separate delegate-only token for a Pi parent and puts none of it in Pi\'s environment', () => {
            process.env.QAAP_AGENT_DELEGATION = '1';
            const tokens = new QaapToolGateTokenService();
            const instance = runner(tokens);
            const env: NodeJS.ProcessEnv = {};
            instance.applyToolGateEnv(env, piTask());
            const before = Object.keys(env);
            const wiring = instance.applyAgentDelegationEnv(env, piTask());
            expect(wiring?.transport).to.equal('pi-extension');
            expect(wiring?.mcpServerName).to.match(/^qaaq_[0-9a-f]{16}$/);
            expect(wiring?.token).to.not.equal(env.QAAP_GATE_TOKEN);
            expect(tokens.authorize(wiring?.token, 'delegate').ok).to.equal(true);
            expect(tokens.resolve(wiring?.token)).to.equal(undefined);
            expect(env.QAAP_DELEGATION_TOKEN).to.equal(undefined);
            expect(env.QAAP_DELEGATION_URL).to.equal(undefined);
            expect(Object.values(env)).to.not.include(wiring?.token);
            expect(Object.keys(env).filter(key => !before.includes(key) && !key.toLowerCase().includes('proxy'))).to.deep.equal([]);
        });

        it('wires nothing with the flag off (env untouched), for a child, a read-only turn or without a gate token', () => {
            const tokens = new QaapToolGateTokenService();
            const instance = runner(tokens);
            const gated = (): NodeJS.ProcessEnv => {
                const env: NodeJS.ProcessEnv = {};
                instance.applyToolGateEnv(env, piTask());
                return env;
            };
            delete process.env.QAAP_AGENT_DELEGATION;
            const off = gated();
            const snapshot = JSON.stringify(off);
            expect(instance.applyAgentDelegationEnv(off, piTask())).to.equal(undefined);
            expect(JSON.stringify(off)).to.equal(snapshot);
            expect(tokens.delegationServerName('task-p')).to.equal(undefined);
            process.env.QAAP_AGENT_DELEGATION = '1';
            expect(instance.applyAgentDelegationEnv(gated(), piTask({ delegationRole: 'child' }))).to.equal(undefined);
            expect(instance.applyAgentDelegationEnv(gated(), piTask({ readOnlyWorkspace: true }))).to.equal(undefined);
            expect(instance.applyAgentDelegationEnv({}, piTask()), 'no gate token, no delegation').to.equal(undefined);
        });

        it('lets the Pi extension gate allow only the task\'s own delegation tools, with child_apply asking without autoApprove', async () => {
            const gate = new QaapToolGateService();
            const base = { taskId: 't', owner: 'alice', workspace: '/w', autoApprove: false, readOnlyWorkspace: false, askTtlSec: 0, delegationServer: SERVER, ask: async () => 'reject' };
            const evaluate = (rawToolName: string, extra: Record<string, unknown> = {}): ReturnType<QaapToolGateService['evaluate']> =>
                gate.evaluate({ agentId: 'pi', toolKind: 'other', rawToolName, input: { prompt: 'x' }, cwd: '/w' } as Parameters<QaapToolGateService['evaluate']>[0],
                    { ...base, ...extra } as unknown as QaapToolGateEvaluationEnv);
            expect((await evaluate(`mcp__${SERVER}__qaaq_delegate`)).kind).to.equal('allow');
            expect((await evaluate('mcp__qaaq_ffffffffffffffff__qaaq_delegate')).kind).to.equal('deny');
            expect((await evaluate(`mcp__${SERVER}__qaaq_child_apply`)).kind).to.equal('deny');
            expect((await evaluate(`mcp__${SERVER}__qaaq_child_apply`, { autoApprove: true })).kind).to.equal('allow');
            expect((await evaluate(`mcp__${SERVER}__qaaq_delegate`, { readOnlyWorkspace: true })).kind).to.not.equal('allow');
            const hooked = await evaluate(`mcp__${SERVER}__qaaq_delegate`, { hooks: async () => ({ decision: 'deny', reason: 'no' }) });
            expect((hooked as { source?: string }).source).to.equal('hook');
        });
    });

    describe('HTTP gate (Codex hook, OpenCode plugin)', () => {
        const gate = new QaapToolGateService();
        const env = (delegationServer: string | undefined, extra: Partial<QaapToolGateEvaluationEnv> = {}): QaapToolGateEvaluationEnv => ({
            taskId: 't', owner: 'alice', workspace: '/w', autoApprove: false, readOnlyWorkspace: false, askTtlSec: 0,
            ...(delegationServer ? { delegationServer } : {}), ask: async () => 'reject', ...extra,
        } as unknown as QaapToolGateEvaluationEnv);
        const call = (rawToolName: string): Parameters<QaapToolGateService['evaluate']>[0] =>
            ({ agentId: 'codex', toolKind: 'mcp', rawToolName, input: { prompt: 'x' }, cwd: '/w' }) as Parameters<QaapToolGateService['evaluate']>[0];

        it('allows the delegation tools of exactly the task\'s server without a card, and only those', async () => {
            for (const name of [`mcp__${SERVER}__qaaq_delegate`, `${SERVER}_qaaq_task_wait`, `mcp__${SERVER}__qaaq_list_agents`]) {
                expect((await gate.evaluate(call(name), env(SERVER))).kind, name).to.equal('allow');
                expect((await gate.evaluate(call(name), env(undefined))).kind, name).to.equal('deny');
            }
            for (const name of [`mcp__${SERVER}__run_shell`, 'mcp__qaaq__qaaq_delegate', 'qaaq_qaaq_delegate', 'qaaq-qaaq_delegate',
                'mcp__qaaq_ffffffffffffffff__qaaq_delegate']) {
                expect((await gate.evaluate(call(name), env(SERVER))).kind, name).to.equal('deny');
            }
            expect(isQaapDelegationMcpToolName('qaaq_qaaq_delegate', 'qaaq')).to.equal(false);
        });

        it('gates qaaq_child_apply like an edit: no auto-allow under request-approval, allowed when edits are auto-approved', async () => {
            for (const name of [`mcp__${SERVER}__qaaq_child_apply`, `${SERVER}_qaaq_child_apply`]) {
                expect((await gate.evaluate(call(name), env(SERVER, { autoApprove: false }))).kind, name).to.equal('deny');
                const asked: string[] = [];
                const approved = await gate.evaluate(call(name), env(SERVER, { autoApprove: false, askTtlSec: 30, ask: async () => { asked.push(name); return 'approve'; } }));
                expect(approved.kind).to.equal('allow');
                expect((approved as { source?: string }).source).to.equal('user');
                expect(asked, 'a card was shown').to.have.length(1);
                const auto = await gate.evaluate(call(name), env(SERVER, { autoApprove: true }));
                expect(auto.kind).to.equal('allow');
                expect((auto as { source?: string }).source).to.equal('policy');
            }
        });

        it('never auto-allows in a read-only workspace, and a PreToolUse hook deny wins', async () => {
            expect((await gate.evaluate(call(`mcp__${SERVER}__qaaq_delegate`), env(SERVER, { readOnlyWorkspace: true }))).kind).to.not.equal('allow');
            const hooked = env(SERVER, { hooks: async () => ({ decision: 'deny', reason: 'no delegation here' }) } as Partial<QaapToolGateEvaluationEnv>);
            const decision = await gate.evaluate(call(`mcp__${SERVER}__qaaq_delegate`), hooked);
            expect(decision.kind).to.equal('deny');
            expect((decision as { source?: string }).source).to.equal('hook');
        });
    });

    describe('choosing the child\'s harness and model', () => {
        useDelegationFlag();
        const CTX: QaapDelegationCallerContext = { parentConversationId: 'parent', ownerLogin: 'alice', parentTurnId: 'turn-1' };
        let store: FakeStore;

        beforeEach(() => {
            store = new FakeStore();
            store.conversations.set('parent', parentConversation({ autoApprove: undefined, approvalPolicyId: undefined }));
        });

        const codeOf = async (promise: Promise<unknown>): Promise<string | undefined> => {
            try {
                await promise;
                return undefined;
            } catch (error) {
                return error instanceof QaapAgentDelegationError ? error.code : String(error);
            }
        };

        it('lists connected harnesses with their available models, never shell, and marks the current one', () => {
            store.disconnectedAgents.add('pi');
            const { service } = makeService(store);
            const agents = service.listAgents(CTX).agents;
            expect(agents.map(agent => agent.agent)).to.not.include('shell');
            const codex = agents.find(agent => agent.agent === 'codex')!;
            expect(codex.selectable).to.equal(true);
            expect(codex.models).to.deep.equal([{ model: 'gpt-5.5', label: 'GPT-5.5' }]);
            expect(agents.find(agent => agent.agent === 'pi')).to.include({ selectable: false, reason: 'not-connected' });
            expect(agents.find(agent => agent.agent === 'claude')!.current).to.equal(true);
        });

        it('starts a child on another connected harness with one of its listed models', async () => {
            const { service } = makeService(store);
            const child = (await service.delegate(CTX, { prompt: 'review', agent: 'codex', model: 'gpt-5.5' })).child;
            expect(child.agent).to.equal('codex');
            expect(store.conversations.get(child.childId)!.agentModel).to.deep.equal({ provider: 'openai', vendor: 'openai', modelId: 'gpt-5.5' });
        });

        it('refuses a disconnected harness, an unavailable or unknown model', async () => {
            store.disconnectedAgents.add('pi');
            const { service } = makeService(store);
            expect(await codeOf(service.delegate(CTX, { prompt: 'x', agent: 'pi' }))).to.equal('unsupported-agent');
            expect(await codeOf(service.delegate(CTX, { prompt: 'x', agent: 'codex', model: 'gpt-pro' }))).to.equal('unsupported-agent');
            expect(await codeOf(service.delegate(CTX, { prompt: 'x', agent: 'codex', model: 'nope' }))).to.equal('unsupported-agent');
            expect(store.conversations.size).to.equal(1);
        });

        it('under request-approval lists a harness that cannot ask as not selectable and refuses it', async () => {
            store.conversations.set('parent', parentConversation({ autoApprove: false }));
            const { service } = makeService(store);
            expect(service.listAgents(CTX).agents.find(agent => agent.agent === 'qwen')).to.include({ selectable: false, reason: 'cannot-ask' });
            expect(await codeOf(service.delegate(CTX, { prompt: 'x', agent: 'qwen' }))).to.equal('unsupported-agent');
        });
    });
});

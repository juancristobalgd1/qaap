// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { releaseQaapDelegationMcpConfigFile } from '../../qaap-agent-delegation-launch';
import {
    buildQaapAcpBridgeArgv,
    buildQaapAcpDelegationMcpServers,
    extractQaapAcpPromptFileFromCommand,
    extractQaapAcpModelFromCommand,
    resolveQaapAcpBridgePath,
    resolveQaapAcpFlavor,
    resolveQaapAcpGateClientPath,
    resolveQaapAcpSpawnCommand,
} from './qaap-acp-bridge-launch';

const quote = (value: string): string => `'${value.replace(/'/g, '\'\\\'\'')}'`;

describe('qaap-acp-bridge-launch', () => {

    it('turns a harness to ACP only when its own flag is exactly 1', () => {
        expect(resolveQaapAcpFlavor('opencode', {})).to.equal(undefined);
        expect(resolveQaapAcpFlavor('opencode', { QAAP_HARNESS_ACP_OPENCODE: '1' })).to.equal('opencode');
        expect(resolveQaapAcpFlavor(' OpenCode ', { QAAP_HARNESS_ACP_OPENCODE: '1' })).to.equal('opencode');
        expect(resolveQaapAcpFlavor('opencode', { QAAP_HARNESS_ACP_OPENCODE: 'true' })).to.equal(undefined);
        expect(resolveQaapAcpFlavor('opencode', { QAAP_HARNESS_ACP_COPILOT: '1' })).to.equal(undefined);
        expect(resolveQaapAcpFlavor('copilot', { QAAP_HARNESS_ACP_COPILOT: '1' })).to.equal('copilot');
        expect(resolveQaapAcpFlavor('grok', { QAAP_HARNESS_ACP_GROK: '1' })).to.equal('grok');
        expect(resolveQaapAcpFlavor('grok', { QAAP_HARNESS_ACP_COPILOT: '1' })).to.equal(undefined);
        // `gemini` is an alias of Antigravity.
        expect(resolveQaapAcpFlavor('antigravity', { QAAP_HARNESS_ACP_ANTIGRAVITY: '1' })).to.equal('antigravity');
        expect(resolveQaapAcpFlavor('gemini', { QAAP_HARNESS_ACP_ANTIGRAVITY: '1' })).to.equal('antigravity');
        expect(resolveQaapAcpFlavor('antigravity', {})).to.equal(undefined);
        for (const id of ['claude', 'codex', 'pi', 'my-opencode', undefined]) {
            expect(resolveQaapAcpFlavor(id, { QAAP_HARNESS_ACP_OPENCODE: '1', QAAP_HARNESS_ACP_COPILOT: '1' }), String(id)).to.equal(undefined);
        }
    });

    it('builds the argv with the flavor, mode, gate client, model and the agent command after --', () => {
        expect(buildQaapAcpBridgeArgv({ flavor: 'opencode', nodeBin: 'node', bridgePath: '/r/b.mjs', gateClientPath: '/r/g.mjs', mode: 'ask', model: 'a/b' }))
            .to.deep.equal(['node', '/r/b.mjs', '--flavor', 'opencode', '--mode', 'ask', '--gate-client', '/r/g.mjs', '--model', 'a/b', '--', 'opencode', 'acp']);
        expect(buildQaapAcpBridgeArgv({ flavor: 'copilot', nodeBin: 'node', bridgePath: 'b', gateClientPath: 'g', mode: 'readonly', agentBin: '/opt/copilot' }))
            .to.deep.equal(['node', 'b', '--flavor', 'copilot', '--mode', 'readonly', '--gate-client', 'g', '--', '/opt/copilot', '--acp']);
    });

    it('starts Grok in its asking permission mode and passes the MCP server file and the prompt file', () => {
        expect(buildQaapAcpBridgeArgv({
            flavor: 'grok', nodeBin: 'node', bridgePath: 'b', gateClientPath: 'g', mode: 'ask', mcpServersFile: '/s/acp-mcp.json', promptFile: '/t/prompt.txt',
        })).to.deep.equal(['node', 'b', '--flavor', 'grok', '--mode', 'ask', '--gate-client', 'g', '--mcp-servers', '/s/acp-mcp.json', '--prompt-file', '/t/prompt.txt',
            '--', 'grok', '--permission-mode', 'default', 'agent', 'stdio']);
    });

    it('reads the prompt file of the native command line', () => {
        expect(extractQaapAcpPromptFileFromCommand('grok -m grok-4 -p --prompt-file /tmp/qaap-agent-prompt-ab/prompt.txt')).to.equal('/tmp/qaap-agent-prompt-ab/prompt.txt');
        expect(extractQaapAcpPromptFileFromCommand("grok -p --prompt-file '/tmp/a b/it'\\''s.txt'")).to.equal("/tmp/a b/it's.txt");
        expect(extractQaapAcpPromptFileFromCommand('copilot -p x')).to.equal(undefined);
        // The runner appends its own flag last: an earlier one (inside a model name) is never taken.
        expect(extractQaapAcpPromptFileFromCommand("grok -m 'x --prompt-file /etc/passwd' -p --prompt-file /t/real.txt")).to.equal('/t/real.txt');
        const command = resolveQaapAcpSpawnCommand({ flavor: 'grok', taskId: 't', command: "grok -p --prompt-file '/t/p.txt'", env: {}, quoteShellArg: quote });
        expect(command).to.contain('\'--prompt-file\' \'/t/p.txt\'');
    });

    it('builds the session/new delegation server with the token file path, never the token', () => {
        const json = buildQaapAcpDelegationMcpServers({ nodeBin: 'node', shimPath: '/s/qaap-delegate-mcp.mjs', electronRunAsNode: false },
            { mcpServerName: 'qaaq_ab12', url: 'http://10.0.0.2:3000' }, '/s/token');
        expect(JSON.parse(json)).to.deep.equal([{
            name: 'qaaq_ab12', command: 'node', args: ['/s/qaap-delegate-mcp.mjs'],
            env: [{ name: 'QAAP_DELEGATION_URL', value: 'http://10.0.0.2:3000' }, { name: 'QAAP_DELEGATION_TOKEN_FILE', value: '/s/token' }],
        }]);
    });

    it('reads the model of the native command line', () => {
        expect(extractQaapAcpModelFromCommand('opencode run --format json --model openrouter/x-ai/grok')).to.equal('openrouter/x-ai/grok');
        expect(extractQaapAcpModelFromCommand("opencode run --model 'a/b c'")).to.equal('a/b c');
        expect(extractQaapAcpModelFromCommand('opencode run --model=a/b --print-logs')).to.equal('a/b');
        expect(extractQaapAcpModelFromCommand('copilot -m gpt-5 -p x')).to.equal('gpt-5');
        expect(extractQaapAcpModelFromCommand('opencode run --format json')).to.equal(undefined);
        expect(extractQaapAcpModelFromCommand('opencode run --models-dir x')).to.equal(undefined);
    });

    it('runs the shipped bridge on the host, with the mode of the turn and no secret on the command line', () => {
        const env: NodeJS.ProcessEnv = { QAAP_GATE_TOKEN: 'secret' };
        const command = resolveQaapAcpSpawnCommand({
            flavor: 'opencode', taskId: 't1', command: 'opencode run --model a/b {prompt}', autoApprove: false, env, quoteShellArg: quote,
        });
        expect(command).to.contain(quote(resolveQaapAcpBridgePath()));
        expect(command).to.contain(quote(resolveQaapAcpGateClientPath()));
        expect(command).to.contain('\'--mode\' \'ask\'');
        expect(command).to.contain('\'--model\' \'a/b\'');
        expect(command).to.not.contain('secret');
        expect(resolveQaapAcpSpawnCommand({ flavor: 'opencode', taskId: 't1', command: 'x', autoApprove: true, env, quoteShellArg: quote })).to.contain('\'--mode\' \'auto\'');
        expect(resolveQaapAcpSpawnCommand({ flavor: 'opencode', taskId: 't1', command: 'x', readOnlyWorkspace: true, autoApprove: true, env, quoteShellArg: quote }))
            .to.contain('\'--mode\' \'readonly\'');
    });

    it('stages fresh private copies below the sandbox shared root and releases them with the task', () => {
        const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-acp-shared-'));
        try {
            const command = resolveQaapAcpSpawnCommand({
                flavor: 'opencode', taskId: 'sandboxed', command: 'opencode run', autoApprove: false,
                sandbox: { name: 'sb', sharedRoot }, env: {}, quoteShellArg: quote,
            });
            const staged = [...command.matchAll(/'([^']+\.mjs)'/g)].map(match => match[1]);
            expect(staged).to.have.length(2);
            for (const file of staged) {
                expect(file.startsWith(path.join(sharedRoot, '.qaap-delegation'))).to.equal(true);
                if (process.platform !== 'win32') {
                    // Windows has no POSIX modes; the private directory's ACL protects the copy there.
                    expect(fs.statSync(file).mode & 0o777).to.equal(0o600);
                }
            }
            expect(fs.readFileSync(staged[0], 'utf8')).to.equal(fs.readFileSync(resolveQaapAcpBridgePath(), 'utf8'));
            expect(fs.readFileSync(staged[1], 'utf8')).to.equal(fs.readFileSync(resolveQaapAcpGateClientPath(), 'utf8'));
            expect(command.startsWith('\'node\' ')).to.equal(true);
            releaseQaapDelegationMcpConfigFile('sandboxed');
            for (const file of staged) {
                expect(fs.existsSync(file)).to.equal(false);
            }
        } finally {
            fs.rmSync(sharedRoot, { recursive: true, force: true });
        }
    });

    it('pins the gate client bytes on the command line and refuses to run outside a sandbox when one is required', () => {
        const command = resolveQaapAcpSpawnCommand({ flavor: 'copilot', taskId: 't', command: 'x', env: {}, quoteShellArg: quote });
        expect(command).to.match(/'--gate-client-sha256' '[0-9a-f]{64}'/);
        expect(() => resolveQaapAcpSpawnCommand({ flavor: 'copilot', taskId: 't', command: 'x', env: {}, quoteShellArg: quote, requireSandbox: true }))
            .to.throw(/only inside a task sandbox/);
    });

    it('refuses a sandbox that shares no directory with the backend', () => {
        expect(() => resolveQaapAcpSpawnCommand({
            flavor: 'opencode', taskId: 't', command: 'x', sandbox: { name: 'sb' }, env: {}, quoteShellArg: quote,
        })).to.throw(/shares no directory/);
    });
});

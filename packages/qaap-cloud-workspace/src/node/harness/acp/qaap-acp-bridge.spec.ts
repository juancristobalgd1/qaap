// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawn, type ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { QaapQaiqStreamAccumulator } from '@theia/qaap-shared-core/lib/common/qaap-qaiq-stream';
import { resolveQaapCloudWorkspaceResource } from '../../qaap-cloud-workspace-resource';
import { QAAP_ACP_BRIDGE_FILE, resolveQaapAcpBridgePath, resolveQaapAcpGateClientPath } from './qaap-acp-bridge-launch';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface BridgeModule {
    EXIT: Record<string, number>;
    FLAVORS: Record<string, any>;
    MAX_MESSAGES_PER_SECOND: number;
    parseBridgeArgs(argv: string[]): { flavor: string; model?: string; mode: string; gateClient?: string; agentArgv: string[] };
    buildAgentEnv(env: Record<string, string>, flavor: any): Record<string, string>;
    choosePermissionOption(options: unknown, allow: boolean): { outcome: string; optionId?: string };
    canonicalToolInput(kind: string, rawInput: unknown, locations: unknown, cwd: string): Record<string, string>;
    exitForStopReason(stopReason: string): number;
    gateToolName(flavor: any, kind: string, nativeName: string): string;
    refusePermissionLocally(mode: string, kind: string, input: Record<string, string>): string | undefined;
    parseMcpServers(text: string): unknown[];
    isOwnDelegationToolCall(kind: string, names: unknown[], serverNames: string[]): boolean;
    buildAgentArgv(flavor: any, argv: string[], env: Record<string, string | undefined>): string[];
    startMcpHttpProxy(servers: unknown[], spawnServer: (entry: any) => ChildProcess): Promise<{ entries: any[]; close(): void }>;
    AcpStreamTranslator: new (flavor: any) => any;
    LimitedLineReader: new (onMessage: (message: unknown) => void, onViolation: (reason: string) => void, now?: () => number) => { push(chunk: string): void };
}

// The bridge is plain ESM; TypeScript would turn a literal import() into require().
// eslint-disable-next-line no-new-func
const importModule = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<BridgeModule>;

const FAKE_AGENT = path.resolve(__dirname, '..', '..', '..', '..', 'test-resources', 'acp', 'qaap-fake-acp-agent.mjs');

interface BridgeRun {
    code: number | null;
    stdout: string;
    stderr: string;
    lines: any[];
}

/** Sends SIGTERM to the bridge once the fake agent recorded the prompt (a fixed delay is flaky on slow CI runners). */
function killOncePrompted(record: string, pid: number, onKill?: () => void): void {
    const poll = setInterval(() => {
        let recorded = '';
        try {
            recorded = fs.readFileSync(record, 'utf8');
        } catch {
            return;
        }
        if (recorded.includes('"session/prompt"')) {
            clearInterval(poll);
            setTimeout(() => {
                onKill?.();
                process.kill(pid, 'SIGTERM');
            }, 100);
        }
    }, 20);
    setTimeout(() => clearInterval(poll), 15000).unref();
}

function runBridge(args: string[], env: NodeJS.ProcessEnv, prompt = 'hello', onSpawn?: (pid: number) => void): Promise<BridgeRun> {
    return new Promise(resolve => {
        const child = spawn(process.execPath, [resolveQaapAcpBridgePath(), ...args], { env, cwd: os.tmpdir() });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', chunk => stdout += chunk);
        child.stderr.on('data', chunk => stderr += chunk);
        child.on('close', code => resolve({
            code, stdout, stderr,
            lines: stdout.split('\n').filter(line => line.trim().startsWith('{')).map(line => JSON.parse(line)),
        }));
        child.stdin.end(prompt);
        if (child.pid !== undefined) {
            onSpawn?.(child.pid);
        }
    });
}

describe('qaap-acp-bridge.mjs', function (): void {
    this.timeout(20000);

    let bridge: BridgeModule;

    before(async () => {
        bridge = await importModule(pathToFileURL(resolveQaapAcpBridgePath()).toString());
    });

    it('ships as a resource of the package', () => {
        expect(resolveQaapAcpBridgePath()).to.equal(resolveQaapCloudWorkspaceResource(QAAP_ACP_BRIDGE_FILE));
        expect(fs.existsSync(resolveQaapAcpBridgePath())).to.equal(true);
    });

    describe('arguments', () => {
        it('reads its own options before -- and the agent argv after it', () => {
            expect(bridge.parseBridgeArgs(['--flavor', 'opencode', '--model', 'a/b', '--', 'opencode', 'acp'])).to.deep.equal({
                flavor: 'opencode', model: 'a/b', mode: 'ask', gateClient: undefined, gateClientSha256: undefined, mcpServers: undefined, promptFile: undefined, agentArgv: ['opencode', 'acp'],
            });
            expect(bridge.parseBridgeArgs(['--flavor', 'copilot', '--gate-client', '/s/g.mjs', '--mode', 'readonly', '--', 'copilot', '--acp']))
                .to.deep.include({ gateClient: '/s/g.mjs', mode: 'readonly', agentArgv: ['copilot', '--acp'] });
        });

        it('refuses an unknown flavor, mode or option, and a missing agent', () => {
            for (const argv of [
                ['--flavor', 'gemini', '--', 'x'],
                ['--flavor', 'opencode', '--mode', 'yolo', '--', 'x'],
                ['--flavor', 'opencode', '--extra', '--', 'x'],
                ['--flavor', 'opencode', '--'],
                ['--flavor', 'opencode'],
                ['--flavor', '--', 'x'],
            ]) {
                expect(() => bridge.parseBridgeArgs(argv), argv.join(' ')).to.throw();
            }
        });
    });

    describe('permission options', () => {
        const options = [
            { optionId: 'a', kind: 'allow_once', name: 'Allow' },
            { optionId: 'b', kind: 'allow_always', name: 'Always' },
            { optionId: 'c', kind: 'reject_once', name: 'Reject' },
        ];

        it('grants only with allow_once and never picks allow_always', () => {
            expect(bridge.choosePermissionOption(options, true)).to.deep.equal({ outcome: 'selected', optionId: 'a' });
            expect(bridge.choosePermissionOption([options[1], options[2]], true)).to.deep.equal({ outcome: 'cancelled' });
        });

        it('rejects with reject_once, then reject_always, else cancels', () => {
            expect(bridge.choosePermissionOption(options, false)).to.deep.equal({ outcome: 'selected', optionId: 'c' });
            expect(bridge.choosePermissionOption([{ optionId: 'r', kind: 'reject_always' }], false)).to.deep.equal({ outcome: 'selected', optionId: 'r' });
            expect(bridge.choosePermissionOption([options[0]], false)).to.deep.equal({ outcome: 'cancelled' });
        });

        it('chooses by kind, never by label or id, and cancels on ambiguity or garbage', () => {
            const lying = [{ optionId: 'reject', kind: 'allow_once', name: 'Reject' }, { optionId: 'allow', kind: 'reject_once', name: 'Allow' }];
            expect(bridge.choosePermissionOption(lying, false)).to.deep.equal({ outcome: 'selected', optionId: 'allow' });
            const twice = [{ optionId: 'x', kind: 'allow_once' }, { optionId: 'y', kind: 'allow_once' }];
            expect(bridge.choosePermissionOption(twice, true)).to.deep.equal({ outcome: 'cancelled' });
            expect(bridge.choosePermissionOption(undefined, true)).to.deep.equal({ outcome: 'cancelled' });
            expect(bridge.choosePermissionOption([{ kind: 'allow_once' }], true)).to.deep.equal({ outcome: 'cancelled' });
        });
    });

    describe('canonical tool input', () => {
        it('maps OpenCode-style edit and shell arguments to the Claude-like names the gate guards read', () => {
            expect(bridge.canonicalToolInput('edit', { filePath: '/w/a.txt', content: 'hi' }, [], '/w')).to.deep.equal({ file_path: '/w/a.txt', content: 'hi' });
            expect(bridge.canonicalToolInput('edit', { filepath: '/w/a.txt', diff: '...' }, [], '/w')).to.deep.equal({ file_path: '/w/a.txt' });
            expect(bridge.canonicalToolInput('execute', { command: 'ls', workdir: '/w/sub' }, [{ path: '/w' }], '/w')).to.deep.equal({ command: 'ls', cwd: '/w/sub' });
            expect(bridge.canonicalToolInput('execute', { command: 'ls' }, [], '/w')).to.deep.equal({ command: 'ls', cwd: '/w' });
        });

        it('maps Copilot and Antigravity field names too', () => {
            expect(bridge.canonicalToolInput('edit', { path: '/w/a', old_str: 'x', new_str: 'y' }, [], '/w')).to.deep.equal({ file_path: '/w/a', old_string: 'x', new_string: 'y' });
            expect(bridge.canonicalToolInput('edit', { Path: '/w/a', Content: 'x', Overwrite: true }, [], '/w')).to.deep.equal({ file_path: '/w/a', content: 'x' });
            expect(bridge.canonicalToolInput('execute', { CommandLine: 'touch b', Cwd: '/w/sub' }, [], '/w')).to.deep.equal({ command: 'touch b', cwd: '/w/sub' });
        });

        it('falls back to the first location for a path and ignores non-string values', () => {
            expect(bridge.canonicalToolInput('edit', {}, [{ path: '/w/b.txt' }], '/w')).to.deep.equal({ file_path: '/w/b.txt' });
            expect(bridge.canonicalToolInput('edit', { filePath: 7, content: { a: 1 } }, 'x', '/w')).to.deep.equal({});
        });
    });

    it('gives the gate the agent\'s own tool name or the Claude name of the kind, per flavor', () => {
        expect(bridge.gateToolName(bridge.FLAVORS.opencode, 'edit', 'write')).to.equal('write');
        expect(bridge.gateToolName(bridge.FLAVORS.copilot, 'edit', 'Create a.txt')).to.equal('Edit');
        expect(bridge.gateToolName(bridge.FLAVORS.copilot, 'execute', 'Run ls')).to.equal('Bash');
        // Never the agent's title: any kind without a read-only meaning is gated as a write.
        expect(bridge.gateToolName(bridge.FLAVORS.copilot, 'other', 'ls')).to.equal('Write');
        expect(bridge.gateToolName(bridge.FLAVORS.copilot, 'delete', 'Read the file')).to.equal('Write');
        expect(bridge.gateToolName(bridge.FLAVORS.copilot, 'move', 'x')).to.equal('Write');
        expect(bridge.gateToolName(bridge.FLAVORS.copilot, 'switch_mode', 'x')).to.equal('Write');
        expect(bridge.gateToolName(bridge.FLAVORS.copilot, 'unknown-kind', 'Read')).to.equal('Write');
        expect(bridge.gateToolName(bridge.FLAVORS.copilot, 'read', 'x')).to.equal('Read');
        expect(bridge.gateToolName(bridge.FLAVORS.copilot, 'search', 'x')).to.equal('Grep');
    });

    it('refuses locally what a read-only turn may not do, and calls the gate guards could not judge', () => {
        expect(bridge.refusePermissionLocally('readonly', 'edit', { file_path: '/w/a' })).to.match(/read-only/);
        expect(bridge.refusePermissionLocally('readonly', 'other', {})).to.match(/read-only/);
        expect(bridge.refusePermissionLocally('readonly', 'read', { file_path: '/w/a' })).to.equal(undefined);
        expect(bridge.refusePermissionLocally('ask', 'execute', {})).to.match(/without saying which/);
        expect(bridge.refusePermissionLocally('auto', 'delete', {})).to.match(/without a path/);
        expect(bridge.refusePermissionLocally('auto', 'execute', { command: 'ls' })).to.equal(undefined);
        expect(bridge.refusePermissionLocally('auto', 'edit', { file_path: '/w/a' })).to.equal(undefined);
    });

    it('recognizes calls to this turn\'s own delegation server, as each agent spells them, and nothing else', () => {
        const server = 'qaaq_8e4c4910bb783eca';
        for (const name of [`${server}-qaaq_delegate`, `${server}__qaaq_task_wait`, `${server}_qaaq_child_apply`, `Run mcp_${server}_qaaq_task_wait`, `mcp_${server}_qaaq_list_agents`]) {
            expect(bridge.isOwnDelegationToolCall('other', [undefined, name], [server]), name).to.equal(true);
        }
        // Another server, a lookalike, no tool after the name, a mutating kind, or no delegation this turn.
        expect(bridge.isOwnDelegationToolCall('other', ['qaaq_ffffffffffffffff-qaaq_delegate'], [server])).to.equal(false);
        expect(bridge.isOwnDelegationToolCall('other', [`x${server}-qaaq_delegate`], [server])).to.equal(false);
        expect(bridge.isOwnDelegationToolCall('other', [`${server}`], [server])).to.equal(false);
        expect(bridge.isOwnDelegationToolCall('other', [`${server}-github_push`], [server])).to.equal(false);
        for (const kind of ['edit', 'delete', 'move', 'execute']) {
            expect(bridge.isOwnDelegationToolCall(kind, [`${server}-qaaq_delegate`], [server]), kind).to.equal(false);
        }
        expect(bridge.isOwnDelegationToolCall('other', [`${server}-qaaq_delegate`], [])).to.equal(false);
        // A server name that is not Qaap's random shape never enables the shortcut.
        expect(bridge.isOwnDelegationToolCall('other', ['qaaq-qaaq_delegate'], ['qaaq'])).to.equal(false);
    });

    it('accepts only well-formed stdio MCP server entries for session/new', () => {
        const entry = { name: 'qaaq_ab12', command: 'node', args: ['/s/shim.mjs'], env: [{ name: 'QAAP_DELEGATION_TOKEN_FILE', value: '/s/token' }] };
        expect(bridge.parseMcpServers(JSON.stringify([entry]))).to.deep.equal([entry]);
        expect(bridge.parseMcpServers('[]')).to.deep.equal([]);
        for (const bad of [
            '{}', 'not json', JSON.stringify([{ ...entry, name: 'bad name!' }]), JSON.stringify([{ ...entry, args: [1] }]),
            JSON.stringify([{ ...entry, env: { A: 'b' } }]), JSON.stringify([{ ...entry, command: '' }]), JSON.stringify(Array(9).fill(entry)),
        ]) {
            expect(() => bridge.parseMcpServers(bad), bad).to.throw();
        }
        // Extra fields (a smuggled `headers` with a token, a `type`) are dropped.
        expect(bridge.parseMcpServers(JSON.stringify([{ ...entry, headers: [{ name: 'Authorization', value: 'x' }] }]))).to.deep.equal([entry]);
    });

    describe('Antigravity profile', () => {
        const tmpHome = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agy-home-'));
        const tokenPath = (home: string): string => path.join(home, '.gemini', 'antigravity-cli', 'antigravity-oauth-token');
        const profileToken = (home: string): string => path.join(home, '.cache', 'qaaq', 'antigravity-acp', 'antigravity-cli', 'antigravity-oauth-token');
        // Symlinks need a privilege on Windows; there the link is best effort and agy reports a missing sign-in.
        const posixIt = process.platform === 'win32' ? it.skip : it;

        it('runs agy with Qaap\'s own profile and agy\'s standard data dir', () => {
            const home = tmpHome();
            expect(bridge.FLAVORS.antigravity).to.deep.include({ agentId: 'antigravity', permissionSource: 'bridge', output: 'stream-json', gateToolNames: 'claude', mcpStdio: true });
            expect(bridge.buildAgentArgv(bridge.FLAVORS.antigravity, ['agy', 'acp'], { HOME: `${home}/` }))
                // The bridge joins with `/` (valid on Windows too), whatever the platform separator.
                .to.deep.equal(['agy', 'acp', '--gemini-dir', `${home}/.cache/qaaq/antigravity-acp`, '--app-data-dir', 'antigravity-cli']);
            expect(bridge.buildAgentArgv(bridge.FLAVORS.grok, ['grok', 'agent', 'stdio'], { HOME: home })).to.deep.equal(['grok', 'agent', 'stdio']);
        });

        posixIt('shares the user\'s sign-in: the profile token links to the default profile\'s (Linux keeps it in a file)', () => {
            const home = tmpHome();
            fs.mkdirSync(path.dirname(tokenPath(home)), { recursive: true });
            fs.writeFileSync(tokenPath(home), 'token-1');
            bridge.buildAgentArgv(bridge.FLAVORS.antigravity, ['agy', 'acp'], { HOME: home });
            expect(fs.lstatSync(profileToken(home)).isSymbolicLink()).to.equal(true);
            expect(fs.readFileSync(profileToken(home), 'utf8')).to.equal('token-1');
            // A second turn keeps a single, correct link.
            bridge.buildAgentArgv(bridge.FLAVORS.antigravity, ['agy', 'acp'], { HOME: home });
            expect(fs.readlinkSync(profileToken(home))).to.equal(tokenPath(home));
        });

        posixIt('hands a token agy refreshed in the profile back to the default profile before linking again', () => {
            const home = tmpHome();
            fs.mkdirSync(path.dirname(tokenPath(home)), { recursive: true });
            fs.writeFileSync(tokenPath(home), 'old');
            fs.utimesSync(tokenPath(home), new Date(1000), new Date(1000));
            fs.mkdirSync(path.dirname(profileToken(home)), { recursive: true });
            // agy replaced the link with a fresh file (atomic rename on refresh).
            fs.writeFileSync(profileToken(home), 'refreshed');
            bridge.buildAgentArgv(bridge.FLAVORS.antigravity, ['agy', 'acp'], { HOME: home });
            expect(fs.readFileSync(tokenPath(home), 'utf8')).to.equal('refreshed');
            expect(fs.lstatSync(profileToken(home)).isSymbolicLink()).to.equal(true);
        });

        posixIt('keeps a newer default token over an older profile copy, and links nothing without a sign-in (macOS keychain)', () => {
            const home = tmpHome();
            fs.mkdirSync(path.dirname(profileToken(home)), { recursive: true });
            fs.writeFileSync(profileToken(home), 'stale');
            fs.utimesSync(profileToken(home), new Date(1000), new Date(1000));
            fs.mkdirSync(path.dirname(tokenPath(home)), { recursive: true });
            fs.writeFileSync(tokenPath(home), 'newer');
            bridge.buildAgentArgv(bridge.FLAVORS.antigravity, ['agy', 'acp'], { HOME: home });
            expect(fs.readFileSync(tokenPath(home), 'utf8')).to.equal('newer');
            const bare = tmpHome();
            bridge.buildAgentArgv(bridge.FLAVORS.antigravity, ['agy', 'acp'], { HOME: bare });
            expect(fs.existsSync(profileToken(bare))).to.equal(false);
        });
    });

    it('declares Grok as a bridge-gated flavor that takes stdio MCP servers and prints plain text', () => {
        expect(bridge.FLAVORS.grok).to.deep.include({ agentId: 'grok', permissionSource: 'bridge', keepGateEnv: false, output: 'text', gateToolNames: 'claude', mcpStdio: true });
        expect(bridge.FLAVORS.copilot.mcpStdio).to.equal(false);
        expect(bridge.FLAVORS.opencode.mcpStdio).to.equal(true);
    });

    it('maps every stop reason to its exit code', () => {
        expect(bridge.exitForStopReason('end_turn')).to.equal(bridge.EXIT.OK);
        expect(bridge.exitForStopReason('cancelled')).to.equal(bridge.EXIT.CANCELLED);
        expect(bridge.exitForStopReason('refusal')).to.equal(bridge.EXIT.REFUSAL);
        expect(bridge.exitForStopReason('max_tokens')).to.equal(bridge.EXIT.LIMIT);
        expect(bridge.exitForStopReason('max_turn_requests')).to.equal(bridge.EXIT.LIMIT);
        expect(bridge.exitForStopReason('weird')).to.equal(bridge.EXIT.PROTOCOL);
    });

    it('keeps gate credentials away from an agent whose flavor has no plugin of its own', () => {
        const env = { PATH: '/bin', QAAP_GATE_URL: 'u', QAAP_GATE_TOKEN: 't', QAAP_GATE_ASK_TTL_SEC: '600', QAAP_GATE_ARM_NONCE: 'n' };
        expect(bridge.buildAgentEnv(env, bridge.FLAVORS.copilot)).to.deep.equal({ PATH: '/bin' });
        expect(bridge.buildAgentEnv(env, bridge.FLAVORS.opencode)).to.deep.equal(env);
    });

    describe('line reader', () => {
        it('enforces the rate limit once and stops reading', () => {
            const seen: unknown[] = [];
            const violations: string[] = [];
            const reader = new bridge.LimitedLineReader(message => seen.push(message), reason => violations.push(reason), () => 0);
            const line = `${JSON.stringify({ jsonrpc: '2.0', method: 'x' })}\n`;
            reader.push(line.repeat(bridge.MAX_MESSAGES_PER_SECOND + 5));
            expect(seen).to.have.length(bridge.MAX_MESSAGES_PER_SECOND);
            expect(violations).to.have.length(1);
        });

        it('rejects non-JSON and non-JSON-RPC lines, and joins split chunks', () => {
            const seen: unknown[] = [];
            const violations: string[] = [];
            const reader = new bridge.LimitedLineReader(message => seen.push(message), reason => violations.push(reason));
            reader.push('{"jsonrpc":"2.0",');
            reader.push('"id":1}\n\n');
            expect(seen).to.deep.equal([{ jsonrpc: '2.0', id: 1 }]);
            reader.push('{"id":2}\n');
            expect(violations).to.have.length(1);
            const other = new bridge.LimitedLineReader(() => undefined, reason => violations.push(reason));
            other.push('not json\n');
            expect(violations).to.have.length(2);
        });
    });

    describe('translation to Claude stream-json', () => {
        const replay = (lines: unknown[]): QaapQaiqStreamAccumulator => {
            const accumulator = new QaapQaiqStreamAccumulator();
            accumulator.push(lines.map(line => `${JSON.stringify(line)}\n`).join(''));
            return accumulator;
        };

        it('produces text, thinking, a tool row with its result and the turn usage the Claude parser understands', () => {
            const translator = new bridge.AcpStreamTranslator(bridge.FLAVORS.opencode);
            const lines: unknown[] = [...translator.header()];
            const push = (update: unknown): void => {
                lines.push(...translator.update(update, '/w').lines);
            };
            push({ sessionUpdate: 'agent_thought_chunk', messageId: 't', content: { type: 'text', text: 'Plan it.' } });
            push({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'I will ' } });
            push({ sessionUpdate: 'agent_message_chunk', messageId: 'm1', content: { type: 'text', text: 'write it.' } });
            push({ sessionUpdate: 'tool_call', toolCallId: 'c1', title: 'write', kind: 'edit', status: 'pending', rawInput: {} });
            push({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'in_progress', title: 'a.txt', rawInput: { filePath: '/w/a.txt', content: 'hi' } });
            push({ sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'Wrote file.' } }] });
            push({ sessionUpdate: 'agent_message_chunk', messageId: 'm2', content: { type: 'text', text: 'Done.' } });
            push({ sessionUpdate: 'usage_update', used: 10, size: 100, cost: { amount: 0.5, currency: 'USD' } });
            push({ sessionUpdate: 'available_commands_update', availableCommands: [] });
            lines.push(...translator.result('end_turn', { inputTokens: 100, outputTokens: 20, thoughtTokens: 5, cachedReadTokens: 7 }));

            const accumulator = replay(lines);
            const segments = accumulator.getSegments();
            // The Claude parser places a thinking block that precedes text after it (same as for Claude Code itself).
            expect(segments.map(segment => segment.type)).to.deep.equal(['text', 'thinking', 'tool', 'text']);
            expect(segments[0]).to.deep.include({ type: 'text', content: 'I will write it.' });
            expect(segments[1]).to.deep.include({ type: 'thinking', content: 'Plan it.' });
            const tool = segments[2] as { name: string; args: string; finished: boolean; result?: string; error?: boolean };
            expect(tool.name).to.equal('Edit');
            expect(JSON.parse(tool.args)).to.deep.equal({ file_path: '/w/a.txt', content: 'hi' });
            expect(tool.finished).to.equal(true);
            expect(tool.result).to.equal('Wrote file.');
            expect(segments[3]).to.deep.include({ type: 'text', content: 'Done.' });
            expect(accumulator.getTurnUsage?.()).to.deep.include({ inputTokens: 100, cacheReadInputTokens: 7 });
            const result = lines[lines.length - 1] as Record<string, any>;
            expect(result).to.deep.include({ type: 'result', is_error: false, stop_reason: 'end_turn', result: '', total_cost_usd: 0.5 });
            expect(result.usage.output_tokens).to.equal(25);
        });

        it('marks a failed tool as an error and a non end_turn stop as an error result', () => {
            const translator = new bridge.AcpStreamTranslator(bridge.FLAVORS.opencode);
            const lines: unknown[] = [
                ...translator.update({ sessionUpdate: 'tool_call', toolCallId: 'c', title: 'bash', kind: 'execute', status: 'pending', rawInput: { command: 'ls' } }, '/w').lines,
                ...translator.update({ sessionUpdate: 'tool_call_update', toolCallId: 'c', status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'Blocked' } }] }, '/w').lines,
                ...translator.result('refusal', undefined),
            ];
            const tool = replay(lines).getSegments().find(segment => segment.type === 'tool') as { name: string; finished: boolean; result?: string };
            expect(tool).to.deep.include({ name: 'Bash', finished: true, result: 'Error: Blocked' });
            expect(lines[lines.length - 1]).to.deep.include({ is_error: true, stop_reason: 'refusal' });
        });

        it('flags a mutation that completed without a permission only when the bridge is the only checkpoint', () => {
            const sneak = { sessionUpdate: 'tool_call', toolCallId: 's', title: 'write', kind: 'edit', status: 'completed', rawInput: { filePath: '/w/x' } };
            expect(new bridge.AcpStreamTranslator(bridge.FLAVORS.copilot).update(sneak, '/w').warning).to.deep.include({ code: 'unpermitted-mutation' });
            expect(new bridge.AcpStreamTranslator(bridge.FLAVORS.opencode).update(sneak, '/w').warning).to.equal(undefined);
            const granted = new bridge.AcpStreamTranslator(bridge.FLAVORS.copilot);
            granted.markPermitted('s');
            expect(granted.update(sneak, '/w').warning).to.equal(undefined);
            const read = { ...sneak, toolCallId: 'r', kind: 'read' };
            expect(new bridge.AcpStreamTranslator(bridge.FLAVORS.copilot).update(read, '/w').warning).to.equal(undefined);
        });
    });

    describe('loopback HTTP MCP proxy', () => {
        // A tiny stdio MCP server: answers initialize and tools/list, echoes the method otherwise.
        const ECHO_SERVER = `process.stdin.setEncoding('utf8'); let b='';
process.stdin.on('data', c => { b += c; let n; while ((n = b.indexOf('\\n')) >= 0) { const l = b.slice(0, n); b = b.slice(n + 1);
const m = JSON.parse(l); if (m.id === undefined) continue;
const result = m.method === 'tools/list' ? { tools: [{ name: 'qaaq_delegate' }] } : { method: m.method, token: process.env.QAAP_DELEGATION_TOKEN_FILE };
process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n'); } });`;
        const spawnEcho = (entry: any): ChildProcess => spawn(process.execPath, ['-e', ECHO_SERVER], {
            env: { ...process.env, ...Object.fromEntries(entry.env.map((pair: any) => [pair.name, pair.value])) }, stdio: ['pipe', 'pipe', 'ignore'],
        });
        const entry = { name: 'qaaq_ab12', command: 'node', args: [], env: [{ name: 'QAAP_DELEGATION_TOKEN_FILE', value: '/s/token' }] };

        it('serves the stdio server over HTTP only to the bearer of its random secret', async () => {
            const proxy = await bridge.startMcpHttpProxy([entry], spawnEcho);
            try {
                const { url, headers } = proxy.entries[0];
                const auth = headers[0].value as string;
                expect(auth).to.match(/^Bearer [A-Za-z0-9_-]{43}$/);
                const post = (body: unknown, authorization?: string): Promise<Response> => fetch(url, {
                    method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body),
                });
                const listed = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, auth);
                expect(listed.status).to.equal(200);
                expect((await listed.json()).result.tools[0].name).to.equal('qaaq_delegate');
                expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, auth)).status).to.equal(202);
                expect((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).to.equal(401);
                expect((await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, 'Bearer wrong')).status).to.equal(401);
                expect((await fetch(url, { headers: { authorization: auth } })).status).to.equal(405);
                expect((await fetch(url.replace(/\/0$/, '/9'), { method: 'POST', headers: { authorization: auth }, body: '{}' })).status).to.equal(404);
                expect((await post({ not: 'json-rpc' }, auth)).status).to.equal(400);
            } finally {
                proxy.close();
            }
        });

        it('refuses a browser Origin, a foreign Host and a non-primitive id, and answers 502 once the server died', async () => {
            const proxy = await bridge.startMcpHttpProxy([entry], spawnEcho);
            try {
                const { url, headers } = proxy.entries[0];
                const auth = headers[0].value as string;
                const send = (body: unknown, extra: Record<string, string> = {}): Promise<Response> => fetch(url, {
                    method: 'POST', headers: { 'content-type': 'application/json', authorization: auth, ...extra }, body: JSON.stringify(body),
                });
                expect((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'http://evil.example' })).status).to.equal(403);
                const foreignHost = await new Promise<number>(resolve => {
                    const u = new URL(url);
                    const req = http.request({ host: '127.0.0.1', port: u.port, path: u.pathname, method: 'POST', headers: { host: 'evil.example', authorization: auth } },
                        res => resolve(res.statusCode ?? 0));
                    req.end('{}');
                });
                expect(foreignHost).to.equal(403);
                expect((await send({ jsonrpc: '2.0', id: { a: 1 }, method: 'tools/list' })).status).to.equal(400);
                expect((await send({ jsonrpc: '2.0', id: null, method: 'tools/list' })).status).to.equal(400);
            } finally {
                proxy.close();
            }
            const dead = await bridge.startMcpHttpProxy([entry], () => spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: ['pipe', 'pipe', 'ignore'] }));
            try {
                await new Promise(resolve => setTimeout(resolve, 300));
                const { url, headers } = dead.entries[0];
                const reply = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: headers[0].value }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
                expect(reply.status).to.equal(502);
            } finally {
                dead.close();
            }
        });

        it('listens on loopback only and never puts the stdio server\'s environment in the entries', async () => {
            const proxy = await bridge.startMcpHttpProxy([entry], spawnEcho);
            try {
                expect(new URL(proxy.entries[0].url).hostname).to.equal('127.0.0.1');
                expect(JSON.stringify(proxy.entries)).to.not.contain('/s/token');
            } finally {
                proxy.close();
            }
        });
    });

    describe('a turn against a scripted agent', () => {
        let server: http.Server;
        let gateUrl: string;
        let seen: Array<{ token: string | undefined; body: Record<string, any> }>;
        let decide: (body: Record<string, any>) => Record<string, unknown>;

        beforeEach(async () => {
            seen = [];
            decide = () => ({ kind: 'allow' });
            server = http.createServer((req, res) => {
                let raw = '';
                req.on('data', chunk => raw += chunk);
                req.on('end', () => {
                    const body = JSON.parse(raw);
                    seen.push({ token: req.headers['x-qaap-gate-token'] as string | undefined, body });
                    res.setHeader('content-type', 'application/json');
                    res.end(JSON.stringify({ decision: decide(body) }));
                });
            });
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            gateUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/gate`;
        });

        afterEach(async () => {
            await new Promise<void>(resolve => server.close(() => resolve()));
        });

        const env = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
            PATH: process.env.PATH, QAAP_GATE_URL: gateUrl, QAAP_GATE_TOKEN: 'gate-secret', QAAP_GATE_ASK_TTL_SEC: '5', ...extra,
        });
        const agent = (scenario: string, flavor = 'copilot'): string[] => ['--flavor', flavor, '--', process.execPath, FAKE_AGENT, scenario];

        it('streams the reply and ends with a success result and exit 0', async () => {
            const run = await runBridge(agent('echo', 'opencode'), env(), 'hi there');
            expect(run.code).to.equal(0);
            expect(run.lines[0]).to.deep.include({ type: 'system', subtype: 'init', qaap_transport: 'acp', flavor: 'opencode' });
            expect(run.stdout).to.contain('You said: ');
            expect(run.stdout).to.contain('hi there');
            expect(run.lines[run.lines.length - 1]).to.deep.include({ type: 'result', is_error: false, total_cost_usd: 0.25 });
        });

        it('asks the gate with the call id and canonical input, and grants with allow_once on an allow', async () => {
            const run = await runBridge(agent('edit'), env());
            expect(run.code).to.equal(0);
            expect(seen).to.have.length(1);
            expect(seen[0].token).to.equal('gate-secret');
            // Copilot titles describe the call: the gate classifies it by the Claude name of the ACP kind.
            expect(seen[0].body).to.deep.include({ agentId: 'copilot', rawToolName: 'Edit', harnessCallId: 'call-edit', acpKind: 'edit' });
            expect(seen[0].body.input.file_path).to.match(/a\.txt$/);
            expect(run.stdout).to.contain('done');
            expect(run.stderr).to.not.contain('without asking');
        });

        it('rejects on a gate deny, and on an allow that rewrites the input', async () => {
            decide = () => ({ kind: 'deny', reason: 'nope' });
            let run = await runBridge(agent('edit'), env());
            expect(run.stdout).to.contain('not allowed');
            expect(run.stderr).to.contain('Blocked: nope');
            decide = () => ({ kind: 'allow', updatedInput: { file_path: '/elsewhere' } });
            run = await runBridge(agent('edit'), env());
            expect(run.stdout).to.contain('not allowed');
        });

        it('rejects when no gate is configured, without asking anything', async () => {
            const run = await runBridge(agent('edit'), { PATH: process.env.PATH });
            expect(run.stdout).to.contain('not allowed');
            expect(seen).to.have.length(0);
        });

        it('answers a deceptive option list by kind', async () => {
            decide = () => ({ kind: 'deny', reason: 'no' });
            const run = await runBridge(agent('deceptive'), env());
            // The option labelled "Allow once" is the reject_once one: picking it is the rejection.
            expect(run.stdout).to.contain('picked:once');
        });

        it('drops updates of another session', async () => {
            const run = await runBridge(agent('foreign'), env());
            expect(run.stdout).to.contain('mine');
            expect(run.stdout).to.not.contain('FOREIGN');
        });

        it('never gives the gate token to an agent without its own plugin, and keeps it for OpenCode', async () => {
            let run = await runBridge(agent('env'), env());
            expect(run.stdout).to.not.contain('QAAP_GATE');
            run = await runBridge(agent('env', 'opencode'), env());
            expect(run.stdout).to.contain('QAAP_GATE_TOKEN');
        });

        it('keeps the gate token out of everything it prints', async () => {
            for (const scenario of ['echo', 'edit', 'env', 'auth', 'crash']) {
                const run = await runBridge(agent(scenario), env());
                expect(run.stdout + run.stderr, scenario).to.not.contain('gate-secret');
            }
        });

        it('exits with a distinct code for sign-in, old protocol, crash, refusal, flood and huge lines', async () => {
            const expected: Record<string, number> = {
                auth: bridge.EXIT.AUTH_REQUIRED,
                version0: bridge.EXIT.VERSION_UNSUPPORTED,
                crash: bridge.EXIT.AGENT_DIED,
                refuse: bridge.EXIT.REFUSAL,
                flood: bridge.EXIT.PROTOCOL,
                hugeline: bridge.EXIT.PROTOCOL,
            };
            for (const [scenario, code] of Object.entries(expected)) {
                const run = await runBridge(agent(scenario), env());
                expect(run.code, scenario).to.equal(code);
                expect(run.stderr, scenario).to.match(/\[qaap\] /);
            }
        });

        it('reports a mutation that completed without asking', async () => {
            const run = await runBridge(agent('unpermitted'), env());
            expect(run.stderr).to.contain('[qaap] copilot completed a edit call (write) without asking for permission.');
        });

        it('prints plain text for a flavor whose transcript is plain text: the reply and one line per tool call', async () => {
            const run = await runBridge(agent('echo'), env(), 'hi there');
            expect(run.stdout).to.equal('You said: hi there\n');
            const edit = await runBridge(agent('edit'), env());
            expect(edit.stdout).to.match(/^\n▸ Edit: .*a\.txt\ndone\n$/);
        });

        // POSIX only: Windows delivers no SIGTERM (process.kill terminates at once); there the runner kills with taskkill.
        const posixIt = process.platform === 'win32' ? it.skip : it;

        posixIt('cancels on SIGTERM within 4 s, even when the agent ignores session/cancel, and leaves no agent behind', async () => {
            const record = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-acp-')), 'record.jsonl');
            let killedAt = 0;
            const run = await runBridge(agent('hang'), env({ FAKE_ACP_RECORD: record }), 'go', pid => killOncePrompted(record, pid, () => killedAt = Date.now()));
            expect(run.code).to.equal(bridge.EXIT.CANCELLED);
            expect(killedAt).to.be.greaterThan(0);
            // Measured from the SIGTERM, not from start-up (slow CI runners).
            expect(Date.now() - killedAt).to.be.lessThan(4000);
            const methods = fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).method);
            expect(methods).to.include('session/cancel');
        });

        posixIt('answers cancelled to a permission asked after the cancel, without asking the gate', async () => {
            const record = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-acp-')), 'record.jsonl');
            const run = await runBridge(agent('cancelperm'), env({ FAKE_ACP_RECORD: record }), 'go', pid => killOncePrompted(record, pid));
            expect(run.code).to.equal(bridge.EXIT.CANCELLED);
            expect(seen).to.have.length(0);
            const late = fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).find(entry => entry.lateOutcome);
            expect(late?.lateOutcome).to.deep.equal({ outcome: 'cancelled' });
        });

        it('refuses a shell call without a command and a delete in a read-only turn, without asking the gate', async () => {
            let run = await runBridge(agent('nocommand'), env());
            expect(run.stdout).to.contain('outcome:reject');
            run = await runBridge(['--flavor', 'copilot', '--mode', 'readonly', '--', process.execPath, FAKE_AGENT, 'delete'], env());
            expect(run.stdout).to.contain('outcome:reject');
            expect(run.stderr).to.contain('read-only');
            expect(seen).to.have.length(0);
            // The same delete in an ask turn reaches the gate as a write.
            run = await runBridge(agent('delete'), env());
            expect(seen.map(entry => entry.body.rawToolName)).to.deep.equal(['Write']);
        });

        it('prefixes every agent stderr line so it never passes for stream-json or a Qaap note', async () => {
            const run = await runBridge(agent('stderrjson', 'opencode'), env());
            expect(run.stderr).to.contain('[agent] {"type":"result"');
            expect(run.stderr).to.contain('[agent] [qaap] fake note');
            expect(run.stderr.split('\n').some(line => line.startsWith('{') || line.startsWith('[qaap] fake'))).to.equal(false);
        });

        it('loads the gate client only when its bytes match the expected hash', async () => {
            const client = resolveQaapAcpGateClientPath();
            const good = crypto.createHash('sha256').update(fs.readFileSync(client)).digest('hex');
            let run = await runBridge(['--flavor', 'opencode', '--gate-client', client, '--gate-client-sha256', good, '--', process.execPath, FAKE_AGENT, 'echo'], env());
            expect(run.code).to.equal(0);
            run = await runBridge(['--flavor', 'opencode', '--gate-client', client, '--gate-client-sha256', '0'.repeat(64), '--', process.execPath, FAKE_AGENT, 'echo'], env());
            expect(run.code).to.equal(bridge.EXIT.USAGE);
            expect(run.stderr).to.contain('expected hash');
        });

        it('passes the launcher\'s MCP servers in session/new to a flavor that takes them, and none to Copilot', async () => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-acp-'));
            const servers = path.join(dir, 'acp-mcp.json');
            const entry = { name: 'qaaq_ab12', command: process.execPath, args: ['/s/shim.mjs'], env: [{ name: 'QAAP_DELEGATION_TOKEN_FILE', value: '/s/token' }] };
            fs.writeFileSync(servers, JSON.stringify([entry]));
            const newSession = async (flavor: string): Promise<any> => {
                const record = path.join(dir, `${flavor}.jsonl`);
                await runBridge(['--flavor', flavor, '--mcp-servers', servers, '--', process.execPath, FAKE_AGENT, 'echo'], env({ FAKE_ACP_RECORD: record }));
                return fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).find(message => message.method === 'session/new');
            };
            expect((await newSession('grok')).params.mcpServers).to.deep.equal([entry]);
            // Copilot ignores stdio MCP servers: it gets the same server behind the bridge's loopback HTTP proxy.
        const copilot = (await newSession('copilot')).params.mcpServers;
        expect(copilot).to.have.length(1);
        expect(copilot[0]).to.deep.include({ type: 'http', name: 'qaaq_ab12' });
        expect(copilot[0].url).to.match(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/0$/);
        expect(copilot[0].headers[0].name).to.equal('Authorization');
        expect(JSON.stringify(copilot)).to.not.contain('/s/token');
            fs.writeFileSync(servers, '{"not":"a list"}');
            const broken = await runBridge(['--flavor', 'grok', '--mcp-servers', servers, '--', process.execPath, FAKE_AGENT, 'echo'], env());
            expect(broken.code).to.equal(bridge.EXIT.USAGE);
        });

        it('grants calls to its own delegation server without the gate, never a mutating call under the same name', async () => {
            const servers = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-acp-')), 'acp-mcp.json');
            fs.writeFileSync(servers, JSON.stringify([{ name: 'qaaq_8e4c4910bb783eca', command: process.execPath, args: ['/s/shim.mjs'], env: [] }]));
            decide = () => ({ kind: 'deny', reason: 'gate says no' });
            const run = await runBridge(['--flavor', 'grok', '--mcp-servers', servers, '--', process.execPath, FAKE_AGENT, 'ownmcp'], env());
            expect(run.stdout).to.contain('own:once sneaky:reject');
            // Only the lookalike shell call reached the gate.
            expect(seen.map(entry => entry.body.harnessCallId)).to.deep.equal(['call-sneaky']);
        });

        it('reads the prompt from --prompt-file when given (Grok\'s native transport)', async () => {
            const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-acp-')), 'prompt.txt');
            fs.writeFileSync(file, 'from the file');
            const run = await runBridge(['--flavor', 'grok', '--prompt-file', file, '--', process.execPath, FAKE_AGENT, 'echo'], env(), 'from stdin');
            expect(run.stdout).to.contain('You said: from the file');
            expect(run.stdout).to.not.contain('from stdin');
        });

        it('announces neither fs nor terminal and sends no MCP server', async () => {
            const record = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-acp-')), 'record.jsonl');
            await runBridge(agent('echo'), env({ FAKE_ACP_RECORD: record }));
            const messages = fs.readFileSync(record, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
            const init = messages.find(message => message.method === 'initialize');
            expect(init.params.clientCapabilities).to.deep.equal({ fs: { readTextFile: false, writeTextFile: false }, terminal: false });
            expect(messages.find(message => message.method === 'session/new').params.mcpServers).to.deep.equal([]);
        });
    });
});

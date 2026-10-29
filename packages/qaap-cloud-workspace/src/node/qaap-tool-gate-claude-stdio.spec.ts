// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import {
    buildQaiqControlResponseLine,
    buildQaiqStdioPromptLine,
    parseQaiqStdioEvent,
} from '../common/qaap-qaiq-stdio-approvals';
import { applyTemplateWithoutPrompt } from './qaap-agent-task-runner-utils';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { buildAgentCommandExtracted, buildTemplateVarsExtracted } from './qaap-agent-task-runner-streaming2';
import { QaapToolGateService } from './qaap-tool-gate-service';

const CLAUDE_TEMPLATE = QAAP_BUILTIN_AGENT_DEFINITIONS.find(definition => definition.id === 'claude')!.template;

function claudeCtx(trusted: boolean): QaapAgentTaskRunnerContext {
    const ctx = {
        resolveAgentId: () => 'claude',
        stripLeadingAgentMention: (value: string) => value,
        readAgentInstructions: () => undefined,
        readRepoMap: () => undefined,
        readRelevantFiles: () => undefined,
        readGitStatusSnapshot: () => undefined,
        readRepoMemory: () => undefined,
        readResearchLedger: () => undefined,
        readProjectInfo: () => undefined,
        assertQaiqConfigured: () => undefined,
        isQaiqRunner: () => false,
        applyTemplateWithoutPrompt,
        isProjectFolderTrusted: () => trusted,
        detectedAgents: new Map([['claude', { id: 'claude', label: 'Claude Code', bin: 'claude', template: CLAUDE_TEMPLATE }]]),
        buildTemplateVars: (...args: unknown[]) => buildTemplateVarsExtracted(ctx as unknown as QaapAgentTaskRunnerContext, ...(args as [string])),
    };
    return ctx as unknown as QaapAgentTaskRunnerContext;
}

function buildClaude(policy: string, trusted = false, autoApprove = policy !== 'request-approval'): ReturnType<typeof buildAgentCommandExtracted> {
    return buildAgentCommandExtracted(claudeCtx(trusted), 'do it', 'claude', autoApprove, undefined, process.cwd(), undefined, undefined, policy, undefined, undefined, false, 'alice');
}

describe('Claude Code behind the stdio tool gate: command', () => {

    it('takes the stdio control protocol and sends the prompt over stdin', () => {
        const built = buildClaude('approve-for-me');
        expect(built.stdinPromptMode).to.equal('qaiq-stdio');
        expect(built.stdinPrompt).to.contain('do it');
        expect(built.command).to.match(/^claude /);
        expect(built.command).to.contain('--input-format stream-json --permission-prompt-tool stdio');
        expect(built.command).to.contain('--output-format stream-json');
        expect(built.command).not.to.contain('do it');
        expect(built.command).not.to.contain('{');
    });

    it('never pre-approves Bash or uses a bypass flag, so shell calls reach the gate', () => {
        const built = buildClaude('approve-for-me');
        expect(built.command).not.to.contain('--dangerously-skip-permissions');
        expect(built.command).to.contain('--permission-mode default');
        const allowed = /--allowed-tools (\S+)/.exec(built.command)![1].split(',');
        expect(allowed).not.to.include('Bash');
        expect(built.command).to.contain('--tools default');
    });

    it('keeps subagents and skills available: no --disallowed-tools and no narrowed --tools list', () => {
        const command = buildClaude('approve-for-me').command;
        expect(command).not.to.contain('--disallowed-tools');
        expect(/--tools (\S+)/.exec(command)![1]).to.equal('default');
    });

    it('keeps request-approval on the default permission mode', () => {
        const built = buildClaude('request-approval');
        expect(built.command).to.contain('--permission-mode default');
        expect(built.command).to.contain('--permission-prompt-tool stdio');
        expect(built.command).not.to.contain('--allowed-tools');
    });

    it('leaves Full access on the CLI bypass mode, outside the stdio loop', () => {
        const built = buildClaude('full-access');
        expect(built.stdinPromptMode).to.equal('plain');
        expect(built.command).to.contain('--dangerously-skip-permissions');
        expect(built.command).not.to.contain('--permission-prompt-tool');
    });

    it('drops project and local settings in an untrusted folder, and loads the normal ones in a trusted one', () => {
        expect(buildClaude('approve-for-me', false).command).to.contain('--setting-sources user --strict-mcp-config');
        expect(buildClaude('request-approval', false).command).to.contain('--setting-sources user --strict-mcp-config');
        expect(buildClaude('approve-for-me', true).command).not.to.contain('--setting-sources');
        expect(buildClaude('approve-for-me', true).command).not.to.contain('--strict-mcp-config');
        expect(resolveQaapHarnessCapabilities('claude').trustedFolderArgs).to.deep.equal([]);
    });
});

const FAKE_CLAUDE = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const calls = JSON.parse(process.env.FAKE_CALLS);
const out = [];
let index = 0;
const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
function next() {
    if (index >= calls.length) {
        send({ type: 'result', subtype: 'success', total_cost_usd: 0.01, results: out });
        return;
    }
    const call = calls[index];
    send({ type: 'control_request', request_id: 'req-' + index, request: { subtype: 'can_use_tool', tool_name: call.tool, tool_use_id: 'toolu_' + index, input: call.input } });
}
let started = false;
rl.on('line', line => {
    const m = JSON.parse(line);
    if (m.type === 'user' && !started) { started = true; next(); return; }
    if (m.type === 'control_response') {
        out.push(m.response.response);
        index++;
        next();
    }
});
rl.on('close', () => process.exit(0));
`;

/**
 * Runs the same per-request loop the task runner runs (parse, gate, answer) against a fake `claude` that speaks
 * the stream-json control protocol captured from the real CLI 2.1.312.
 */
async function runFakeClaude(
    command: string,
    autoApprove: boolean,
    calls: Array<{ tool: string; input: Record<string, unknown> }>,
    ask: (outcome: 'approve' | 'reject') => 'approve' | 'reject',
    updatedInputFor?: (tool: string) => Record<string, unknown> | undefined,
): Promise<{ decisions: Array<Record<string, unknown>>; asked: string[] }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-fake-claude-'));
    try {
        const script = path.join(dir, 'fake-claude.js');
        fs.writeFileSync(script, FAKE_CLAUDE);
        const gate = new QaapToolGateService();
        const child = spawn(process.execPath, [script], { cwd: dir, env: { ...process.env, FAKE_CALLS: JSON.stringify(calls) }, stdio: ['pipe', 'pipe', 'inherit'] });
        const asked: string[] = [];
        let buffer = '';
        const decisions = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
            child.on('error', reject);
            child.stdout.on('data', chunk => {
                buffer += String(chunk);
                let newline: number;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, newline);
                    buffer = buffer.slice(newline + 1);
                    const event = parseQaiqStdioEvent(line);
                    if (event?.type === 'result') {
                        resolve((JSON.parse(line) as { results: Array<Record<string, unknown>> }).results);
                        child.stdin.end();
                    } else if (event?.type === 'control-request') {
                        const outcome = gate.evaluateQaiqControlRequest({
                            command, autoApprove,
                            request: event.request, cwd: dir, options: {},
                        });
                        let action: 'approve' | 'reject';
                        if (outcome.action === 'queue') {
                            asked.push(event.request.toolName ?? '');
                            action = ask('approve');
                        } else {
                            action = outcome.action === 'allow' ? 'approve' : 'reject';
                        }
                        const updatedInput = action === 'approve' ? updatedInputFor?.(event.request.toolName ?? '') : undefined;
                        child.stdin.write(buildQaiqControlResponseLine(event.request, action, {
                            ...(outcome.denyMessage ? { denyMessage: outcome.denyMessage } : {}),
                            ...(updatedInput ? { updatedInput } : {}),
                        }));
                    }
                }
            });
            child.stdin.write(buildQaiqStdioPromptLine('go'));
        });
        return { decisions, asked };
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe('Claude Code behind the stdio tool gate: decisions over a fake CLI', () => {

    const approveForMe = (): string => buildClaude('approve-for-me').command;

    it('allows a safe shell command and a core tool without asking', async () => {
        const { decisions, asked } = await runFakeClaude(approveForMe(), true, [
            { tool: 'Bash', input: { command: 'npm test' } },
            { tool: 'Edit', input: { file_path: 'a.ts' } },
        ], () => 'reject');
        expect(asked).to.deep.equal([]);
        expect(decisions.map(d => d.behavior)).to.deep.equal(['allow', 'allow']);
        expect(decisions[0]).to.deep.include({ updatedInput: {}, toolUseID: 'toolu_0' });
    });

    it('queues a destructive shell command for consent and denies a headless tool', async () => {
        const { decisions, asked } = await runFakeClaude(approveForMe(), true, [
            { tool: 'Bash', input: { command: 'git push --force origin main' } },
            { tool: 'Task', input: { subagent_type: 'web-dev' } },
        ], () => 'approve');
        // A destructive command is never auto-approved: it waits for explicit consent. A headless tool is denied outright.
        expect(asked).to.deep.equal(['Bash']);
        expect(decisions[1].behavior).to.equal('deny');
        expect(String(decisions[1].message)).to.not.equal('');
    });

    it('asks under request-approval and honours both answers', async () => {
        const command = buildClaude('request-approval').command;
        const approved = await runFakeClaude(command, false, [{ tool: 'Write', input: { file_path: 'x', content: '' } }], () => 'approve');
        expect(approved.asked).to.deep.equal(['Write']);
        expect(approved.decisions[0].behavior).to.equal('allow');
        const rejected = await runFakeClaude(command, false, [{ tool: 'Bash', input: { command: 'touch x' } }], () => 'reject');
        expect(rejected.asked).to.deep.equal(['Bash']);
        expect(rejected.decisions[0].behavior).to.equal('deny');
        expect(String(rejected.decisions[0].message)).to.contain('declined');
    });

    it('passes a rewritten input through updatedInput', async () => {
        const { decisions } = await runFakeClaude(approveForMe(), true, [
            { tool: 'Bash', input: { command: 'npm test' } },
        ], () => 'approve', () => ({ command: 'npm run lint' }));
        expect(decisions[0]).to.deep.include({ behavior: 'allow', updatedInput: { command: 'npm run lint' } });
    });
});

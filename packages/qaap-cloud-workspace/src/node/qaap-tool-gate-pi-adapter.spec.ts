// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import { resolveAgentProjectTrustFlags } from '@theia/qaap-shared-core/lib/common/qaap-project-folder-trust';
import { parseAgentLogForTranscript, createAgentStreamAccumulator } from '@theia/qaap-shared-core/lib/common/qaap-cli-transcript-stream';
import { resolveQaapToolGatePiExtensionPath, usesToolGateExtension } from './qaap-tool-gate-pi-adapter';
import { applyTemplate } from './qaap-agent-task-runner-utils';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { buildTemplateVarsExtracted } from './qaap-agent-task-runner-streaming2';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';

const templateVarsFor = (agentId: string, trusted: boolean): Record<string, string> => buildTemplateVarsExtracted({
    isProjectFolderTrusted: () => trusted,
    resolveQaiqProviderFlags: () => '',
} as unknown as QaapAgentTaskRunnerContext, agentId, undefined, undefined, 'alice', '/w/repo');

const piTemplate = (): string => QAAP_BUILTIN_AGENT_DEFINITIONS.find(agent => agent.id === 'pi')!.template;

describe('Pi tool gate adapter', () => {

    it('ships the extension at an absolute path that exists and imports nothing from the repo', () => {
        const file = resolveQaapToolGatePiExtensionPath();
        expect(path.isAbsolute(file)).to.equal(true);
        const source = fs.readFileSync(file, 'utf8');
        expect(source).to.not.match(/^\s*import\s.+from\s+['"](?!node:)/m);
        expect(source).to.not.match(/require\(/);
    });

    it('builds `pi --mode json -p --no-session -ne -e <abs> --no-approve …` for an untrusted folder', () => {
        const command = applyTemplate(piTemplate(), 'fix it', templateVarsFor('pi', false));
        expect(command).to.contain('pi --mode json -p --no-session -ne -e ');
        expect(command).to.contain(`'${resolveQaapToolGatePiExtensionPath()}'`);
        expect(command).to.contain(' --no-approve ');
        expect(command).to.not.match(/(^|\s)--approve(\s|$)/);
        expect(command.endsWith('\'fix it\'')).to.equal(true);
    });

    it('a trusted project gives Pi --approve plus -e gate_ext; an untrusted one --no-approve plus -e gate_ext', () => {
        const ext = `-e '${resolveQaapToolGatePiExtensionPath()}'`;
        const trusted = applyTemplate(piTemplate(), 'x', templateVarsFor('pi', true));
        const untrusted = applyTemplate(piTemplate(), 'x', templateVarsFor('pi', false));
        expect(trusted).to.contain(`${ext} --approve `);
        expect(untrusted).to.contain(`${ext} --no-approve `);
        expect(trusted).to.not.contain('--no-approve');
    });

    it('a failing trust store makes the project untrusted instead of failing the spawn', () => {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            projectFolderTrust: { isTrusted: () => { throw new Error('store unreadable'); } },
            hostedWorktrees: { resolve: () => undefined },
        });
        expect(runner.isProjectFolderTrusted('alice', '/w/repo')).to.equal(false);
    });

    it('resolves trust flags from the registry lists (one source of truth)', () => {
        expect(resolveAgentProjectTrustFlags('pi', true)).to.equal(resolveQaapHarnessCapabilities('pi').trustedFolderArgs.join(' '));
        expect(resolveAgentProjectTrustFlags('pi', false)).to.equal(resolveQaapHarnessCapabilities('pi').untrustedFolderArgs.join(' '));
    });

    it('leaves other harnesses without trust flags and without a gate extension', () => {
        expect(resolveAgentProjectTrustFlags('pi', false)).to.equal('--no-approve');
        expect(templateVarsFor('codex', true).trust_flags).to.equal('');
        expect(templateVarsFor('qaiq', false).trust_flags).to.equal('');
        expect(templateVarsFor('pi', true).gate_ext).to.contain('qaap-tool-gate-pi.mjs');
        expect(templateVarsFor('codex', true).gate_ext).to.equal(undefined);
    });

    it('uses --approve only for a trusted folder', () => {
        const command = applyTemplate(piTemplate(), 'x', templateVarsFor('pi', true));
        expect(command).to.match(/(^|\s)--approve(\s|$)/);
        expect(command).to.not.contain('--no-approve');
    });

    it('always disables extension discovery (-ne), trusted or not, while the explicit gate -e still loads', () => {
        for (const trusted of [true, false]) {
            const command = applyTemplate(piTemplate(), 'x', templateVarsFor('pi', trusted));
            expect(command, String(trusted)).to.match(/ --no-session -ne -e '/);
        }
    });

    it('has no unconditional --approve in the builtin template', () => {
        expect(piTemplate()).to.not.match(/(^|\s)--approve(\s|$)/);
        expect(piTemplate()).to.contain('{trust_flags}');
    });

    it('is registered as an extension-gated harness that can ask and reports cost', () => {
        const caps = resolveQaapHarnessCapabilities('pi');
        expect(caps).to.include({ gate: 'extension', canAsk: true, usage: 'pi-json', costSource: 'reported', shellGuard: 'gate' });
        expect(caps.askTtlSec).to.be.greaterThan(0);
        expect(caps.mapToolKind('find', {})).to.equal('read');
    });

    it('parses the --mode json stream into segments and reported usage and cost', () => {
        const log = [
            { type: 'session', version: 3, id: 's1', cwd: '/w' },
            { type: 'turn_start' },
            { type: 'message_update', message: { role: 'assistant', usage: { input: 10, output: 5, cost: { total: 0.002 } } },
                assistantMessageEvent: { type: 'text_start', contentIndex: 0 } },
            { type: 'message_update', message: { role: 'assistant', usage: { input: 10, output: 5, cost: { total: 0.002 } } },
                assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello from Pi' } },
            { type: 'turn_end', message: { role: 'assistant', usage: { input: 10, output: 5, cost: { total: 0.002 } } } },
        ].map(event => JSON.stringify(event)).join('\n') + '\n';
        const parsed = parseAgentLogForTranscript('pi', log);
        expect(parsed.content).to.contain('Hello from Pi');
        expect(parsed.segments.length).to.be.greaterThan(0);
        const acc = createAgentStreamAccumulator('pi') as unknown as {
            push(chunk: string): void; getReportedCostUsd(): number | undefined; getTotalUsage(): { usedTokens?: number } | undefined;
        };
        acc.push(log);
        expect(acc.getReportedCostUsd()).to.be.closeTo(0.002, 1e-9);
        expect(acc.getTotalUsage()).to.not.equal(undefined);
    });

    it('keeps stdin closed for extension-gated harnesses (Pi blocks on a piped stdin) but not for others', () => {
        expect(usesToolGateExtension('pi')).to.equal(true);
        expect(usesToolGateExtension('PI')).to.equal(true);
        expect(usesToolGateExtension('qaiq')).to.equal(false);
        expect(usesToolGateExtension(undefined)).to.equal(false);
        const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'node', 'qaap-agent-task-runner-timeline2.ts'), 'utf8');
        expect(source).to.match(/stdio: stdinInteractive \? \['pipe', 'pipe', 'pipe'\] : \['ignore', 'pipe', 'pipe'\]/);
        expect(source).to.contain('task.autoApprove === false && !usesToolGateExtension(');
    });

    it('keeps plain-text Pi logs readable', () => {
        expect(parseAgentLogForTranscript('pi', 'just text\n').content).to.equal('just text');
    });
});

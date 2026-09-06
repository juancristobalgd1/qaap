// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    agentUsesPlainStdinPrompt,
    applyTemplateForPromptTransport,
    applyTemplateWithoutPrompt,
    applyTemplateWithoutPromptFlag,
    applyTemplateWithStdinPrompt,
    prependPathEntry,
    resolveAgentPromptTransport,
    resolveQaiqEnvFallbackModel,
    resolveQaiqProviderFlagsFromEnv,
} from './qaap-agent-task-runner-utils';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-mobile-shell/lib/common/qaap-builtin-agents';
import { buildAgentCommandExtracted } from './qaap-agent-task-runner-streaming2';
import { captureWorktreeFingerprint, captureWorktreeStatus } from './qaap-agent-task-runner-utils2';

describe('resolveQaiqEnvFallbackModel', () => {

    it('prefers Gemini, then OpenRouter, then NVIDIA, then Ollama', () => {
        expect(resolveQaiqEnvFallbackModel({ GEMINI_API_KEY: 'g' })?.provider).to.equal('gemini');
        expect(resolveQaiqEnvFallbackModel({ OPENROUTER_API_KEY: 'or' })?.vendor).to.equal('openrouter');
        expect(resolveQaiqEnvFallbackModel({ NVIDIA_API_KEY: 'nv' })?.vendor).to.equal('nvidia');
        expect(resolveQaiqEnvFallbackModel({ OLLAMA_HOST: 'http://127.0.0.1:11434' }))
            .to.deep.equal({ provider: 'ollama', vendor: 'ollama', modelId: 'qwen2.5-coder:7b' });
    });

    it('keeps OPENAI_API_KEY-only as flags without inventing a model id', () => {
        expect(resolveQaiqEnvFallbackModel({ OPENAI_API_KEY: 'sk' })).to.equal(undefined);
        expect(resolveQaiqProviderFlagsFromEnv({ OPENAI_API_KEY: 'sk' })).to.equal('--provider openai');
        expect(resolveQaiqProviderFlagsFromEnv({ OLLAMA_HOST: 'http://127.0.0.1:11434' }))
            .to.equal('--provider ollama --model qwen2.5-coder:7b');
    });
});

describe('Codex prompt transport', () => {

    it('uses the stdin marker without putting the prompt into argv', () => {
        const prompt = 'A'.repeat(12_000);
        const result = applyTemplateWithStdinPrompt(
            'codex exec --json {model_flags} {prompt}',
            { model_flags: '-m gpt-5.6-luna' },
        );

        expect(result).to.equal('codex exec --json -m gpt-5.6-luna -');
        expect(result).not.to.contain(prompt);
    });

    it('returns long Codex task context separately from the command', () => {
        const prompt = 'A'.repeat(12_000);
        const ctx = {
            resolveAgentId: () => 'codex',
            stripLeadingAgentMention: (value: string) => value,
            readAgentInstructions: () => undefined,
            readRepoMap: () => undefined,
            readRelevantFiles: () => undefined,
            readGitStatusSnapshot: () => undefined,
            readRepoMemory: () => undefined,
            readResearchLedger: () => undefined,
            readProjectInfo: () => undefined,
            assertQaiqConfigured: () => undefined,
            detectedAgents: new Map([['codex', {
                id: 'codex',
                label: 'Codex',
                bin: 'codex',
                template: 'codex exec --json {model_flags} {prompt}',
            }]]),
            buildTemplateVars: () => ({ model_flags: '-m gpt-5.6-luna' }),
        };

        const result = buildAgentCommandExtracted(
            ctx,
            prompt,
            'codex',
            true,
            undefined,
            process.cwd(),
            undefined,
            undefined,
            'full-access',
        );

        expect(result.agentId).to.equal('codex');
        expect(result.stdinPromptMode).to.equal('plain');
        expect(result.stdinPrompt).to.contain(prompt);
        expect(result.command).to.match(/\s-$/);
        expect(result.command.length).to.be.lessThan(1_000);
    });
});

describe('agentUsesPlainStdinPrompt', () => {

    it('covers stdin harnesses and leaves shell on argv', () => {
        expect(agentUsesPlainStdinPrompt('cursor', { bin: 'cursor-agent' })).to.equal(true);
        expect(agentUsesPlainStdinPrompt('cursor', { bin: 'agent' })).to.equal(true);
        expect(agentUsesPlainStdinPrompt('codex', {
            bin: 'codex',
            template: 'codex exec --json {model_flags} {prompt}',
        })).to.equal(true);
        expect(agentUsesPlainStdinPrompt('claude', { bin: 'claude' })).to.equal(true);
        expect(agentUsesPlainStdinPrompt('qaiq', { bin: 'qaiq' })).to.equal(true);
        expect(agentUsesPlainStdinPrompt('shell')).to.equal(false);
        expect(resolveAgentPromptTransport('grok', { bin: 'grok' })).to.deep.equal({
            kind: 'prompt-file',
            flag: '--prompt-file',
        });
    });
});

describe('Windows-safe prompt transport', () => {

    it('strips prompt-taking -p flags without leaving a dangling -p', () => {
        expect(applyTemplateWithoutPromptFlag(
            'copilot --autopilot --yolo --max-autopilot-continues 20 -p {prompt}',
        )).to.equal('copilot --autopilot --yolo --max-autopilot-continues 20');
        expect(applyTemplateWithoutPromptFlag(
            'gemini --approval-mode=yolo -p {prompt}',
        )).to.equal('gemini --approval-mode=yolo');
        expect(applyTemplateWithoutPromptFlag(
            'grok --always-approve {model_flags} -p {prompt}',
            { model_flags: '-m grok-4.5' },
        )).to.equal('grok --always-approve -m grok-4.5');
    });

    it('keeps Claude/Cursor -p print flags when only the prompt token is omitted', () => {
        expect(applyTemplateForPromptTransport(
            'claude --print --output-format stream-json -p {prompt}',
            { kind: 'plain-stdin', placeholder: 'omit' },
        )).to.equal('claude --print --output-format stream-json -p');
        expect(applyTemplateForPromptTransport(
            'cursor-agent -p --force {prompt}',
            { kind: 'plain-stdin', placeholder: 'omit' },
        )).to.equal('cursor-agent -p --force');
    });

    it('uses - as the Codex / flag-value stdin marker', () => {
        expect(applyTemplateForPromptTransport(
            'codex exec --json {model_flags} {prompt}',
            { kind: 'plain-stdin', placeholder: 'dash' },
            { model_flags: '-m gpt-5.6-luna' },
        )).to.equal('codex exec --json -m gpt-5.6-luna -');
        expect(applyTemplateForPromptTransport(
            'hermes --yolo chat -Q -q {prompt}',
            { kind: 'plain-stdin', placeholder: 'dash' },
        )).to.equal('hermes --yolo chat -Q -q -');
    });

    it('routes every shipped harness off argv', () => {
        for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
            const transport = resolveAgentPromptTransport(definition.id, definition);
            expect(transport.kind, definition.id).to.not.equal('argv');
            const command = applyTemplateForPromptTransport(
                definition.template,
                transport,
                { model_flags: '-m test-model', qaiq_flags: '--provider test' },
            );
            expect(command, definition.id).not.to.match(/A{20}/);
            expect(command.length, definition.id).to.be.lessThan(400);
        }
        expect(resolveAgentPromptTransport('qaiq', {
            id: 'qaiq',
            bin: 'qaiq',
            template: 'qaiq --print {qaiq_flags} {prompt}',
        }).kind).to.equal('plain-stdin');
    });
});

describe('Cursor Agent prompt transport', () => {

    it('sends a long prompt on stdin so Windows cmd.exe is not overflowed', () => {
        const prompt = 'A'.repeat(12_000);
        const ctx = {
            resolveAgentId: () => 'cursor',
            stripLeadingAgentMention: (value: string) => value,
            readAgentInstructions: () => 'INSTRUCTIONS'.repeat(200),
            readRepoMap: () => 'MAP'.repeat(200),
            readRelevantFiles: () => undefined,
            readGitStatusSnapshot: () => undefined,
            readRepoMemory: () => undefined,
            readResearchLedger: () => undefined,
            readProjectInfo: () => undefined,
            assertQaiqConfigured: () => undefined,
            applyTemplateWithoutPrompt,
            detectedAgents: new Map([['cursor', {
                id: 'cursor',
                label: 'Cursor Agent',
                bin: 'cursor-agent',
                template: 'cursor-agent -p --force {prompt}',
            }]]),
            buildTemplateVars: () => ({}),
        };

        const result = buildAgentCommandExtracted(
            ctx,
            prompt,
            'cursor',
            true,
            undefined,
            process.cwd(),
            undefined,
            undefined,
            'full-access',
        );

        expect(result.agentId).to.equal('cursor');
        expect(result.stdinPromptMode).to.equal('plain');
        expect(result.stdinPrompt).to.contain(prompt);
        expect(result.command).to.match(/^cursor-agent\b/);
        expect(result.command).not.to.contain(prompt);
        expect(result.command.length).to.be.lessThan(200);
    });

    it('uses the official `agent` binary the same way', () => {
        const prompt = 'B'.repeat(9_000);
        const result = buildAgentCommandExtracted(
            {
                resolveAgentId: () => 'cursor',
                stripLeadingAgentMention: (value: string) => value,
                readAgentInstructions: () => undefined,
                readRepoMap: () => undefined,
                readRelevantFiles: () => undefined,
                readGitStatusSnapshot: () => undefined,
                readRepoMemory: () => undefined,
                readResearchLedger: () => undefined,
                readProjectInfo: () => undefined,
                assertQaiqConfigured: () => undefined,
                applyTemplateWithoutPrompt,
                detectedAgents: new Map([['cursor', {
                    id: 'cursor',
                    label: 'Cursor Agent',
                    bin: 'agent',
                    template: 'agent -p --force {prompt}',
                }]]),
                buildTemplateVars: () => ({}),
            },
            prompt,
            'cursor',
            true,
            undefined,
            process.cwd(),
            undefined,
            undefined,
            'full-access',
        );

        expect(result.command).to.match(/^agent\b/);
        expect(result.command).not.to.contain(prompt);
        expect(result.stdinPromptMode).to.equal('plain');
        expect(result.stdinPrompt).to.contain(prompt);
        expect(result.command.length).to.be.lessThan(200);
    });
});

function commandCtx(id: string, template: string, bin = id): {
    resolveAgentId: () => string;
    stripLeadingAgentMention: (value: string) => string;
    readAgentInstructions: () => undefined;
    readRepoMap: () => undefined;
    readRelevantFiles: () => undefined;
    readGitStatusSnapshot: () => undefined;
    readRepoMemory: () => undefined;
    readResearchLedger: () => undefined;
    readProjectInfo: () => undefined;
    assertQaiqConfigured: () => undefined;
    applyTemplateWithoutPrompt: typeof applyTemplateWithoutPrompt;
    detectedAgents: Map<string, { id: string; label: string; bin: string; template: string }>;
    buildTemplateVars: () => Record<string, string>;
} {
    return {
        resolveAgentId: () => id,
        stripLeadingAgentMention: (value: string) => value,
        readAgentInstructions: () => undefined,
        readRepoMap: () => undefined,
        readRelevantFiles: () => undefined,
        readGitStatusSnapshot: () => undefined,
        readRepoMemory: () => undefined,
        readResearchLedger: () => undefined,
        readProjectInfo: () => undefined,
        assertQaiqConfigured: () => undefined,
        applyTemplateWithoutPrompt,
        detectedAgents: new Map([[id, { id, label: id, bin, template }]]),
        buildTemplateVars: () => ({}),
    };
}

describe('other harness prompt transport', () => {

    const longPrompt = 'C'.repeat(10_000);

    it('sends Claude, OpenCode, Copilot, and QAIQ prompts on stdin', () => {
        const cases: Array<{ id: string; template: string; leading: RegExp }> = [
            { id: 'claude', template: 'claude --print -p {prompt}', leading: /^claude\b/ },
            { id: 'opencode', template: 'opencode run --format json --dangerously-skip-permissions {prompt}', leading: /^opencode\b/ },
            { id: 'copilot', template: 'copilot --autopilot --yolo --max-autopilot-continues 20 -p {prompt}', leading: /^copilot\b/ },
            { id: 'qaiq', template: 'qaiq --print --output-format stream-json {prompt}', leading: /^qaiq\b/ },
        ];
        for (const entry of cases) {
            const result = buildAgentCommandExtracted(
                commandCtx(entry.id, entry.template),
                longPrompt,
                entry.id,
                true,
                undefined,
                process.cwd(),
                undefined,
                undefined,
                'full-access',
            );
            expect(result.stdinPromptMode, entry.id).to.equal('plain');
            expect(result.stdinPrompt, entry.id).to.contain(longPrompt);
            expect(result.command, entry.id).to.match(entry.leading);
            expect(result.command, entry.id).not.to.contain(longPrompt);
            expect(result.command.length, entry.id).to.be.lessThan(1_000);
        }
    });

    it('writes a Grok prompt file instead of overflowing argv', () => {
        const result = buildAgentCommandExtracted(
            commandCtx('grok', 'grok --always-approve -p {prompt}'),
            longPrompt,
            'grok',
            true,
            undefined,
            process.cwd(),
            undefined,
            undefined,
            'full-access',
        );
        const match = /--prompt-file\s+"?([^"]+)"?/.exec(result.command)
            ?? /--prompt-file\s+'([^']+)'/.exec(result.command);
        expect(result.stdinPromptMode).to.equal(undefined);
        expect(result.command).not.to.contain(longPrompt);
        expect(match, result.command).to.not.equal(null);
        const file = match![1];
        try {
            expect(fs.readFileSync(file, 'utf8')).to.contain(longPrompt);
        } finally {
            fs.rmSync(path.dirname(file), { recursive: true, force: true });
        }
    });
});

describe('prependPathEntry', () => {

    it('preserves Windows Path casing instead of creating a shadow PATH entry', () => {
        const env: NodeJS.ProcessEnv = { Path: 'C:\\existing' };

        prependPathEntry(env, 'C:\\helper-bin');

        expect(env.Path).to.equal(`C:\\helper-bin${path.delimiter}C:\\existing`);
        expect(env.PATH).to.equal(undefined);
    });
});

describe('captureWorktreeStatus isolation', () => {

    it('does not report a parent repository when cwd has no .git', () => {
        const nested = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-worktree-nongit-'));
        try {
            expect(captureWorktreeStatus(nested)).to.equal(undefined);
            expect(captureWorktreeFingerprint(nested)).to.equal(undefined);
        } finally {
            fs.rmSync(nested, { recursive: true, force: true });
        }
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    applyTemplateWithStdinPrompt,
    prependPathEntry,
    resolveQaiqEnvFallbackModel,
    resolveQaiqProviderFlagsFromEnv,
} from './qaap-agent-task-runner-utils';
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

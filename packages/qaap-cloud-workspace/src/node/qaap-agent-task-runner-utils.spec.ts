// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    resolveQaiqEnvFallbackModel,
    resolveQaiqProviderFlagsFromEnv,
} from './qaap-agent-task-runner-utils';
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

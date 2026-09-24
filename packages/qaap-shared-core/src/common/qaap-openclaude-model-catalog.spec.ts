// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// ****************************************************************************

import { expect } from 'chai';
import { listOpenClaudeNativeModels } from './qaap-openclaude-model-catalog';

describe('listOpenClaudeNativeModels', () => {
    it('exposes OpenClaude presets independently of the QAIQ Settings catalog', () => {
        const models = listOpenClaudeNativeModels();
        expect(models.map(model => model.modelId)).to.deep.equal([
            'claude-sonnet-4-6',
            'claude-opus-4-7',
            'claude-haiku-4-5',
            'gpt-4o',
            'gpt-5.4',
            'gemini-3.1-pro',
            'mistral-large-latest',
            'qwen2.5-coder:7b',
        ]);
        expect(models.every(model => model.label.trim().length > 0)).to.be.true;
    });
});

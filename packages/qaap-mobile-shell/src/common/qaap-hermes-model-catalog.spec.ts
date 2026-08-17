// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { hermesNativeModelOption, listHermesNativeModels } from './qaap-hermes-model-catalog';

describe('listHermesNativeModels', () => {
    it('exposes Hermes catalog slugs independently of the QAIQ Settings catalog', () => {
        const models = listHermesNativeModels();
        const ids = models.map(model => model.modelId);
        expect(ids).to.include.members([
            'anthropic/claude-fable-5',
            'anthropic/claude-sonnet-5',
            'openai/gpt-5.6-sol',
            'google/gemini-3.7-flash',
            'z-ai/glm-5.2',
        ]);
        expect(ids[0]).to.equal('anthropic/claude-fable-5');
        expect(ids).to.not.include('tencent/hy3');
        expect(ids).to.not.include('tencent/hy3:free');
        expect(models.every(model => model.label.trim().length > 0)).to.equal(true);
        expect(models.find(model => model.modelId === 'anthropic/claude-fable-5')).to.include({
            provider: 'anthropic',
            vendor: 'anthropic',
            label: 'Claude Fable 5',
        });
        expect(models.find(model => model.modelId === 'google/gemini-3.7-flash')).to.include({
            provider: 'gemini',
            vendor: 'google',
        });
    });

    it('drops excluded and tool-less OpenRouter slugs', () => {
        expect(hermesNativeModelOption('tencent/hy3:free')).to.equal(undefined);
        expect(hermesNativeModelOption('deepseek/deepseek-v4-flash:free')).to.equal(undefined);
        expect(hermesNativeModelOption('anthropic/claude-sonnet-5')?.modelId).to.equal('anthropic/claude-sonnet-5');
    });
});

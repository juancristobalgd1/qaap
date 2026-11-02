// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { OPENROUTER_DEFAULT_FREE_MODELS } from '@theia/qaap-ai-openrouter/lib/common/openrouter-models';
import { PI_DEFAULT_OPENROUTER_MODEL_ID, resolvePiDefaultModelFlag } from './qaap-pi-default-model';

const OPENROUTER_AUTH = '{"openrouter":{"type":"api_key","key":"x"}}';

describe('qaap-pi-default-model', () => {
    it('reuses the head of the OpenRouter free default list', () => {
        expect(PI_DEFAULT_OPENROUTER_MODEL_ID).to.equal(OPENROUTER_DEFAULT_FREE_MODELS[0]);
    });

    it('passes the OpenRouter default when the owner has OpenRouter sign-in or key and no pin', () => {
        expect(resolvePiDefaultModelFlag({ authJson: OPENROUTER_AUTH, openRouterKeyInEnv: false }))
            .to.equal(`--model openrouter/${OPENROUTER_DEFAULT_FREE_MODELS[0]}`);
        expect(resolvePiDefaultModelFlag({ openRouterKeyInEnv: true, settingsJson: '{}' }))
            .to.equal(`--model openrouter/${OPENROUTER_DEFAULT_FREE_MODELS[0]}`);
    });

    it('keeps the owner pin: defaultModel or defaultProvider in settings.json wins', () => {
        expect(resolvePiDefaultModelFlag({ settingsJson: '{"defaultModel":"moonshotai/kimi-k2.6"}', authJson: OPENROUTER_AUTH, openRouterKeyInEnv: true })).to.equal('');
        expect(resolvePiDefaultModelFlag({ settingsJson: '{"defaultProvider":"anthropic"}', openRouterKeyInEnv: true })).to.equal('');
    });

    it('ignores blank pins and unreadable settings', () => {
        expect(resolvePiDefaultModelFlag({ settingsJson: '{"defaultModel":"  "}', openRouterKeyInEnv: true }))
            .to.not.equal('');
        expect(resolvePiDefaultModelFlag({ settingsJson: '{not json', openRouterKeyInEnv: true }))
            .to.not.equal('');
    });

    it('leaves Pi to its own choice when the owner cannot reach OpenRouter', () => {
        expect(resolvePiDefaultModelFlag({ authJson: '{"anthropic":{}}', openRouterKeyInEnv: false })).to.equal('');
        expect(resolvePiDefaultModelFlag({ openRouterKeyInEnv: false })).to.equal('');
    });
});

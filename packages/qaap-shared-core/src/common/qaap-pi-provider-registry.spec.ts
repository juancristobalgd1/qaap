// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { findQaiqByokProvider, listQaapAiSettingsPrefKeys } from './qaap-qaiq-byok-provider-registry';
import { QAAP_PI_PROVIDERS, QaapPiProviders } from './qaap-pi-provider-registry';

describe('qaap-pi-provider-registry', () => {

    it('keeps every Pi key preference under the AI settings prefix, and every new one ending in ApiKey (masked and sealed)', () => {
        for (const descriptor of QAAP_PI_PROVIDERS) {
            expect(descriptor.pref.startsWith('ai-features.'), descriptor.pref).to.equal(true);
        }
        for (const pref of QaapPiProviders.newPrefIds()) {
            expect(pref.endsWith('ApiKey'), pref).to.equal(true);
        }
    });

    it('maps the providers that reuse Settings preferences to the environment variables Pi reads', () => {
        const byProvider = (piProvider: string): string | undefined => QAAP_PI_PROVIDERS.find(d => d.piProvider === piProvider)?.env;
        expect(byProvider('google')).to.equal('GEMINI_API_KEY');
        expect(byProvider('huggingface')).to.equal('HF_TOKEN');
        expect(byProvider('vercel-ai-gateway')).to.equal('AI_GATEWAY_API_KEY');
    });

    it('lists only the preferences this registry adds as new Pi preferences', () => {
        const ids = QaapPiProviders.newPrefIds();
        expect(ids).to.include('ai-features.pi.deepseekApiKey');
        expect(ids).to.include('ai-features.pi.kimiCodingApiKey');
        expect(ids).not.to.include('ai-features.google.apiKey');
        for (const id of ids) {
            expect(id.startsWith('ai-features.pi.'), id).to.equal(true);
        }
    });

    it('applyEnv sets only providers with a non-empty trimmed key', () => {
        const values: Record<string, unknown> = {
            'ai-features.openAiOfficial.openAiApiKey': '  sk-openai  ',
            'ai-features.pi.groqApiKey': '   ',
            'ai-features.pi.deepseekApiKey': 42,
            'ai-features.pi.mistralApiKey': 'sk-mistral',
        };
        const env: Record<string, string | undefined> = { OPENAI_API_KEY: 'operator', GROQ_API_KEY: undefined };
        QaapPiProviders.applyEnv(env, key => values[key]);
        expect(env).to.deep.equal({ OPENAI_API_KEY: 'sk-openai', MISTRAL_API_KEY: 'sk-mistral', GROQ_API_KEY: undefined });
    });

    it('configuredProviders returns the sorted Pi provider ids that have a key', () => {
        const values: Record<string, unknown> = {
            'ai-features.pi.mistralApiKey': 'sk-mistral',
            'ai-features.anthropic.AnthropicApiKey': 'sk-anthropic',
            'ai-features.pi.groqApiKey': '',
        };
        expect(QaapPiProviders.configuredProviders(key => values[key])).to.deep.equal(['anthropic', 'mistral']);
        expect(QaapPiProviders.configuredProviders(() => undefined)).to.deep.equal([]);
    });

    it('adds the new Pi preferences to the per-user AI settings keys', () => {
        const keys = listQaapAiSettingsPrefKeys();
        for (const id of QaapPiProviders.newPrefIds()) {
            expect(keys).to.include(id);
        }
    });

    it('leaves the QAIQ BYOK registry unchanged: Pi-only providers stay out of QAIQ', () => {
        expect(findQaiqByokProvider('mistral')).to.equal(undefined);
        expect(findQaiqByokProvider('deepseek')).to.equal(undefined);
    });
});

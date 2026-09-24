// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { AnthropicLanguageModelsManagerImpl } from '@theia/ai-anthropic/lib/node/anthropic-language-models-manager-impl';
import { GoogleLanguageModelsManagerImpl } from '@theia/ai-google/lib/node/google-language-models-manager-impl';
import { OllamaLanguageModelsManagerImpl } from '@theia/ai-ollama/lib/node/ollama-language-models-manager-impl';
import { OpenAiLanguageModelsManagerImpl } from '@theia/ai-openai/lib/node/openai-language-models-manager-impl';
import { VercelAiLanguageModelFactory } from '@theia/ai-vercel-ai/lib/node/vercel-ai-language-model-factory';
import { installQaapAiProviderEnvTenantScope, shouldHideOperatorProviderEnv } from './qaap-ai-provider-env-tenant-scope';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

const OPERATOR_ENV: Record<string, string> = {
    OPENAI_API_KEY: 'operator-openai',
    ANTHROPIC_API_KEY: 'operator-anthropic',
    GOOGLE_API_KEY: 'operator-google',
    OLLAMA_HOST: 'http://operator-ollama:11434',
};

describe('qaap-ai-provider-env-tenant-scope', () => {

    const registry = new QaapWebsocketAuthRegistry();
    const saved: Record<string, string | undefined> = {};

    before(() => {
        installQaapAiProviderEnvTenantScope(registry);
        for (const [key, value] of Object.entries(OPERATOR_ENV)) {
            saved[key] = process.env[key];
            process.env[key] = value;
        }
    });

    after(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    function managers(pushed?: string): Record<string, { apiKey?: string; host?: string }> {
        const create = <T extends object>(prototype: T, field: string): T => Object.assign(Object.create(prototype), { [field]: pushed });
        return {
            openai: create(OpenAiLanguageModelsManagerImpl.prototype, '_apiKey'),
            anthropic: create(AnthropicLanguageModelsManagerImpl.prototype, '_apiKey'),
            google: create(GoogleLanguageModelsManagerImpl.prototype, '_apiKey'),
            ollama: create(OllamaLanguageModelsManagerImpl.prototype, '_host'),
        };
    }

    const read = (login: string | undefined, pushed?: string): unknown[] => registry.runWithLogin(login, () => {
        const { openai, anthropic, google, ollama } = managers(pushed);
        return [openai.apiKey, anthropic.apiKey, google.apiKey, ollama.host];
    });

    const vercelKey = (login: string | undefined, apiKey?: string): unknown => registry.runWithLogin(login, () =>
        (Object.create(VercelAiLanguageModelFactory.prototype) as unknown as {
            getApiKeyBasedOnProvider(config: { provider: string; apiKey?: string }): string | undefined;
        }).getApiKeyBasedOnProvider({ provider: 'openai', apiKey }));

    it('hides the operator env from authenticated tenants', () => {
        expect(shouldHideOperatorProviderEnv('alice')).to.equal(true);
        expect(read('alice')).to.deep.equal([undefined, undefined, undefined, undefined]);
        expect(vercelKey('alice')).to.equal(undefined);
    });

    it('still uses the key the tenant pushed', () => {
        expect(read('alice', 'mine')).to.deep.equal(['mine', 'mine', 'mine', 'mine']);
        expect(vercelKey('alice', 'mine')).to.equal('mine');
    });

    it('keeps the upstream env fallback for local, skip-auth, anonymous and non-RPC callers', () => {
        const operator = [OPERATOR_ENV.OPENAI_API_KEY, OPERATOR_ENV.ANTHROPIC_API_KEY, OPERATOR_ENV.GOOGLE_API_KEY, OPERATOR_ENV.OLLAMA_HOST];
        for (const login of [undefined, '_dev', '_anonymous']) {
            expect(shouldHideOperatorProviderEnv(login), String(login)).to.equal(false);
            expect(read(login), String(login)).to.deep.equal(operator);
            expect(vercelKey(login), String(login)).to.equal(OPERATOR_ENV.OPENAI_API_KEY);
        }
        expect(read('_dev', 'mine')).to.deep.equal(['mine', 'mine', 'mine', 'mine']);
    });
});

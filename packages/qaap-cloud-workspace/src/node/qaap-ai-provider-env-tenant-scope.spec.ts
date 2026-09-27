// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { AnthropicLanguageModelsManagerImpl } from '@theia/ai-anthropic/lib/node/anthropic-language-models-manager-impl';
import { GoogleLanguageModelsManagerImpl } from '@theia/ai-google/lib/node/google-language-models-manager-impl';
import { HuggingFaceLanguageModelsManagerImpl } from '@theia/ai-huggingface/lib/node/huggingface-language-models-manager-impl';
import { OllamaLanguageModelsManagerImpl } from '@theia/ai-ollama/lib/node/ollama-language-models-manager-impl';
import { OpenAiLanguageModelsManagerImpl } from '@theia/ai-openai/lib/node/openai-language-models-manager-impl';
import { VercelAiLanguageModelFactory } from '@theia/ai-vercel-ai/lib/node/vercel-ai-language-model-factory';
import { installQaapAiProviderEnvTenantScope, shouldHideOperatorProviderEnv, withholdOperatorEnvFromClaudeCode } from './qaap-ai-provider-env-tenant-scope';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

const OPERATOR_ENV: Record<string, string | undefined> = {
    // Single-user / local runtime unless a test opts into another mode.
    NODE_ENV: undefined,
    QAAP_CLOUD_MODE: undefined,
    QAAP_TENANT_BACKEND_MODE: undefined,
    OPENAI_API_VERSION: 'operator-azure-version',
    OPENAI_API_KEY: 'operator-openai',
    ANTHROPIC_API_KEY: 'operator-anthropic',
    GOOGLE_API_KEY: 'operator-google',
    OLLAMA_HOST: 'http://operator-ollama:11434',
    HUGGINGFACE_API_KEY: 'operator-hf',
};

describe('qaap-ai-provider-env-tenant-scope', () => {

    const registry = new QaapWebsocketAuthRegistry();
    const saved: Record<string, string | undefined> = {};

    before(() => {
        installQaapAiProviderEnvTenantScope(registry);
        for (const [key, value] of Object.entries(OPERATOR_ENV)) {
            saved[key] = process.env[key];
            setEnv(key, value);
        }
    });

    afterEach(() => {
        setEnv('QAAP_CLOUD_MODE', undefined);
        setEnv('QAAP_TENANT_BACKEND_MODE', undefined);
    });

    after(() => {
        for (const [key, value] of Object.entries(saved)) {
            setEnv(key, value);
        }
    });

    function setEnv(key: string, value: string | undefined): void {
        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    function managers(pushed?: string): Record<string, { apiKey?: string; host?: string }> {
        const create = <T extends object>(prototype: T, field: string): T => Object.assign(Object.create(prototype), { [field]: pushed });
        return {
            openai: Object.assign(create(OpenAiLanguageModelsManagerImpl.prototype, '_apiKey'), { _apiVersion: pushed }),
            anthropic: create(AnthropicLanguageModelsManagerImpl.prototype, '_apiKey'),
            google: create(GoogleLanguageModelsManagerImpl.prototype, '_apiKey'),
            ollama: create(OllamaLanguageModelsManagerImpl.prototype, '_host'),
        };
    }

    const read = (login: string | undefined, pushed?: string): unknown[] => registry.runWithLogin(login, () => {
        const { openai, anthropic, google, ollama } = managers(pushed);
        return [openai.apiKey, anthropic.apiKey, google.apiKey, ollama.host, (openai as { apiVersion?: string }).apiVersion];
    });

    const vercelKey = (login: string | undefined, apiKey?: string): unknown => registry.runWithLogin(login, () =>
        (Object.create(VercelAiLanguageModelFactory.prototype) as unknown as {
            getApiKeyBasedOnProvider(config: { provider: string; apiKey?: string }): string | undefined;
        }).getApiKeyBasedOnProvider({ provider: 'openai', apiKey }));

    it('hides the operator env from authenticated tenants', () => {
        expect(shouldHideOperatorProviderEnv('alice')).to.equal(true);
        expect(read('alice')).to.deep.equal([undefined, undefined, undefined, undefined, undefined]);
        expect(vercelKey('alice')).to.equal(undefined);
    });

    it('still uses the key the tenant pushed', () => {
        expect(read('alice', 'mine')).to.deep.equal(['mine', 'mine', 'mine', 'mine', 'mine']);
        expect(vercelKey('alice', 'mine')).to.equal('mine');
    });

    it('keeps the upstream env fallback for local, skip-auth, anonymous and non-RPC callers', () => {
        const operator = [OPERATOR_ENV.OPENAI_API_KEY, OPERATOR_ENV.ANTHROPIC_API_KEY, OPERATOR_ENV.GOOGLE_API_KEY, OPERATOR_ENV.OLLAMA_HOST,
            OPERATOR_ENV.OPENAI_API_VERSION];
        for (const login of [undefined, '_dev', '_anonymous']) {
            expect(shouldHideOperatorProviderEnv(login), String(login)).to.equal(false);
            expect(read(login), String(login)).to.deep.equal(operator);
            expect(vercelKey(login), String(login)).to.equal(OPERATOR_ENV.OPENAI_API_KEY);
        }
        expect(read('_dev', 'mine')).to.deep.equal(['mine', 'mine', 'mine', 'mine', 'mine']);
    });

    it('fails closed for every caller, including no login and anonymous, on a multi-user backend', () => {
        setEnv('QAAP_CLOUD_MODE', 'docker');
        for (const login of [undefined, '_anonymous', 'alice']) {
            expect(shouldHideOperatorProviderEnv(login), String(login)).to.equal(true);
            expect(read(login), String(login)).to.deep.equal([undefined, undefined, undefined, undefined, undefined]);
            expect(vercelKey(login), String(login)).to.equal(undefined);
        }
        expect(read(undefined, 'pushed')).to.deep.equal(['pushed', 'pushed', 'pushed', 'pushed', 'pushed']);
    });

    it('a dedicated per-tenant backend is single-user: its (operator-free) env stays readable without a login', () => {
        setEnv('QAAP_CLOUD_MODE', 'docker');
        setEnv('QAAP_TENANT_BACKEND_MODE', '1');
        expect(shouldHideOperatorProviderEnv(undefined)).to.equal(false);
        expect(shouldHideOperatorProviderEnv('alice')).to.equal(true);
    });
    it('hides the operator Hugging Face key from tenants but keeps the pushed one', () => {
        const hf = (login: string | undefined, pushed?: string): unknown => registry.runWithLogin(login, () =>
            (Object.assign(Object.create(HuggingFaceLanguageModelsManagerImpl.prototype), { _apiKey: pushed }) as { apiKey?: string }).apiKey);
        expect(hf('alice')).to.equal(undefined);
        expect(hf('alice', 'mine')).to.equal('mine');
        expect(hf(undefined)).to.equal(OPERATOR_ENV.HUGGINGFACE_API_KEY);
    });

    it('Claude Code spawn env drops the operator Anthropic fallback and shared secrets, keeps the pushed key', () => {
        const operatorEnv = { ANTHROPIC_API_KEY: 'operator-anthropic', OPENAI_API_KEY: 'operator-openai', QAAP_GITHUB_CLIENT_SECRET: 's', PATH: '/bin' };
        const fallback = withholdOperatorEnvFromClaudeCode({ ...operatorEnv, NODE_OPTIONS: '' }, 'alice', operatorEnv);
        expect(fallback).to.not.have.any.keys('ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'QAAP_GITHUB_CLIENT_SECRET');
        expect(fallback.PATH).to.equal('/bin');
        const pushed = withholdOperatorEnvFromClaudeCode({ ...operatorEnv, ANTHROPIC_API_KEY: 'mine' }, 'alice', operatorEnv);
        expect(pushed.ANTHROPIC_API_KEY).to.equal('mine');
        expect(pushed).to.not.have.any.keys('OPENAI_API_KEY');
    });
});

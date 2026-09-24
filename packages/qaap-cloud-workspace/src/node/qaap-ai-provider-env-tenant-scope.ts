// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AnthropicLanguageModelsManagerImpl } from '@theia/ai-anthropic/lib/node/anthropic-language-models-manager-impl';
import { GoogleLanguageModelsManagerImpl } from '@theia/ai-google/lib/node/google-language-models-manager-impl';
import { OllamaLanguageModelsManagerImpl } from '@theia/ai-ollama/lib/node/ollama-language-models-manager-impl';
import { OpenAiLanguageModelsManagerImpl } from '@theia/ai-openai/lib/node/openai-language-models-manager-impl';
import { VercelAiLanguageModelFactory, VercelAiProviderConfig } from '@theia/ai-vercel-ai/lib/node/vercel-ai-language-model-factory';
import { mustWithholdOperatorProviderCredentials } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapWebsocketAuthRegistry } from './qaap-websocket-auth-registry';

/**
 * Whether the operator's provider env (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OLLAMA_HOST`, …) must be hidden
 * from the current caller: authenticated tenants use only the keys their own frontend pushed, and on a
 * multi-user backend so does every other caller (no login, anonymous) — fail closed like the keystore RPC.
 * Local / skip-auth single-user runs keep the upstream env fallback. Per-tenant backends never receive
 * those env vars in the first place.
 */
export function shouldHideOperatorProviderEnv(login: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
    return mustWithholdOperatorProviderCredentials(login?.trim() || undefined, env);
}

/**
 * Per-connection AI language-model managers read the pushed key and fall back to `process.env`. The getters run
 * inside the frontend RPC call (model status on push, client creation on request), where
 * {@link QaapWebsocketAuthRegistry.getCurrentLogin} names the caller.
 */
interface QaapEnvBackedGetter {
    readonly prototype: object;
    readonly property: string;
    /** Field holding the value the frontend pushed (the getter's non-env source). */
    readonly field: string;
}

const ENV_BACKED_GETTERS: readonly QaapEnvBackedGetter[] = [
    { prototype: OpenAiLanguageModelsManagerImpl.prototype, property: 'apiKey', field: '_apiKey' },
    // OPENAI_API_VERSION switches the client to Azure OpenAI: an operator's Azure setup must not redirect tenants' keys.
    { prototype: OpenAiLanguageModelsManagerImpl.prototype, property: 'apiVersion', field: '_apiVersion' },
    { prototype: AnthropicLanguageModelsManagerImpl.prototype, property: 'apiKey', field: '_apiKey' },
    { prototype: GoogleLanguageModelsManagerImpl.prototype, property: 'apiKey', field: '_apiKey' },
    { prototype: OllamaLanguageModelsManagerImpl.prototype, property: 'host', field: '_host' },
];

let installed = false;

export function installQaapAiProviderEnvTenantScope(registry: QaapWebsocketAuthRegistry): void {
    if (installed) {
        return;
    }
    installed = true;
    const hide = (): boolean => shouldHideOperatorProviderEnv(registry.getCurrentLogin());
    for (const { prototype, property, field } of ENV_BACKED_GETTERS) {
        const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
        const originalGet = descriptor?.get;
        if (!descriptor || !originalGet) {
            console.warn(`[qaap-ai-provider-env] ${prototype.constructor.name}.${property} is not a getter; operator env stays visible.`);
            continue;
        }
        Object.defineProperty(prototype, property, {
            ...descriptor,
            get(this: Record<string, unknown>): unknown {
                return hide() ? this[field] : originalGet.call(this);
            },
        });
    }

    // Vercel AI: `getApiKeyBasedOnProvider` (private upstream) falls back to OPENAI_API_KEY / ANTHROPIC_API_KEY.
    const vercelPrototype = VercelAiLanguageModelFactory.prototype as unknown as {
        getApiKeyBasedOnProvider(config: VercelAiProviderConfig): string | undefined;
    };
    const originalVercel = vercelPrototype.getApiKeyBasedOnProvider;
    if (typeof originalVercel === 'function') {
        vercelPrototype.getApiKeyBasedOnProvider = function patchedGetApiKeyBasedOnProvider(config: VercelAiProviderConfig): string | undefined {
            return hide() ? config.apiKey || undefined : originalVercel.call(this, config);
        };
    } else {
        console.warn('[qaap-ai-provider-env] VercelAiLanguageModelFactory.getApiKeyBasedOnProvider not found; operator env stays visible.');
    }
}

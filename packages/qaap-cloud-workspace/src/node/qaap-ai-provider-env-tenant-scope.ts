// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { AnthropicLanguageModelsManagerImpl } from '@theia/ai-anthropic/lib/node/anthropic-language-models-manager-impl';
import { ClaudeCodeServiceImpl } from '@theia/ai-claude-code/lib/node/claude-code-service-impl';
import { GoogleLanguageModelsManagerImpl } from '@theia/ai-google/lib/node/google-language-models-manager-impl';
import { HuggingFaceLanguageModelsManagerImpl } from '@theia/ai-huggingface/lib/node/huggingface-language-models-manager-impl';
import { OllamaLanguageModelsManagerImpl } from '@theia/ai-ollama/lib/node/ollama-language-models-manager-impl';
import { OpenAiLanguageModelsManagerImpl } from '@theia/ai-openai/lib/node/openai-language-models-manager-impl';
import { VercelAiLanguageModelFactory, VercelAiProviderConfig } from '@theia/ai-vercel-ai/lib/node/vercel-ai-language-model-factory';
import { mustWithholdOperatorProviderCredentials } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { stripSharedProviderEnv } from './qaap-agent-task-runner-utils2';
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
    { prototype: HuggingFaceLanguageModelsManagerImpl.prototype, property: 'apiKey', field: '_apiKey' },
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

    // Claude Code: `sendMessages` spawns the CLI with `{ ...process.env, ANTHROPIC_API_KEY: request.apiKey || env }`,
    // i.e. every operator credential plus the operator's Anthropic key when the user pushed none. Wrap the SDK's
    // `query` so the spawn env goes through the same chokepoint as agent tasks.
    const claudeCodePrototype = ClaudeCodeServiceImpl.prototype as unknown as {
        importClaudeCodeSDK(customClaudeCodePath?: string): Promise<{ query: unknown; SDKUserMessage: unknown; Options: unknown }>;
    };
    const originalImport = claudeCodePrototype.importClaudeCodeSDK;
    if (typeof originalImport === 'function') {
        claudeCodePrototype.importClaudeCodeSDK = async function patchedImportClaudeCodeSDK(
            customClaudeCodePath?: string
        ): Promise<{ query: unknown; SDKUserMessage: unknown; Options: unknown }> {
            const login = registry.getCurrentLogin();
            const sdk = await originalImport.call(this, customClaudeCodePath);
            if (!shouldHideOperatorProviderEnv(login) || typeof sdk.query !== 'function') {
                return sdk;
            }
            const query = sdk.query as (args: QaapClaudeCodeQueryArgs) => unknown;
            return {
                ...sdk,
                query: (args: QaapClaudeCodeQueryArgs): unknown => query({
                    ...args,
                    options: args.options && { ...args.options, env: withholdOperatorEnvFromClaudeCode(args.options.env, login) },
                }),
            };
        };
    } else {
        console.warn('[qaap-ai-provider-env] ClaudeCodeServiceImpl.importClaudeCodeSDK not found; operator env stays visible.');
    }
}

interface QaapClaudeCodeQueryArgs {
    readonly options?: { readonly env?: NodeJS.ProcessEnv };
}

/**
 * Spawn env for a Claude Code run of a caller who must not see operator credentials: keeps the key that caller
 * pushed (`request.apiKey`) and drops the operator's `ANTHROPIC_API_KEY` fallback and every other shared secret.
 */
export function withholdOperatorEnvFromClaudeCode(
    spawnEnv: NodeJS.ProcessEnv | undefined,
    login: string | undefined,
    operatorEnv: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
    const env = { ...(spawnEnv ?? operatorEnv) };
    const pushedKey = env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY !== operatorEnv.ANTHROPIC_API_KEY ? env.ANTHROPIC_API_KEY : undefined;
    stripSharedProviderEnv(env, login);
    if (pushedKey) {
        env.ANTHROPIC_API_KEY = pushedKey;
    } else {
        delete env.ANTHROPIC_API_KEY;
    }
    return env;
}

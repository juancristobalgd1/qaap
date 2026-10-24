// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { ILogger, PreferenceService } from '@theia/core';
import { AICorePreferences, PREFERENCE_NAME_MAX_RETRIES } from '@theia/ai-core/lib/common/ai-core-preferences';
import { OpenAiLanguageModelsManager, OpenAiModelDescription } from '@theia/ai-openai/lib/common';
import { API_KEY_PREF, BASE_URL_PREF, MODELS_PREF, OPENROUTER_DEFAULT_BASE_URL } from '../common/openrouter-preferences';
import { filterOpenRouterModelSlugs, normalizeOpenRouterModelSlug, OPENROUTER_PROVIDER_ID } from '../common/openrouter-models';

/**
 * Registers OpenRouter models as language models. OpenRouter exposes a unified OpenAI-compatible
 * gateway in front of dozens of providers, so the models are routed through the
 * {@link OpenAiLanguageModelsManager} with the OpenRouter endpoint and API key supplied per
 * model. This keeps OpenRouter a first-class provider without duplicating the OpenAI request
 * engine.
 */
@injectable()
export class OpenRouterFrontendApplicationContribution implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected preferenceService: PreferenceService;

    @inject(OpenAiLanguageModelsManager)
    protected manager: OpenAiLanguageModelsManager;

    @inject(ILogger) @named('openrouter')
    protected readonly logger: ILogger;

    @inject(AICorePreferences)
    protected aiCorePreferences: AICorePreferences;

    protected prevModels: string[] = [];

    /**
     * Tail of the queue of calls to the backend manager. The backend `createOrUpdateLanguageModels`
     * looks a model up, awaits, and then adds it, so two overlapping calls (startup, a preference
     * change, an API key change) both see the model as missing and the second one logs
     * "already existing language model" for every model. Chaining the calls makes each one see the
     * models the previous call registered, so it patches them instead.
     */
    protected backendQueue: Promise<void> = Promise.resolve();

    onStart(): void {
        this.preferenceService.ready.then(() => {
            const models = this.normalizeModelIds(this.preferenceService.get<string[]>(MODELS_PREF, []));
            this.createOrUpdateModels(models.map(modelId => this.createOpenRouterModelDescription(modelId)));
            this.prevModels = [...models];

            this.preferenceService.onPreferenceChanged(event => {
                if (event.preferenceName === MODELS_PREF) {
                    this.handleModelChanges(this.normalizeModelIds(this.preferenceService.get<string[]>(MODELS_PREF, [])));
                } else if (event.preferenceName === API_KEY_PREF || event.preferenceName === BASE_URL_PREF) {
                    this.updateAllModels();
                }
            });

            this.aiCorePreferences.onPreferenceChanged(event => {
                if (event.preferenceName === PREFERENCE_NAME_MAX_RETRIES) {
                    this.updateAllModels();
                }
            });
        });
    }

    protected handleModelChanges(newModels: string[]): void {
        const oldModels = new Set(this.prevModels);
        const updatedModels = new Set(newModels);

        const modelsToRemove = [...oldModels].filter(model => !updatedModels.has(model));
        const modelsToAdd = [...updatedModels].filter(model => !oldModels.has(model));

        if (modelsToRemove.length > 0) {
            this.enqueueBackendCall(() => this.manager.removeLanguageModels(...modelsToRemove.map(model => `${OPENROUTER_PROVIDER_ID}/${model}`)));
        }
        this.createOrUpdateModels(modelsToAdd.map(modelId => this.createOpenRouterModelDescription(modelId)));
        this.prevModels = newModels;
    }

    protected updateAllModels(): void {
        const models = this.normalizeModelIds(this.preferenceService.get<string[]>(MODELS_PREF, []));
        this.createOrUpdateModels(models.map(modelId => this.createOpenRouterModelDescription(modelId)));
    }

    protected createOrUpdateModels(descriptions: OpenAiModelDescription[]): void {
        if (descriptions.length === 0) {
            return;
        }
        this.enqueueBackendCall(() => this.manager.createOrUpdateLanguageModels(...descriptions));
    }

    /** Runs `call` after every previously queued backend call; a failed call is logged and does not block the queue. */
    protected enqueueBackendCall(call: () => Promise<void> | void): void {
        this.backendQueue = this.backendQueue
            .then(call)
            .catch(error => {
                this.logger.error('Failed to update OpenRouter language models', error);
            });
    }

    /**
     * Strip the `openrouter/` prefix from preference entries that already include it. Users frequently
     * copy ids straight from the model dropdown, which renders the full namespaced id (e.g.
     * `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`). Without this normalization we'd send the
     * prefixed slug to the OpenRouter API and get `400 ... is not a valid model ID`.
     */
    protected normalizeModelIds(ids: string[]): string[] {
        // `openrouter/x:free` and `x:free` normalize to the same model; register it once.
        return [...new Set(filterOpenRouterModelSlugs(ids.map(id => normalizeOpenRouterModelSlug(id))))];
    }

    protected createOpenRouterModelDescription(modelId: string): OpenAiModelDescription {
        const apiKey = this.preferenceService.get<string>(API_KEY_PREF, undefined);
        const baseUrl = this.preferenceService.get<string>(BASE_URL_PREF, OPENROUTER_DEFAULT_BASE_URL) || OPENROUTER_DEFAULT_BASE_URL;
        const maxRetries = this.aiCorePreferences.get(PREFERENCE_NAME_MAX_RETRIES) ?? 3;
        return {
            id: `${OPENROUTER_PROVIDER_ID}/${modelId}`,
            model: modelId,
            url: baseUrl,
            apiKey: apiKey && apiKey.trim() ? apiKey.trim() : undefined,
            apiVersion: undefined,
            // OpenRouter normalizes the system role for routes that prefer 'system'; using 'system'
            // works across the widest range of upstream providers.
            developerMessageSettings: 'system',
            enableStreaming: true,
            // Structured output (`response_format: json_schema`) coverage varies across the upstream
            // models OpenRouter fronts. Leaving this off avoids errors on routes that don't support it;
            // function calling itself is unaffected and works on most modern models.
            supportsStructuredOutput: false,
            maxRetries: maxRetries,
            useResponseApi: false
        };
    }
}

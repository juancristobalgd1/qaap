// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { OpenAiModelDescription } from '@theia/ai-openai/lib/common';
import { OpenAiLanguageModelsManagerImpl } from '@theia/ai-openai/lib/node/openai-language-models-manager-impl';
import { isQaapSecretPlaceholder } from '@theia/qaap-shared-core/lib/common/qaap-secret-placeholder';
import { QaapSecretPlaceholderResolver } from './qaap-secret-placeholder-resolver';

/**
 * Upstream OpenAI-compatible manager with placeholder resolution. Bound over the upstream impl in
 * the connection scope (see qaap-cloud-workspace-backend-module.ts), so the browser can send
 * `qaap-sealed-secret:<id>` instead of the key.
 */
@injectable()
export class QaapOpenAiLanguageModelsManagerImpl extends OpenAiLanguageModelsManagerImpl {

    @inject(QaapSecretPlaceholderResolver)
    protected readonly secretResolver: QaapSecretPlaceholderResolver;

    override setApiKey(key: string | undefined): void {
        super.setApiKey(this.secretResolver.resolve(key));
    }

    override async createOrUpdateLanguageModels(...modelDescriptions: OpenAiModelDescription[]): Promise<void> {
        await super.createOrUpdateLanguageModels(...modelDescriptions.map(description => this.resolveModelDescription(description)));
    }

    /** Model descriptions carry the key per model (OpenRouter, NVIDIA); `true` keeps the upstream "server key" meaning. */
    protected resolveModelDescription(description: OpenAiModelDescription): OpenAiModelDescription {
        if (typeof description.apiKey !== 'string' || !isQaapSecretPlaceholder(description.apiKey)) {
            return description;
        }
        return { ...description, apiKey: this.secretResolver.resolve(description.apiKey) };
    }
}

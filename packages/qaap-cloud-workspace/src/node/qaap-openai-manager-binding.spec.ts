// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Container, ContainerModule } from '@theia/core/shared/inversify';
import { LanguageModelRegistry } from '@theia/ai-core';
import { OpenAiModelUtils } from '@theia/ai-openai/lib/node/openai-language-model';
import { OpenAiResponseApiUtils } from '@theia/ai-openai/lib/node/openai-response-api-utils';
import { OpenAiLanguageModelsManagerImpl } from '@theia/ai-openai/lib/node/openai-language-models-manager-impl';
import { QaapOpenAiLanguageModelsManagerImpl } from './qaap-openai-language-models-manager';
import { QaapSecretPlaceholderResolver } from './qaap-secret-placeholder-resolver';
import { bindQaapSecretPlaceholderResolver, qaapOpenAiConnectionModule } from './qaap-openai-manager-binding';

describe('qaap OpenAI manager binding (same code as the backend module)', () => {

    /** Upstream ai-openai binds the impl in a connection scope; its heavy collaborators are stubbed. */
    const upstreamLikeModule = new ContainerModule(bind => {
        bind(LanguageModelRegistry).toConstantValue({} as LanguageModelRegistry);
        bind(OpenAiModelUtils).toConstantValue({} as OpenAiModelUtils);
        bind(OpenAiResponseApiUtils).toConstantValue({} as OpenAiResponseApiUtils);
        bind(OpenAiLanguageModelsManagerImpl).toSelf().inSingletonScope();
    });

    it('resolves the rebound manager synchronously with the placeholder resolver injected', () => {
        const container = new Container({ defaultScope: 'Singleton' });
        container.load(upstreamLikeModule);
        bindQaapSecretPlaceholderResolver(container.bind.bind(container));
        container.load(qaapOpenAiConnectionModule);

        const manager = container.get(OpenAiLanguageModelsManagerImpl);
        expect(manager).to.be.instanceOf(QaapOpenAiLanguageModelsManagerImpl);
        expect((manager as unknown as { secretResolver: unknown }).secretResolver).to.be.instanceOf(QaapSecretPlaceholderResolver);
    });
});

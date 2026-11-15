// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { interfaces } from '@theia/core/shared/inversify';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { OpenAiLanguageModelsManagerImpl } from '@theia/ai-openai/lib/node/openai-language-models-manager-impl';
import { QaapOpenAiLanguageModelsManagerImpl } from './qaap-openai-language-models-manager';
import { QaapSecretPlaceholderResolver } from './qaap-secret-placeholder-resolver';

/**
 * Root-level binding for the placeholder resolver. Connection containers are children of the root
 * container, so a root binding is resolvable from them.
 */
export function bindQaapSecretPlaceholderResolver(bind: interfaces.Bind): void {
    bind(QaapSecretPlaceholderResolver).toSelf().inSingletonScope();
}

/**
 * Connection-scoped rebind of the upstream OpenAI manager (ai-openai binds it per connection), so
 * `container.get(OpenAiLanguageModelsManagerImpl)` yields the placeholder-resolving subclass.
 */
export const qaapOpenAiConnectionModule = ConnectionContainerModule.create(({ rebind }) => {
    rebind(OpenAiLanguageModelsManagerImpl).to(QaapOpenAiLanguageModelsManagerImpl).inSingletonScope();
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ContainerModule } from '@theia/core/shared/inversify';
import { PreferenceContribution } from '@theia/core';
import { OpenRouterPreferencesSchema } from '../common/openrouter-preferences';

/** Registers the schema on the backend so per-user AI settings readers fall back to its defaults. */
export default new ContainerModule(bind => {
    bind(PreferenceContribution).toConstantValue({ schema: OpenRouterPreferencesSchema });
});

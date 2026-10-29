// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import type { PreferenceSchema } from '@theia/core/lib/common/preferences/preference-schema';
import { QaapPiProviders } from './qaap-pi-provider-registry';

/** Settings schema of the API-key preferences that only Pi uses (one masked string per provider). */
export const QaapPiProviderPreferencesSchema: PreferenceSchema = {
    properties: Object.fromEntries(QaapPiProviders.ownDescriptors().map(descriptor => [descriptor.pref, {
        type: 'string',
        default: '',
        markdownDescription: nls.localize('theia/qaap/piProviders/apiKey/mdDescription',
            'API key for {0} in Pi. Pi lists this provider\'s models once the key is set.', descriptor.label),
    }])),
};

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { injectable } from '@theia/core/shared/inversify';
import {
    QAAP_DEFAULT_DISABLED_HARNESS_IDS,
    QAAP_DISABLED_HARNESSES_PREF,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-preferences';

export const qaapHarnessPreferenceSchema: PreferenceSchema = {
    properties: {
        [QAAP_DISABLED_HARNESSES_PREF]: {
            type: 'array',
            items: { type: 'string' },
            default: [...QAAP_DEFAULT_DISABLED_HARNESS_IDS],
            description: nls.localize(
                'qaap/preferences/disabledHarnesses',
                'Harness ids that are disabled in the Work Hub composer.',
            ),
        },
    },
};

@injectable()
export class QaapHarnessPreferenceContribution implements PreferenceContribution {
    readonly schema = qaapHarnessPreferenceSchema;
}

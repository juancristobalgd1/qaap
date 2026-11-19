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
import {
    QAAP_HARNESS_INSTANCES_PREF,
    QAAP_HARNESS_SETTINGS_PREF,
} from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';

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
        [QAAP_HARNESS_SETTINGS_PREF]: {
            type: 'object',
            default: {},
            additionalProperties: {
                type: 'object',
                properties: {
                    label: { type: 'string' },
                    binaryPath: { type: 'string' },
                    homeDir: { type: 'string' },
                },
            },
            markdownDescription: nls.localize(
                'qaap/preferences/harnessSettings',
                'Per-harness settings from Settings → Harness: display name and, in the desktop app only, the binary path and configuration folder.',
            ),
        },
        [QAAP_HARNESS_INSTANCES_PREF]: {
            type: 'array',
            default: [],
            items: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    baseId: { type: 'string' },
                },
            },
            description: nls.localize(
                'qaap/preferences/harnessInstances',
                'Extra harness copies added with "Add harness" in Settings → Harness.',
            ),
        },
    },
};

@injectable()
export class QaapHarnessPreferenceContribution implements PreferenceContribution {
    readonly schema = qaapHarnessPreferenceSchema;
}

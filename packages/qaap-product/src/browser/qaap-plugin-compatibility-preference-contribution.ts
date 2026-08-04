// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';

/** Stub schemas for VS Code extension prefs referenced in linked docs or configurationDefaults. */
export const qaapPluginCompatibilityPreferenceSchema: PreferenceSchema = {
    properties: {
        'problems.visibility': {
            type: 'boolean',
            default: true,
        },
        'workbench.colorCustomizations': {
            type: 'object',
            default: {},
        },
        'editor.experimental.preferTreeSitter': {
            type: 'boolean',
            default: false,
        },
    },
};

@injectable()
export class QaapPluginCompatibilityPreferenceContribution implements PreferenceContribution {
    readonly schema = qaapPluginCompatibilityPreferenceSchema;
}

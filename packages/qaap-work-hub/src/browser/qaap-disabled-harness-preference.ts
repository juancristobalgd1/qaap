// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { PreferenceService } from '@theia/core/lib/common/preferences';
import { QAAP_DISABLED_HARNESSES_PREF } from '@theia/qaap-shared-core/lib/common/qaap-harness-preferences';
import { QAAP_HARNESS_INSTANCES_PREF, QAAP_HARNESS_SETTINGS_PREF } from '@theia/qaap-shared-core/lib/common/qaap-harness-launch-settings';

/** Settings → Harness preferences that change what the composer picker lists (switches, added harnesses, names). */
const HARNESS_PICKER_PREFERENCES = new Set([QAAP_DISABLED_HARNESSES_PREF, QAAP_HARNESS_INSTANCES_PREF, QAAP_HARNESS_SETTINGS_PREF]);

/**
 * Runs `onChange` whenever Settings → Harness changes which harnesses are disabled, adds or removes a
 * harness instance, or renames a harness. Other preference changes are ignored. The caller disposes the returned subscription.
 * @param preferences the preference service that reports changes.
 * @param onChange called once per change of the disabled-harness preference.
 * @returns the subscription.
 */
export function subscribeToDisabledHarnessesPreference(
    preferences: Pick<PreferenceService, 'onPreferenceChanged'>,
    onChange: () => void,
): { dispose(): void } {
    return preferences.onPreferenceChanged(event => {
        if (HARNESS_PICKER_PREFERENCES.has(event.preferenceName)) {
            onChange();
        }
    });
}

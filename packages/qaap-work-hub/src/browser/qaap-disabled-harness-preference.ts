// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { PreferenceService } from '@theia/core/lib/common/preferences';
import { QAAP_DISABLED_HARNESSES_PREF } from '@theia/qaap-shared-core/lib/common/qaap-harness-preferences';

/**
 * Runs `onChange` whenever Settings → Harness changes which harnesses are disabled. Only that preference
 * counts: other preference changes are ignored. The caller disposes the returned subscription.
 * @param preferences the preference service that reports changes.
 * @param onChange called once per change of the disabled-harness preference.
 * @returns the subscription.
 */
export function subscribeToDisabledHarnessesPreference(
    preferences: Pick<PreferenceService, 'onPreferenceChanged'>,
    onChange: () => void,
): { dispose(): void } {
    return preferences.onPreferenceChanged(event => {
        if (event.preferenceName === QAAP_DISABLED_HARNESSES_PREF) {
            onChange();
        }
    });
}

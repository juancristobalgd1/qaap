// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import type { PreferenceChangeEvent, PreferenceService } from '@theia/core/lib/common/preferences';
import { QAAP_DISABLED_HARNESSES_PREF } from '@theia/qaap-shared-core/lib/common/qaap-harness-preferences';
import { subscribeToDisabledHarnessesPreference } from './qaap-disabled-harness-preference';

describe('subscribeToDisabledHarnessesPreference', () => {

    it('runs the listener only when the disabled-harness preference changes', () => {
        const emitter = new Emitter<PreferenceChangeEvent<unknown>>();
        const preferences = { onPreferenceChanged: emitter.event } as unknown as Pick<PreferenceService, 'onPreferenceChanged'>;
        let calls = 0;
        const subscription = subscribeToDisabledHarnessesPreference(preferences, () => { calls++; });
        emitter.fire({ preferenceName: 'editor.fontSize' } as unknown as PreferenceChangeEvent<unknown>);
        expect(calls).to.equal(0);
        emitter.fire({ preferenceName: QAAP_DISABLED_HARNESSES_PREF } as unknown as PreferenceChangeEvent<unknown>);
        expect(calls).to.equal(1);
        subscription.dispose();
        emitter.fire({ preferenceName: QAAP_DISABLED_HARNESSES_PREF } as unknown as PreferenceChangeEvent<unknown>);
        expect(calls).to.equal(1);
    });
});

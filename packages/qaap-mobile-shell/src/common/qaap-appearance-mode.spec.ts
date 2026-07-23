// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QAAP_APPEARANCE_MODE_KEY,
    readQaapAppearanceMode,
    readQaapAppearanceModeOrDefault,
    resolveQaapAppearanceThemeId,
    writeQaapAppearanceMode,
} from './qaap-appearance-mode';

describe('qaap-appearance-mode', () => {

    function createStorage(): Pick<Storage, 'getItem' | 'setItem'> & { map: Map<string, string> } {
        const map = new Map<string, string>();
        return {
            map,
            getItem: (key: string) => map.get(key) ?? null,
            setItem: (key: string, value: string) => { map.set(key, value); },
        };
    }

    it('returns undefined when storage is empty or invalid', () => {
        const storage = createStorage();
        expect(readQaapAppearanceMode(storage)).to.equal(undefined);
        storage.map.set(QAAP_APPEARANCE_MODE_KEY, 'nope');
        expect(readQaapAppearanceMode(storage)).to.equal(undefined);
        expect(readQaapAppearanceModeOrDefault(storage)).to.equal('system');
    });

    it('round-trips light / dark / system', () => {
        const storage = createStorage();
        writeQaapAppearanceMode('dark', storage);
        expect(readQaapAppearanceMode(storage)).to.equal('dark');
        writeQaapAppearanceMode('light', storage);
        expect(readQaapAppearanceMode(storage)).to.equal('light');
        writeQaapAppearanceMode('system', storage);
        expect(readQaapAppearanceMode(storage)).to.equal('system');
    });

    it('resolves theme ids from mode and OS preference', () => {
        expect(resolveQaapAppearanceThemeId('light', true)).to.equal('light');
        expect(resolveQaapAppearanceThemeId('dark', false)).to.equal('dark');
        expect(resolveQaapAppearanceThemeId('system', true)).to.equal('dark');
        expect(resolveQaapAppearanceThemeId('system', false)).to.equal('light');
    });
});

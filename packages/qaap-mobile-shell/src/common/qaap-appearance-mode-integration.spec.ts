import { expect } from 'chai';
import {
    QAAP_APPEARANCE_MODE_KEY,
    QAAP_APPEARANCE_PREFERRED_DARK_THEME_KEY,
    QAAP_APPEARANCE_PREFERRED_LIGHT_THEME_KEY,
    readQaapAppearanceMode,
    readQaapAppearanceModeOrDefault,
    readQaapAppearanceThemePair,
    resolveQaapAppearanceThemeId,
    writeQaapAppearanceMode,
    writeQaapAppearancePreferredTheme,
} from './qaap-appearance-mode';

describe('qaap-appearance-mode (integration)', () => {

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

    it('resolves theme ids from the remembered pair, not hard-coded Qaap ids', () => {
        const pair = {
            lightThemeId: 'github-light',
            darkThemeId: 'github-dark',
        };
        expect(resolveQaapAppearanceThemeId('light', pair, true)).to.equal('github-light');
        expect(resolveQaapAppearanceThemeId('dark', pair, false)).to.equal('github-dark');
        expect(resolveQaapAppearanceThemeId('system', pair, true)).to.equal('github-dark');
        expect(resolveQaapAppearanceThemeId('system', pair, false)).to.equal('github-light');
    });

    it('persists preferred light/dark theme ids for the pair', () => {
        const storage = createStorage();
        writeQaapAppearancePreferredTheme('light', 'solarized-light', storage);
        writeQaapAppearancePreferredTheme('dark', 'solarized-dark', storage);
        expect(storage.map.get(QAAP_APPEARANCE_PREFERRED_LIGHT_THEME_KEY)).to.equal('solarized-light');
        expect(storage.map.get(QAAP_APPEARANCE_PREFERRED_DARK_THEME_KEY)).to.equal('solarized-dark');
        expect(readQaapAppearanceThemePair(storage)).to.deep.equal({
            lightThemeId: 'solarized-light',
            darkThemeId: 'solarized-dark',
        });
    });
});
// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Emitter } from '@theia/core/lib/common/event';
import type { Theme } from '@theia/core/lib/common/theme';
import type { ThemeService } from '@theia/core/lib/browser/theming';
import type { PreferenceService } from '@theia/core/lib/common/preferences';
import { QaapAppearanceModeService } from './qaap-appearance-mode-service';
import { QAAP_APPEARANCE_MODE_KEY } from '../common/qaap-appearance-mode';

disableImportJSDOM();

const LIGHT: Theme = { id: 'light', type: 'light', label: 'Light (Qaap)' };
const DARK: Theme = { id: 'dark', type: 'dark', label: 'Dark (Qaap)' };

/** A theme service that records which theme was shown and whether it was written to the shared setting. */
class FakeThemeService {
    readonly calls: Array<{ id: string; persist: boolean }> = [];
    readonly change = new Emitter<{ newTheme: Theme }>();
    readonly onDidColorThemeChange = this.change.event;
    readonly initialized = Promise.resolve();
    current: Theme = DARK;
    getThemes(): Theme[] {
        return [LIGHT, DARK];
    }
    getCurrentTheme(): Theme {
        return this.current;
    }
    setCurrentTheme(id: string, persist = true): void {
        this.calls.push({ id, persist });
        const next = id === 'light' ? LIGHT : DARK;
        if (next !== this.current) {
            this.current = next;
            this.change.fire({ newTheme: next });
        }
    }
}

class FakePreferences {
    readonly changed = new Emitter<{ preferenceName: string }>();
    readonly onPreferenceChanged = this.changed.event;
    readonly ready = Promise.resolve();
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('QaapAppearanceModeService', () => {
    let disableJSDOM: () => void;
    let theme: FakeThemeService;
    let preferences: FakePreferences;
    let service: QaapAppearanceModeService;

    beforeEach(async () => {
        disableJSDOM = enableJSDOM();
        window.localStorage.clear();
        theme = new FakeThemeService();
        preferences = new FakePreferences();
        service = new QaapAppearanceModeService();
        Object.assign(service, { themeService: theme as unknown as ThemeService, preferences: preferences as unknown as PreferenceService });
    });

    afterEach(() => {
        service.onStop();
        disableJSDOM();
    });

    it('applies an explicit Light pick and writes it to the shared setting', async () => {
        service.onStart();
        await flush();
        service.setMode('light');
        expect(theme.current).to.equal(LIGHT);
        expect(theme.calls.at(-1)).to.deep.equal({ id: 'light', persist: true });
        expect(service.getMode()).to.equal('light');
    });

    it('keeps this device on Light when another device writes Dark to the shared setting', async () => {
        service.onStart();
        await flush();
        service.setMode('light');
        await flush();
        theme.calls.length = 0;

        // Another window of the same user saves Dark: the setting changes, then the theme service follows it.
        preferences.changed.fire({ preferenceName: 'workbench.colorTheme' });
        theme.setCurrentTheme('dark', false);
        await flush();

        expect(theme.current, 'shows its own side again').to.equal(LIGHT);
        expect(theme.calls.at(-1)).to.deep.equal({ id: 'light', persist: false });
        expect(service.getMode()).to.equal('light');
        expect(window.localStorage.getItem(QAAP_APPEARANCE_MODE_KEY)).to.equal('light');
    });

    it('never writes the shared setting in System mode', async () => {
        window.localStorage.setItem(QAAP_APPEARANCE_MODE_KEY, 'system');
        service.onStart();
        await flush();
        preferences.changed.fire({ preferenceName: 'workbench.colorTheme' });
        theme.setCurrentTheme('light', false);
        await flush();
        expect(theme.calls.filter(call => call.persist)).to.deep.equal([]);
        expect(service.getMode()).to.equal('system');
    });

    it('follows a color theme the user picks on this device', async () => {
        window.localStorage.setItem(QAAP_APPEARANCE_MODE_KEY, 'dark');
        service.onStart();
        // A pick comes well after the setting's boot load (which is not a pick).
        await new Promise(resolve => setTimeout(resolve, 300));
        theme.setCurrentTheme('light', true);
        await flush();
        expect(service.getMode()).to.equal('light');
    });
});

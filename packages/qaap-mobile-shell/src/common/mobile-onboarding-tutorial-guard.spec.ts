// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    isMobileOnboardingSessionSkipped,
    markMobileOnboardingSessionSkipped,
    shouldDeferMobileOnboardingTutorial,
} from './mobile-onboarding-tutorial-guard';

describe('mobile-onboarding-tutorial-guard', () => {

    let storage: Map<string, string>;
    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        storage = new Map();
        const sessionStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => { storage.set(key, value); },
            removeItem: (key: string) => { storage.delete(key); },
            clear: () => { storage.clear(); },
            key: (index: number) => Array.from(storage.keys())[index] ?? null,
            get length() { return storage.size; },
        };
        (global as unknown as { sessionStorage: Storage }).sessionStorage = sessionStorage as Storage;
        Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorage, configurable: true });
    });

    afterEach(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('markMobileOnboardingSessionSkipped persists for the current tab session', () => {
        expect(isMobileOnboardingSessionSkipped()).to.equal(false);
        markMobileOnboardingSessionSkipped();
        expect(isMobileOnboardingSessionSkipped()).to.equal(true);
    });

    it('shouldDeferMobileOnboardingTutorial is false without an active transcript surface', () => {
        const root = document.createElement('div');
        expect(shouldDeferMobileOnboardingTutorial(root)).to.equal(false);
    });

    it('shouldDeferMobileOnboardingTutorial is true when inline transcript shows a turn failure', () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <div class="theia-mobile-projects theia-mod-agents-hub-inline-active theia-mod-visible">
                <div class="theia-mod-turn-failure"></div>
            </div>
        `;
        expect(shouldDeferMobileOnboardingTutorial(root)).to.equal(true);
    });

    it('shouldDeferMobileOnboardingTutorial is true while transcript tail is streaming', () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <div class="theia-mobile-agent-transcript-root theia-mod-visible">
                <div class="theia-mobile-agent-transcript-msg theia-mod-streaming"></div>
            </div>
        `;
        expect(shouldDeferMobileOnboardingTutorial(root)).to.equal(true);
    });
});

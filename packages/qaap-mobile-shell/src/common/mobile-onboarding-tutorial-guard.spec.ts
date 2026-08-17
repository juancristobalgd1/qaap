// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    hasAnyAgentConversationWork,
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

    it('session skip is tracked per surface: skipping Work Hub does not skip the IDE tour', () => {
        markMobileOnboardingSessionSkipped('work-hub');
        expect(isMobileOnboardingSessionSkipped('work-hub')).to.equal(true);
        expect(isMobileOnboardingSessionSkipped('ide')).to.equal(false);
        markMobileOnboardingSessionSkipped('ide');
        expect(isMobileOnboardingSessionSkipped('ide')).to.equal(true);
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
            <div class="theia-mobile-projects theia-mod-agents-hub-inline-active theia-mod-visible">
                <div class="theia-mobile-agent-transcript-msg theia-mod-streaming"></div>
            </div>
        `;
        expect(shouldDeferMobileOnboardingTutorial(root)).to.equal(true);
    });

    it('shouldDeferMobileOnboardingTutorial ignores persistent failed session markers on the hub', () => {
        // Old failed sessions live in the hub indefinitely; they must not defer the tour forever.
        const root = document.createElement('div');
        root.innerHTML = `
            <div class="theia-mobile-projects theia-mod-visible">
                <div class="theia-mobile-projects-active-chat-chip theia-mod-failed"></div>
                <div class="theia-mobile-projects-row-glyph theia-mod-failed"></div>
            </div>
        `;
        expect(shouldDeferMobileOnboardingTutorial(root)).to.equal(false);
    });

    it('shouldDeferMobileOnboardingTutorial is true when a transcript surface is open', () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <div class="theia-mobile-agent-transcript-root theia-mod-visible">
                <div class="theia-mobile-agent-transcript-msg theia-mod-agent"></div>
            </div>
        `;
        expect(shouldDeferMobileOnboardingTutorial(root)).to.equal(true);
    });

    it('shouldDeferMobileOnboardingTutorial still defers while a session row is running', () => {
        const root = document.createElement('div');
        root.innerHTML = `
            <div class="theia-mobile-projects theia-mod-agents-hub-inline-active theia-mod-visible">
                <div class="theia-mobile-projects-row-glyph theia-mod-running"></div>
            </div>
        `;
        expect(shouldDeferMobileOnboardingTutorial(root)).to.equal(true);
    });

    describe('hasAnyAgentConversationWork', () => {
        let originalFetch: typeof globalThis.fetch | undefined;

        const stubFetch = (payload: unknown, ok = true): void => {
            (globalThis as unknown as { fetch: unknown }).fetch = async () => ({
                ok,
                json: async () => payload,
            });
        };

        beforeEach(() => {
            originalFetch = globalThis.fetch;
        });

        afterEach(() => {
            (globalThis as unknown as { fetch: typeof globalThis.fetch | undefined }).fetch = originalFetch;
        });

        it('is true when a group has any conversation (any status)', async () => {
            stubFetch({ groups: [{ conversations: [{ status: 'idle' }] }] });
            expect(await hasAnyAgentConversationWork()).to.equal(true);
        });

        it('is true when a group reports streaming work without listed conversations', async () => {
            stubFetch({ groups: [{ streamingCount: 1 }] });
            expect(await hasAnyAgentConversationWork()).to.equal(true);
        });

        it('is false for an empty history', async () => {
            stubFetch({ groups: [{ conversations: [] }] });
            expect(await hasAnyAgentConversationWork()).to.equal(false);
        });

        it('is false when the request fails', async () => {
            stubFetch({}, false);
            expect(await hasAnyAgentConversationWork()).to.equal(false);
        });
    });
});

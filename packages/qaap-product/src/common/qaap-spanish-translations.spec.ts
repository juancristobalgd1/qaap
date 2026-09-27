// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_SPANISH_REQUIRED_KEYS, QAAP_SPANISH_TRANSLATIONS } from './qaap-spanish-translations';

describe('Qaap Spanish translations', () => {

    it('covers the verification, recovery, history, review and update-notice keys', () => {
        for (const key of QAAP_SPANISH_REQUIRED_KEYS) {
            const value = QAAP_SPANISH_TRANSLATIONS[key];
            expect(value, key).to.be.a('string').and.not.equal('');
        }
    });

    it('keeps placeholders aligned with the localization keys', () => {
        for (const [key, value] of Object.entries(QAAP_SPANISH_TRANSLATIONS)) {
            const placeholders = key.match(/\{\d+\}/g) ?? [];
            for (const placeholder of placeholders) {
                expect(value, `${key} missing ${placeholder}`).to.include(placeholder);
            }
        }
    });

    it('does not leave English source copy on the required surfaces', () => {
        const englishMarkers = [
            'Checks passed',
            'Session history unavailable',
            'Files changed — run checks again',
            'The agent stopped before it could finish',
            'Working changes',
            'Could not update',
        ];
        for (const marker of englishMarkers) {
            expect(Object.values(QAAP_SPANISH_TRANSLATIONS)).to.not.include(marker);
        }
    });
});

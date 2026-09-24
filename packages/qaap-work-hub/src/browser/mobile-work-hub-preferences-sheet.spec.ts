// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import {
    isWorkHubAiFeaturesPreferencesQuery,
    WORK_HUB_AI_FEATURES_PREFERENCES_QUERY,
} from './mobile-work-hub-preferences-sheet';

disableImportJSDOM();

describe('isWorkHubAiFeaturesPreferencesQuery', () => {
    it('matches the AI Features search scope', () => {
        expect(isWorkHubAiFeaturesPreferencesQuery(WORK_HUB_AI_FEATURES_PREFERENCES_QUERY)).to.equal(true);
        expect(isWorkHubAiFeaturesPreferencesQuery(' AI-Features ')).to.equal(true);
    });

    it('rejects empty or unrelated queries', () => {
        expect(isWorkHubAiFeaturesPreferencesQuery(undefined)).to.equal(false);
        expect(isWorkHubAiFeaturesPreferencesQuery('')).to.equal(false);
        expect(isWorkHubAiFeaturesPreferencesQuery('editor')).to.equal(false);
    });
});

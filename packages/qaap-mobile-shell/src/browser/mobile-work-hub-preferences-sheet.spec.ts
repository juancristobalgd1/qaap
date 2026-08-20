// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isWorkHubAiFeaturesPreferencesQuery,
    WORK_HUB_AI_FEATURES_PREFERENCES_QUERY,
} from './mobile-work-hub-preferences-sheet';

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

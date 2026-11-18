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
    resolveWorkHubProfileIdentity,
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

describe('resolveWorkHubProfileIdentity', () => {
    it('shows the GitHub CLI credential instead of "Not signed in" and keeps the activity graph', () => {
        const identity = resolveWorkHubProfileIdentity(undefined, { source: 'gh-cli', user: { provider: 'github', login: 'octo', name: 'Octo Cat' } });
        expect(identity.name).to.equal('Octo Cat');
        expect(identity.detail).to.equal('Connected through the GitHub CLI as octo');
        expect(identity.showActivity).to.equal(true);
    });

    it('shows "Not signed in" and no activity graph when there is no identity at all', () => {
        const identity = resolveWorkHubProfileIdentity(undefined, undefined);
        expect(identity.name).to.equal('Not signed in');
        expect(identity.showActivity).to.equal(false);
    });
});

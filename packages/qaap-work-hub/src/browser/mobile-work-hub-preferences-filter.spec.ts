// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { hasPreferencesContent, isPreferencesFilterApplied } from './mobile-work-hub-preferences-filter';

disableImportJSDOM();

/** Builds a minimal preferences editor: one `<li class="single-pref">` per preference id. */
function renderPreferences(ids: string[], hiddenIds: string[] = []): HTMLElement {
    const root = document.createElement('div');
    for (const id of ids) {
        const item = document.createElement('li');
        item.classList.add('single-pref');
        item.setAttribute('data-pref-id', id);
        if (hiddenIds.includes(id)) {
            item.classList.add('hidden');
        }
        const name = document.createElement('div');
        name.classList.add('pref-name');
        name.textContent = id;
        item.appendChild(name);
        root.appendChild(item);
    }
    return root;
}

describe('mobile-work-hub-preferences-filter', () => {

    describe('hasPreferencesContent', () => {
        it('is true when any preference or category is rendered', () => {
            expect(hasPreferencesContent(renderPreferences(['editor.fontSize']))).to.equal(true);
        });

        it('is false for an empty editor', () => {
            expect(hasPreferencesContent(document.createElement('div'))).to.equal(false);
        });
    });

    describe('isPreferencesFilterApplied', () => {
        it('is false while the first visible preference is unfiltered content', () => {
            const root = renderPreferences(['editor.fontSize', 'files.autoSave', 'ai-features.openrouter.openrouterApiKey']);
            expect(isPreferencesFilterApplied(root, 'ai-features')).to.equal(false);
        });

        it('is true once the first visible preference matches the query', () => {
            const root = renderPreferences(['editor.fontSize', 'ai-features.openrouter.openrouterApiKey'], ['editor.fontSize']);
            expect(isPreferencesFilterApplied(root, 'ai-features')).to.equal(true);
        });

        it('is true when the editor reports no results', () => {
            const root = document.createElement('div');
            root.innerHTML = '<div class="settings-main no-results"></div>';
            expect(isPreferencesFilterApplied(root, 'ai-features')).to.equal(true);
        });

        it('is false when no preference is visible', () => {
            const root = renderPreferences(['ai-features.a'], ['ai-features.a']);
            expect(isPreferencesFilterApplied(root, 'ai-features')).to.equal(false);
        });

        it('only requires a visible preference for an empty query', () => {
            expect(isPreferencesFilterApplied(renderPreferences(['editor.fontSize']), '')).to.equal(true);
            expect(isPreferencesFilterApplied(renderPreferences(['editor.fontSize'], ['editor.fontSize']), '')).to.equal(false);
        });
    });
});

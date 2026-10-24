// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Host class that hides the embedded preferences widget while its section query is applied. */
export const WORK_HUB_PREFERENCES_APPLYING_QUERY_CLASS = 'theia-mod-applying-query';

const PREFERENCE_ITEM_SELECTOR = '[data-pref-id]';
const HIDDEN_ANCESTOR_SELECTOR = '[hidden], .hidden';

/** Whether the embedded preferences editor shows any preference or category, i.e. unfiltered or filtered content exists. */
export function hasPreferencesContent(root: ParentNode): boolean {
    return root.querySelector('.single-pref, .settings-section-category-title') !== null;
}

/**
 * Whether the preferences filter for `query` has visibly taken effect: either the editor reports
 * no results, or the first visible preference matches the query (id or headline text).
 * An empty query only requires that some preference is visible.
 */
export function isPreferencesFilterApplied(root: ParentNode, query: string): boolean {
    if (root.querySelector('.settings-main.no-results') !== null) {
        return true;
    }
    const firstVisible = Array.from(root.querySelectorAll<HTMLElement>(PREFERENCE_ITEM_SELECTOR))
        .find(item => item.closest(HIDDEN_ANCESTOR_SELECTOR) === null);
    if (!firstVisible) {
        return false;
    }
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }
    const headline = firstVisible.querySelector('.pref-name')?.textContent ?? '';
    const preferenceId = firstVisible.getAttribute('data-pref-id') ?? '';
    return `${preferenceId} ${headline}`.toLowerCase().includes(normalizedQuery);
}

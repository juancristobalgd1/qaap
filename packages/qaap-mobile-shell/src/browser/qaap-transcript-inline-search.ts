// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { resolveScrollBehavior } from '../common/qaap-prefers-reduced-motion';
import { markTranscriptUserScrollIntent } from './qaap-transcript-scroll-intent';

const SEARCH_HOST_CLASS = 'theia-mobile-agent-transcript-search';
const SEARCH_MATCH_CLASS = 'theia-mod-search-match';
const SEARCH_CURRENT_CLASS = 'theia-mod-search-current';

function transcriptSearchRows(scroller: HTMLElement): HTMLElement[] {
    return [...scroller.querySelectorAll<HTMLElement>(
        '[data-transcript-message-id], .theia-mobile-agent-transcript-msg.theia-mod-agent, [data-transcript-activity-row]',
    )];
}

function rowSearchText(row: HTMLElement): string {
    return (row.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function attachTranscriptInlineSearch(mountHost: HTMLElement, scroller: HTMLElement): Disposable {
    mountHost.querySelector(`.${SEARCH_HOST_CLASS}`)?.remove();
    const previousTabIndex = scroller.getAttribute('tabindex');
    if (previousTabIndex === null) {
        scroller.tabIndex = 0;
    }

    const host = document.createElement('form');
    host.className = SEARCH_HOST_CLASS;
    host.hidden = true;
    host.setAttribute('role', 'search');

    const input = document.createElement('input');
    input.type = 'search';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = nls.localize('qaap/mobileProjects/transcriptSearchPlaceholder', 'Search conversation');
    input.setAttribute('aria-label', input.placeholder);

    const count = document.createElement('span');
    count.className = 'theia-mobile-agent-transcript-search-count';
    count.setAttribute('aria-live', 'polite');
    count.textContent = '0/0';

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'codicon codicon-chevron-up';
    prev.title = nls.localize('qaap/mobileProjects/transcriptSearchPrevious', 'Previous result');
    prev.setAttribute('aria-label', prev.title);

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'codicon codicon-chevron-down';
    next.title = nls.localize('qaap/mobileProjects/transcriptSearchNext', 'Next result');
    next.setAttribute('aria-label', next.title);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'codicon codicon-close';
    close.title = nls.localize('qaap/mobileProjects/transcriptSearchClose', 'Close search');
    close.setAttribute('aria-label', close.title);

    host.append(input, count, prev, next, close);
    mountHost.append(host);

    let matches: HTMLElement[] = [];
    let currentIndex = -1;
    let indexedRows: HTMLElement[] = [];
    let indexedTexts: string[] = [];
    let indexDirty = true;

    const markIndexDirty = (): void => {
        indexDirty = true;
    };

    const mutationObserver = new MutationObserver(markIndexDirty);
    mutationObserver.observe(scroller, {
        childList: true,
        subtree: true,
        characterData: true,
    });

    const ensureSearchIndex = (): void => {
        if (!indexDirty) {
            return;
        }
        indexedRows = transcriptSearchRows(scroller);
        indexedTexts = indexedRows.map(rowSearchText);
        indexDirty = false;
    };

    const clearMatches = (): void => {
        for (const row of matches) {
            row.classList.remove(SEARCH_MATCH_CLASS, SEARCH_CURRENT_CLASS);
        }
        matches = [];
        currentIndex = -1;
    };

    const updateCount = (): void => {
        count.textContent = matches.length > 0 && currentIndex >= 0
            ? `${currentIndex + 1}/${matches.length}`
            : `0/${matches.length}`;
        prev.disabled = matches.length < 2;
        next.disabled = matches.length < 2;
    };

    const setCurrent = (index: number, scroll: boolean): void => {
        if (matches.length === 0) {
            updateCount();
            return;
        }
        const nextIndex = ((index % matches.length) + matches.length) % matches.length;
        matches[currentIndex]?.classList.remove(SEARCH_CURRENT_CLASS);
        currentIndex = nextIndex;
        const row = matches[currentIndex];
        row.classList.add(SEARCH_CURRENT_CLASS);
        updateCount();
        if (scroll) {
            markTranscriptUserScrollIntent(scroller, 'search');
            row.scrollIntoView({ block: 'center', behavior: resolveScrollBehavior('smooth') });
        }
    };

    const runSearch = (scroll: boolean): void => {
        clearMatches();
        const query = input.value.trim().toLowerCase();
        if (!query) {
            updateCount();
            return;
        }
        ensureSearchIndex();
        matches = indexedRows.filter((_, index) => indexedTexts[index].includes(query));
        for (const row of matches) {
            row.classList.add(SEARCH_MATCH_CLASS);
        }
        setCurrent(0, scroll);
    };

    const show = (): void => {
        host.hidden = false;
        markTranscriptUserScrollIntent(scroller, 'search');
        input.focus();
        input.select();
        runSearch(false);
    };

    const hide = (): void => {
        host.hidden = true;
        clearMatches();
        input.value = '';
        scroller.focus({ preventScroll: true });
    };

    const onKeydown = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && key === 'f') {
            event.preventDefault();
            event.stopPropagation();
            show();
            return;
        }
        if (!host.hidden && key === 'escape') {
            event.preventDefault();
            event.stopPropagation();
            hide();
            return;
        }
        if (!host.hidden && key === 'enter') {
            event.preventDefault();
            setCurrent(currentIndex + (event.shiftKey ? -1 : 1), true);
        }
    };

    const onInput = (): void => runSearch(false);
    const onSubmit = (event: SubmitEvent): void => {
        event.preventDefault();
        setCurrent(currentIndex + 1, true);
    };

    input.addEventListener('input', onInput);
    host.addEventListener('submit', onSubmit);
    prev.addEventListener('click', () => setCurrent(currentIndex - 1, true));
    next.addEventListener('click', () => setCurrent(currentIndex + 1, true));
    close.addEventListener('click', hide);
    scroller.addEventListener('keydown', onKeydown);
    mountHost.addEventListener('keydown', onKeydown);

    return Disposable.create(() => {
        mutationObserver.disconnect();
        input.removeEventListener('input', onInput);
        host.removeEventListener('submit', onSubmit);
        scroller.removeEventListener('keydown', onKeydown);
        mountHost.removeEventListener('keydown', onKeydown);
        clearMatches();
        host.remove();
        if (previousTabIndex === null) {
            scroller.removeAttribute('tabindex');
        }
    });
}

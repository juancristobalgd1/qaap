// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { resolveScrollBehavior } from '../common/qaap-prefers-reduced-motion';
import { markTranscriptUserScrollIntent } from './qaap-transcript-scroll-intent';

const TURN_NAV_CLASS = 'theia-mobile-agent-transcript-turn-nav';
const TURN_NAV_ACTIVE_CLASS = 'theia-mod-active';
const USER_TURN_SELECTOR = '.theia-mobile-agent-transcript-user-wrap[data-transcript-message-id]';
const MAX_VISIBLE_TURNS = 18;

function userTurnRows(scroller: HTMLElement): HTMLElement[] {
    const rows = [...scroller.querySelectorAll<HTMLElement>(USER_TURN_SELECTOR)];
    if (rows.length <= MAX_VISIBLE_TURNS) {
        return rows;
    }
    const step = Math.ceil(rows.length / MAX_VISIBLE_TURNS);
    const sampled = rows.filter((_, index) => index % step === 0);
    const last = rows.at(-1);
    if (last && sampled.at(-1) !== last) {
        sampled.push(last);
    }
    return sampled;
}

export function attachTranscriptTurnNavigator(mountHost: HTMLElement, scroller: HTMLElement): Disposable {
    mountHost.querySelector(`.${TURN_NAV_CLASS}`)?.remove();

    const nav = document.createElement('nav');
    nav.className = TURN_NAV_CLASS;
    nav.setAttribute('aria-label', nls.localize('qaap/mobileProjects/transcriptTurnNavigator', 'Conversation turns'));
    mountHost.append(nav);

    let rows: HTMLElement[] = [];
    let buttons: HTMLButtonElement[] = [];
    let raf = 0;

    const updateActive = (): void => {
        raf = 0;
        if (!rows.length) {
            return;
        }
        const scrollerRect = scroller.getBoundingClientRect();
        let activeIndex = 0;
        for (let index = 0; index < rows.length; index++) {
            if (rows[index].getBoundingClientRect().top <= scrollerRect.top + scroller.clientHeight * 0.28) {
                activeIndex = index;
            }
        }
        buttons.forEach((button, index) => {
            button.classList.toggle(TURN_NAV_ACTIVE_CLASS, index === activeIndex);
            button.setAttribute('aria-current', index === activeIndex ? 'step' : 'false');
        });
    };

    const scheduleActive = (): void => {
        if (raf) {
            return;
        }
        raf = requestAnimationFrame(updateActive);
    };

    const rebuild = (): void => {
        rows = userTurnRows(scroller);
        nav.hidden = rows.length < 3;
        buttons = rows.map((row, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'theia-mobile-agent-transcript-turn-nav-dot';
            button.title = nls.localize('qaap/mobileProjects/transcriptTurnJump', 'Jump to turn {0}', String(index + 1));
            button.setAttribute('aria-label', button.title);
            button.addEventListener('click', event => {
                event.preventDefault();
                markTranscriptUserScrollIntent(scroller, 'turn-nav');
                row.scrollIntoView({ block: 'start', behavior: resolveScrollBehavior('smooth') });
                scheduleActive();
            });
            return button;
        });
        nav.replaceChildren(...buttons);
        scheduleActive();
    };

    const mutationObserver = new MutationObserver(rebuild);
    mutationObserver.observe(scroller, { childList: true, subtree: true });
    scroller.addEventListener('scroll', scheduleActive, { passive: true });
    rebuild();

    return Disposable.create(() => {
        if (raf) {
            cancelAnimationFrame(raf);
        }
        mutationObserver.disconnect();
        scroller.removeEventListener('scroll', scheduleActive);
        nav.remove();
    });
}

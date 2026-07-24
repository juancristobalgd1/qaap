// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';

export const CHAT_SCROLL_FADE_TOP_CLASS = 'theia-mod-chat-scroll-fade-top';
export const CHAT_SCROLL_FADE_BOTTOM_CLASS = 'theia-mod-chat-scroll-fade-bottom';

/** Scroll hosts that receive fade state classes on their overlay parents. */
export const CHAT_SCROLL_FADE_SCROLLER_SELECTORS = [
    '.chat-view-widget',
    '.chat-tree-view-widget',
    '.chat-tree-view-widget .body',
    '.theia-mobile-agent-transcript',
    '.theia-mobile-projects.theia-mod-sticky-composer > .theia-mobile-projects-scroll',
] as const;

export const CHAT_SCROLL_FADE_SCROLLER_SELECTOR = CHAT_SCROLL_FADE_SCROLLER_SELECTORS.join(',');

export interface ChatScrollFadeState {
    showTop: boolean;
    showBottom: boolean;
}

export interface ChatScrollFadeHosts {
    top: HTMLElement;
    bottom: HTMLElement;
}

export function resolveChatScrollFadeState(
    scrollTop: number,
    scrollHeight: number,
    clientHeight: number,
    thresholdPx = 8,
): ChatScrollFadeState {
    const canScroll = scrollHeight > clientHeight + 1;
    const atTop = scrollTop <= thresholdPx;
    const atBottom = scrollHeight - scrollTop - clientHeight <= thresholdPx;
    return {
        showTop: canScroll && !atTop,
        showBottom: canScroll && !atBottom,
    };
}

function resolveProjectsScrollBottomHost(scroller: HTMLElement): HTMLElement | undefined {
    const projectsRoot = scroller.closest<HTMLElement>('.theia-mobile-projects.theia-mod-sticky-composer');
    if (!projectsRoot) {
        return undefined;
    }
    return projectsRoot.querySelector<HTMLElement>(':scope > .theia-mobile-projects-scroll') ?? undefined;
}

/** Agents hub chat already dissolves into composer chrome — skip bottom overlay host. */
function isAgentsHubChatSurface(node: Element | null | undefined): boolean {
    const projects = node?.closest?.('.theia-mobile-projects');
    return !!projects?.classList.contains('theia-mod-agents-hub-inline-active')
        || !!projects?.classList.contains('theia-mod-agents-hub-shell-active');
}

export function resolveChatScrollFadeHosts(scroller: HTMLElement): ChatScrollFadeHosts {
    const projectsScrollBottom = resolveProjectsScrollBottomHost(scroller);
    const agentsHubChat = isAgentsHubChatSurface(scroller);
    const workHubChat = scroller.closest<HTMLElement>('.qaap-work-hub-chat-view-widget');
    const transcriptList = scroller.classList.contains('theia-mobile-agent-transcript')
        ? scroller
        : scroller.closest<HTMLElement>('.theia-mobile-agent-transcript');
    if (workHubChat && transcriptList) {
        const realChatHost = transcriptList.parentElement?.classList.contains('theia-mobile-agent-transcript-real-chat')
            ? transcriptList.parentElement
            : transcriptList.closest<HTMLElement>('.theia-mobile-agent-transcript-real-chat');
        const inlineTranscript = realChatHost?.closest<HTMLElement>('.theia-mobile-agents-hub-inline-transcript');
        return {
            top: inlineTranscript ?? workHubChat,
            // Prefer real-chat (CSS forces ::after display:none) over projects-scroll fade.
            bottom: agentsHubChat
                ? (realChatHost ?? transcriptList)
                : (projectsScrollBottom ?? realChatHost ?? transcriptList),
        };
    }

    const chatView = scroller.closest<HTMLElement>('.chat-view-widget');
    if (chatView) {
        return { top: chatView, bottom: chatView };
    }

    if (transcriptList) {
        const realChatHost = transcriptList.parentElement?.classList.contains('theia-mobile-agent-transcript-real-chat')
            ? transcriptList.parentElement
            : transcriptList.closest<HTMLElement>('.theia-mobile-agent-transcript-real-chat');
        const inlineTranscript = realChatHost?.closest<HTMLElement>('.theia-mobile-agents-hub-inline-transcript');
        const topHost = inlineTranscript ?? realChatHost ?? transcriptList;
        const bottomHost = realChatHost ?? transcriptList;
        return {
            top: topHost,
            bottom: agentsHubChat ? bottomHost : (projectsScrollBottom ?? bottomHost),
        };
    }

    if (scroller.classList.contains('theia-mobile-projects-scroll') && projectsScrollBottom) {
        return { top: scroller, bottom: projectsScrollBottom };
    }

    const realChat = scroller.closest<HTMLElement>('.theia-mobile-agent-transcript-real-chat');
    if (realChat && scroller === realChat) {
        return { top: realChat, bottom: realChat };
    }

    return { top: scroller, bottom: scroller };
}

export function installChatScrollFade(scroller: HTMLElement): Disposable {
    if (typeof window === 'undefined') {
        return Disposable.NULL;
    }
    if (scroller.dataset.qaapChatScrollFade === 'true') {
        return Disposable.NULL;
    }
    if (scroller.classList.contains('theia-mobile-projects-scroll')) {
        const innerTranscript = scroller.querySelector(':scope .theia-mobile-agent-transcript');
        if (innerTranscript instanceof HTMLElement) {
            return Disposable.NULL;
        }
    }
    scroller.dataset.qaapChatScrollFade = 'true';

    const hosts = resolveChatScrollFadeHosts(scroller);
    let rafId = 0;

    const applyState = (state: ChatScrollFadeState): void => {
        hosts.top.classList.toggle(CHAT_SCROLL_FADE_TOP_CLASS, state.showTop);
        hosts.bottom.classList.toggle(CHAT_SCROLL_FADE_BOTTOM_CLASS, state.showBottom);
    };

    const update = (): void => {
        applyState(resolveChatScrollFadeState(
            scroller.scrollTop,
            scroller.scrollHeight,
            scroller.clientHeight,
        ));
    };

    const scheduleUpdate = (): void => {
        if (rafId) {
            return;
        }
        rafId = window.requestAnimationFrame(() => {
            rafId = 0;
            update();
        });
    };

    scroller.addEventListener('scroll', scheduleUpdate, { passive: true });
    update();

    const resizeObserver = typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => scheduleUpdate())
        : undefined;
    resizeObserver?.observe(scroller);

    return Disposable.create(() => {
        if (rafId) {
            window.cancelAnimationFrame(rafId);
        }
        scroller.removeEventListener('scroll', scheduleUpdate);
        resizeObserver?.disconnect();
        delete scroller.dataset.qaapChatScrollFade;
        hosts.top.classList.remove(CHAT_SCROLL_FADE_TOP_CLASS);
        hosts.bottom.classList.remove(CHAT_SCROLL_FADE_BOTTOM_CLASS);
    });
}

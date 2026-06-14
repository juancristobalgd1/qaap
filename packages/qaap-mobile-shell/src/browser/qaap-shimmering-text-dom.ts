// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import {
    getQaapAgentLoadingPhrases,
    QAAP_AGENT_LOADING_PHRASE_CYCLE_MS,
    resolveQaapAgentLoadingPhraseIndex,
} from '../common/qaap-agent-loading-phrases';

export const QAAP_SHIMMER_CYCLE_ATTR = 'data-qaap-shimmer-cycle';
export const QAAP_SHIMMER_HOST_ATTR = 'data-qaap-shimmer-host';

const shimmeringTextHandles = new WeakMap<HTMLElement, QaapShimmeringTextDomHandle>();

export function resolveQaapShimmeringTextHandle(host: HTMLElement): QaapShimmeringTextDomHandle | undefined {
    return shimmeringTextHandles.get(host);
}

export function bindQaapShimmeringTextHandle(host: HTMLElement, handle: QaapShimmeringTextDomHandle): void {
    shimmeringTextHandles.set(host, handle);
    host.setAttribute(QAAP_SHIMMER_HOST_ATTR, 'true');
}

export function disposeQaapShimmeringTextHost(host: HTMLElement): void {
    shimmeringTextHandles.get(host)?.dispose();
    shimmeringTextHandles.delete(host);
}

export interface QaapShimmeringTextDomOptions {
    readonly text: string;
    readonly cycle?: boolean;
    readonly phrases?: readonly string[];
    readonly cycleIntervalMs?: number;
    readonly className?: string;
}

export interface QaapShimmeringTextDomHandle {
    readonly element: HTMLSpanElement;
    setText(text: string): void;
    setCycleEnabled(enabled: boolean, fallbackText?: string): void;
    dispose(): void;
}

export function mountQaapShimmeringText(options: QaapShimmeringTextDomOptions): QaapShimmeringTextDomHandle {
    const phrases = options.phrases ?? getQaapAgentLoadingPhrases();
    const cycleIntervalMs = options.cycleIntervalMs ?? QAAP_AGENT_LOADING_PHRASE_CYCLE_MS;
    let cycle = options.cycle ?? false;
    let phraseIndex = 0;
    let staticText = options.text;
    let cycleTimer: number | undefined;
    let fadeTimer: number | undefined;

    const root = document.createElement('span');
    root.className = `qaap-shimmering-text ${options.className ?? ''}`.trim();
    if (cycle) {
        root.setAttribute(QAAP_SHIMMER_CYCLE_ATTR, 'true');
    }

    const phrase = document.createElement('span');
    phrase.className = 'qaap-shimmering-text-phrase qaap-mod-visible';
    phrase.textContent = cycle
        ? phrases[resolveQaapAgentLoadingPhraseIndex(phraseIndex, phrases.length)] ?? staticText
        : staticText;
    root.append(phrase);

    const clearTimers = (): void => {
        if (cycleTimer !== undefined) {
            window.clearInterval(cycleTimer);
            cycleTimer = undefined;
        }
        if (fadeTimer !== undefined) {
            window.clearTimeout(fadeTimer);
            fadeTimer = undefined;
        }
    };

    const renderPhrase = (nextText: string, animate: boolean): void => {
        if (!animate) {
            phrase.classList.remove('qaap-mod-hidden');
            phrase.classList.add('qaap-mod-visible');
            phrase.textContent = nextText;
            return;
        }
        phrase.classList.remove('qaap-mod-visible');
        phrase.classList.add('qaap-mod-hidden');
        fadeTimer = window.setTimeout(() => {
            phrase.textContent = nextText;
            phrase.classList.remove('qaap-mod-hidden');
            phrase.classList.add('qaap-mod-visible');
            fadeTimer = undefined;
        }, 150);
    };

    const startCycle = (): void => {
        clearTimers();
        if (!cycle || phrases.length <= 1) {
            return;
        }
        cycleTimer = window.setInterval(() => {
            phraseIndex = resolveQaapAgentLoadingPhraseIndex(phraseIndex + 1, phrases.length);
            renderPhrase(phrases[phraseIndex] ?? staticText, true);
        }, cycleIntervalMs);
    };

    const setText = (text: string): void => {
        staticText = text;
        if (!cycle) {
            renderPhrase(text, false);
        }
    };

    const setCycleEnabled = (enabled: boolean, fallbackText?: string): void => {
        cycle = enabled;
        if (fallbackText !== undefined) {
            staticText = fallbackText;
        }
        if (cycle) {
            root.setAttribute(QAAP_SHIMMER_CYCLE_ATTR, 'true');
            phraseIndex = 0;
            renderPhrase(phrases[phraseIndex] ?? staticText, false);
            startCycle();
            return;
        }
        root.removeAttribute(QAAP_SHIMMER_CYCLE_ATTR);
        clearTimers();
        renderPhrase(staticText, false);
    };

    startCycle();

    const handle: QaapShimmeringTextDomHandle = {
        element: root,
        setText,
        setCycleEnabled,
        dispose: () => {
            clearTimers();
            root.remove();
        },
    };
    return handle;
}

export function findQaapShimmeringTextLabel(host: ParentNode): HTMLSpanElement | undefined {
    return host.querySelector<HTMLSpanElement>('.qaap-shimmering-text') ?? undefined;
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/* Ported from Robrusi/CloudCode components/chat/message-setup.tsx — adapted
   from React to DOM manipulation for the Theia/qaap browser frontend.

   Provides:
   - SETUP_PHRASES: whimsical stand-in phrases shown while the agent prepares.
   - createBrandLogoIndicator(): animated Qaap brand logo (CSS background).
   - createAgentSetupElement(): creates a self-updating DOM element with
     brand logo + per-letter shimmer text that rotates phrases and surfaces
     real informative status messages with a dwell timer.
   - syncAgentSetupElement(): updates the element with a new real status or
     streaming state. */

/* Whimsical stand-ins for setup statuses. Order is shuffled-feeling but
   fixed so rotation is deterministic across renders. */
const SETUP_PHRASES = [
    'Terminating competitors',
    'Counting sheep',
    'Orbiting',
    'Increasing ARR',
    'Warming up the hamsters',
    'Nucleating',
    'Tomfoolering',
    'Aligning the stars',
    'Brewing coffee',
    'Summoning electrons',
    'CloudCoding',
] as const;

/* Real setup work worth surfacing verbatim (downloads, cloning, sandbox
   creation, install scripts). Anything else gets the whimsy. */
const INFORMATIVE_PATTERNS = [
    /downloading/i,
    /creating .*sandbox/i,
    /sandbox ready/i,
    /cloning|cloned/i,
    /environment scan/i,
    /install script/i,
    /path setup script/i,
    /preset secret/i,
    /app-server daemon/i,
    /bootstrap/i,
    /starting.*server/i,
];

export const QAAP_BRAND_LOGO_INDICATOR_CLASS = 'qaap-brand-logo-indicator';

const PHRASE_MIN_MS = 7000;
const PHRASE_MAX_MS = 8500;
const STATUS_DWELL_MS = 4000;
const LETTER_STAGGER_MS = 55;

function randomPhraseDelay(): number {
    return PHRASE_MIN_MS + Math.random() * (PHRASE_MAX_MS - PHRASE_MIN_MS);
}

function randomPhraseIndex(exclude: number): number {
    const index = Math.floor(Math.random() * (SETUP_PHRASES.length - 1));
    return index >= exclude ? index + 1 : index;
}

/** Returns a friendly informative message from a raw status string, or null. */
export function resolveInformativeSetupMessage(rawStatus: string | null | undefined): string | null {
    if (!rawStatus) {
        return null;
    }
    if (rawStatus.startsWith('git clone')) {
        return 'Cloning repository';
    }
    if (/^downloading /i.test(rawStatus)) {
        return rawStatus;
    }
    if (rawStatus.startsWith('codex app-server') || rawStatus.startsWith('claude')) {
        return 'Starting agent server';
    }
    if (INFORMATIVE_PATTERNS.some(pattern => pattern.test(rawStatus))) {
        return rawStatus;
    }
    return null;
}

interface ShimmerTextRenderState {
    epoch: number;
    delays: number[];
    prevCount: number;
    lastText?: string;
}

interface AgentSetupState extends ShimmerTextRenderState {
    phraseIndex: number;
    shownStatus: string | null;
    statusShownAt: number;
    phraseTimer: ReturnType<typeof setTimeout> | undefined;
    statusTimer: ReturnType<typeof setTimeout> | undefined;
}

const shimmerTextStates = new WeakMap<HTMLElement, ShimmerTextRenderState>();

const setupStates = new WeakMap<HTMLElement, AgentSetupState>();

function initState(): AgentSetupState {
    return {
        phraseIndex: Math.floor(Math.random() * SETUP_PHRASES.length),
        shownStatus: null,
        statusShownAt: 0,
        epoch: 0,
        delays: [],
        prevCount: 0,
        phraseTimer: undefined,
        statusTimer: undefined,
    };
}

/**
 * Renders per-letter shimmer text into a container, reusing the same animation
 * as the first-prompt setup phase. Safe to call repeatedly; skips work when
 * the text is unchanged.
 */
export function syncShimmerTextElement(container: HTMLElement, text: string): void {
    let state = shimmerTextStates.get(container);
    if (!state) {
        state = { epoch: 0, delays: [], prevCount: 0 };
        shimmerTextStates.set(container, state);
    }
    const textChanged = state.lastText !== text;
    if (!textChanged && container.childElementCount > 0) {
        return;
    }
    if (textChanged) {
        state.prevCount = 0;
        state.delays = [];
        state.epoch = 0;
        state.lastText = text;
    }
    renderShimmerText(container, text, state, textChanged || container.childElementCount === 0);
}

/** Animated Qaap app logo — same asset as splash / empty workbench via CSS var. */
export function createBrandLogoIndicator(): HTMLElement {
    const logo = document.createElement('span');
    logo.className = QAAP_BRAND_LOGO_INDICATOR_CLASS;
    logo.setAttribute('aria-hidden', 'true');
    return logo;
}

function renderShimmerText(
    textContainer: HTMLElement,
    text: string,
    state: ShimmerTextRenderState,
    mounted: boolean,
): void {
    const letters = Array.from(text);
    textContainer.setAttribute('aria-label', text);

    if (mounted) {
        const now = performance.now();
        if (state.epoch === 0) {
            state.epoch = now;
        }
        for (let index = state.prevCount; index < letters.length; index++) {
            state.delays[index] = index * LETTER_STAGGER_MS - (now - state.epoch);
        }
        state.prevCount = letters.length;
    }

    textContainer.replaceChildren(
        ...letters.map((letter, index) => {
            const span = document.createElement('span');
            span.className = 'qaap-agent-setup-letter';
            span.setAttribute('aria-hidden', 'true');
            const delay = state.delays[index];
            if (delay !== undefined && mounted) {
                span.style.animationDelay = `${delay}ms`;
            }
            span.textContent = letter === ' ' ? '\u00A0' : letter;
            return span;
        }),
    );
}

function startPhraseRotation(
    element: HTMLElement,
    textContainer: HTMLElement,
    state: AgentSetupState,
): void {
    if (state.phraseTimer !== undefined) {
        clearTimeout(state.phraseTimer);
    }
    const scheduleNext = (): void => {
        state.phraseTimer = setTimeout(() => {
            // Mirror the self-termination check `startSpinner` already does:
            // once the element is removed from the document (row replaced or
            // scrolled out by the virtual list), stop rescheduling instead of
            // running forever. The `destroyAgentSetupElement` MutationObserver
            // set up by the caller only fires on mutations *within* the row's
            // own subtree, so it never sees the row itself being detached
            // wholesale from its parent — without this guard the recurring
            // phrase timer keeps firing (and touching `document`) long after
            // the element — and in tests, the whole jsdom document — is gone.
            if (!element.isConnected) {
                state.phraseTimer = undefined;
                return;
            }
            state.phraseIndex = randomPhraseIndex(state.phraseIndex);
            if (state.shownStatus === null) {
                renderShimmerText(textContainer, SETUP_PHRASES[state.phraseIndex]!, state, true);
            }
            scheduleNext();
        }, randomPhraseDelay());
    };
    scheduleNext();
}

/**
 * Creates a self-contained agent setup animation element.
 * The element updates itself via internal timers — call
 * {@link syncAgentSetupElement} to push real status messages, and
 * {@link destroyAgentSetupElement} when the element is removed.
 */
export function createAgentSetupElement(initialStatus?: string | null): HTMLElement {
    const element = document.createElement('div');
    element.className = 'qaap-agent-setup';

    const logo = createBrandLogoIndicator();
    logo.classList.add('qaap-agent-setup-logo');

    const textContainer = document.createElement('span');
    textContainer.className = 'qaap-agent-setup-text';

    element.append(logo, textContainer);

    const state = initState();
    setupStates.set(element, state);

    const realStatus = resolveInformativeSetupMessage(initialStatus) ?? null;
    state.shownStatus = realStatus;
    if (realStatus) {
        state.statusShownAt = Date.now();
        element.classList.add('theia-mod-real-status');
    }

    renderShimmerText(textContainer, realStatus ?? SETUP_PHRASES[state.phraseIndex]!, state, false);

    requestAnimationFrame(() => {
        if (!element.isConnected) {
            return;
        }
        renderShimmerText(textContainer, realStatus ?? SETUP_PHRASES[state.phraseIndex]!, state, true);
        if (realStatus === null) {
            startPhraseRotation(element, textContainer, state);
        }
    });

    return element;
}

/**
 * Updates the setup element with a new real status message.
 * If the message is informative, it overrides the whimsical phrases.
 * When the status becomes null, phrases resume after a dwell period.
 */
export function syncAgentSetupElement(
    element: HTMLElement,
    realStatus: string | null | undefined,
): void {
    const state = setupStates.get(element);
    if (!state) {
        return;
    }
    const informative = resolveInformativeSetupMessage(realStatus ?? null);
    const textContainer = element.querySelector<HTMLElement>('.qaap-agent-setup-text');
    if (!textContainer) {
        return;
    }

    if (informative) {
        if (state.statusTimer !== undefined) {
            clearTimeout(state.statusTimer);
            state.statusTimer = undefined;
        }
        state.shownStatus = informative;
        state.statusShownAt = Date.now();
        element.classList.add('theia-mod-real-status');
        renderShimmerText(textContainer, informative, state, true);
        if (state.phraseTimer === undefined) {
            startPhraseRotation(element, textContainer, state);
        }
        return;
    }

    if (!state.shownStatus) {
        return;
    }

    const remaining = STATUS_DWELL_MS - (Date.now() - state.statusShownAt);
    if (remaining <= 0) {
        state.shownStatus = null;
        element.classList.remove('theia-mod-real-status');
        renderShimmerText(textContainer, SETUP_PHRASES[state.phraseIndex]!, state, true);
        if (state.phraseTimer === undefined) {
            startPhraseRotation(element, textContainer, state);
        }
        return;
    }

    if (state.statusTimer !== undefined) {
        clearTimeout(state.statusTimer);
    }
    state.statusTimer = setTimeout(() => {
        state.statusTimer = undefined;
        state.shownStatus = null;
        element.classList.remove('theia-mod-real-status');
        if (element.isConnected) {
            renderShimmerText(textContainer, SETUP_PHRASES[state.phraseIndex]!, state, true);
            if (state.phraseTimer === undefined) {
                startPhraseRotation(element, textContainer, state);
            }
        }
    }, remaining);
}

/** Cleans up all timers associated with a setup element. */
export function destroyAgentSetupElement(element: HTMLElement): void {
    const state = setupStates.get(element);
    if (!state) {
        return;
    }
    if (state.phraseTimer !== undefined) {
        clearTimeout(state.phraseTimer);
    }
    if (state.statusTimer !== undefined) {
        clearTimeout(state.statusTimer);
    }
    setupStates.delete(element);
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/* Ported from Robrusi/CloudCode components/chat/message-setup.tsx — adapted
   from React to DOM manipulation for the Theia/qaap browser frontend.

   Provides:
   - SETUP_PHRASES: whimsical stand-in phrases shown while the agent prepares.
   - SPINNERS: unicode spinner frame sets (braille, dots, arrows, etc.).
   - createAgentSetupElement(): creates a self-updating DOM element with
     spinner + per-letter shimmer text that rotates phrases and surfaces
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

/* Unicode spinner frame sets — snake braille spinner from the
   `unicode-animations` / `cli-loaders` packages, hardcoded to avoid
   a runtime dependency. The snake animation traces a serpentine path
   through a 4×4 braille grid with a 4-dot trailing tail. */
export const SPINNERS: ReadonlyArray<{ readonly frames: readonly string[]; readonly interval: number }> = [
    { frames: ['⣁⡀', '⣉⠀', '⡉⠁', '⠉⠉', '⠈⠙', '⠀⠛', '⠐⠚', '⠒⠒', '⠖⠂', '⠶⠀', '⠦⠄', '⠤⠤', '⠠⢤', '⠀⣤', '⢀⣠', '⣀⣀'], interval: 80 },
];

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

interface AgentSetupState {
    readonly spinnerIndex: number;
    phraseIndex: number;
    frame: number;
    shownStatus: string | null;
    statusShownAt: number;
    epoch: number;
    delays: number[];
    prevCount: number;
    phraseTimer: ReturnType<typeof setTimeout> | undefined;
    spinnerTimer: ReturnType<typeof setInterval> | undefined;
    statusTimer: ReturnType<typeof setTimeout> | undefined;
}

const setupStates = new WeakMap<HTMLElement, AgentSetupState>();

function initState(): AgentSetupState {
    return {
        spinnerIndex: Math.floor(Math.random() * SPINNERS.length),
        phraseIndex: Math.floor(Math.random() * SETUP_PHRASES.length),
        frame: 0,
        shownStatus: null,
        statusShownAt: 0,
        epoch: 0,
        delays: [],
        prevCount: 0,
        phraseTimer: undefined,
        spinnerTimer: undefined,
        statusTimer: undefined,
    };
}

function renderSpinner(element: HTMLElement, state: AgentSetupState): void {
    const spinner = element.querySelector('.qaap-agent-setup-spinner');
    if (!spinner) {
        return;
    }
    const spinnerDef = SPINNERS[state.spinnerIndex]!;
    spinner.textContent = spinnerDef.frames[state.frame % spinnerDef.frames.length]!;
}

function renderShimmerText(
    textContainer: HTMLElement,
    text: string,
    state: AgentSetupState,
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
            state.phraseIndex = randomPhraseIndex(state.phraseIndex);
            if (state.shownStatus === null) {
                renderShimmerText(textContainer, SETUP_PHRASES[state.phraseIndex]!, state, true);
            }
            scheduleNext();
        }, randomPhraseDelay());
    };
    scheduleNext();
}

function startSpinner(element: HTMLElement, state: AgentSetupState): void {
    if (state.spinnerTimer !== undefined) {
        clearInterval(state.spinnerTimer);
    }
    const spinnerDef = SPINNERS[state.spinnerIndex]!;
    state.spinnerTimer = setInterval(() => {
        if (!element.isConnected) {
            clearInterval(state.spinnerTimer!);
            state.spinnerTimer = undefined;
            return;
        }
        state.frame += 1;
        renderSpinner(element, state);
    }, spinnerDef.interval);
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

    const spinner = document.createElement('span');
    spinner.className = 'qaap-agent-setup-spinner';
    spinner.setAttribute('aria-hidden', 'true');

    const textContainer = document.createElement('span');
    textContainer.className = 'qaap-agent-setup-text';

    element.append(spinner, textContainer);

    const state = initState();
    setupStates.set(element, state);

    const realStatus = resolveInformativeSetupMessage(initialStatus) ?? null;
    state.shownStatus = realStatus;
    if (realStatus) {
        state.statusShownAt = Date.now();
        element.classList.add('theia-mod-real-status');
    }

    renderSpinner(element, state);
    renderShimmerText(textContainer, realStatus ?? SETUP_PHRASES[state.phraseIndex]!, state, false);

    requestAnimationFrame(() => {
        if (!element.isConnected) {
            return;
        }
        renderShimmerText(textContainer, realStatus ?? SETUP_PHRASES[state.phraseIndex]!, state, true);
        startSpinner(element, state);
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
    if (state.spinnerTimer !== undefined) {
        clearInterval(state.spinnerTimer);
    }
    if (state.statusTimer !== undefined) {
        clearTimeout(state.statusTimer);
    }
    setupStates.delete(element);
}

const spinnerStates = new WeakMap<HTMLElement, { readonly spinnerIndex: number; frame: number; timer: ReturnType<typeof setInterval> | undefined }>();

/**
 * Creates a standalone unicode spinner element that cycles frames on its own.
 * Use {@link destroyUnicodeSpinner} to clean up the timer when the element is removed.
 */
export function createUnicodeSpinner(): HTMLElement {
    const spinnerIndex = Math.floor(Math.random() * SPINNERS.length);
    const spinnerDef = SPINNERS[spinnerIndex]!;
    const el = document.createElement('span');
    el.className = 'qaap-unicode-spinner';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = spinnerDef.frames[0]!;
    const state = {
        spinnerIndex,
        frame: 0,
        timer: undefined as ReturnType<typeof setInterval> | undefined,
    };
    spinnerStates.set(el, state);
    state.timer = setInterval(() => {
        if (!el.isConnected) {
            clearInterval(state.timer!);
            state.timer = undefined;
            return;
        }
        state.frame += 1;
        el.textContent = spinnerDef.frames[state.frame % spinnerDef.frames.length]!;
    }, spinnerDef.interval);
    return el;
}

/** Cleans up the timer for a standalone unicode spinner. */
export function destroyUnicodeSpinner(el: HTMLElement): void {
    const state = spinnerStates.get(el);
    if (!state) {
        return;
    }
    if (state.timer !== undefined) {
        clearInterval(state.timer);
    }
    spinnerStates.delete(el);
}

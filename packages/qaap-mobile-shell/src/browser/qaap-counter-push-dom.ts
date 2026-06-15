// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { prefersReducedMotion } from '../common/qaap-prefers-reduced-motion';

export const QAAP_COUNTER_PUSH_TRANSITION_MS = 260;

export interface QaapCounterPushHandle {
    readonly element: HTMLElement;
    getValue(): number;
    setValue(nextValue: number, options?: { readonly animate?: boolean }): void;
    dispose(): void;
}

interface CounterPushState {
    value: number;
    locked: boolean;
    pending?: { readonly value: number; readonly animate: boolean };
    root: HTMLElement;
    prefixEl: HTMLElement;
    digitsRow: HTMLElement;
    format: (value: number) => string;
}

const counterPushHandles = new WeakMap<HTMLElement, QaapCounterPushHandle>();

export function resolveQaapCounterPushHandle(host: HTMLElement): QaapCounterPushHandle | undefined {
    return counterPushHandles.get(host);
}

/** Test helper — reads the visible prefix + digit columns. */
export function readQaapCounterPushDisplayText(host: HTMLElement): string {
    const prefix = host.querySelector('.qaap-counter-push-prefix')?.textContent ?? '';
    const digits = Array.from(host.querySelectorAll('.qaap-counter-push-digit-col'))
        .map(col => {
            const layers = col.querySelectorAll<HTMLElement>('.qaap-counter-push-digit');
            return layers.item(layers.length - 1)?.textContent ?? '';
        })
        .join('');
    return `${prefix}${digits}`;
}

interface ParsedCounterText {
    readonly prefix: string;
    readonly digits: string;
}

function parseFormattedCounter(formatted: string): ParsedCounterText {
    if (formatted.startsWith('+') || formatted.startsWith('-')) {
        return { prefix: formatted[0], digits: formatted.slice(1) };
    }
    return { prefix: '', digits: formatted };
}

function alignDigitStrings(oldDigits: string, newDigits: string): { readonly oldChars: string[]; readonly newChars: string[] } {
    const maxLen = Math.max(oldDigits.length, newDigits.length);
    return {
        oldChars: oldDigits.padStart(maxLen, ' ').split(''),
        newChars: newDigits.padStart(maxLen, ' ').split(''),
    };
}

function scheduleCounterPushFrame(callback: FrameRequestCallback): void {
    const schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (cb: FrameRequestCallback): number => window.setTimeout(() => cb(Date.now()), 0);
    schedule(() => {
        schedule(callback);
    });
}

function createDigitColumn(char: string): HTMLElement {
    const col = document.createElement('span');
    col.className = 'qaap-counter-push-digit-col';
    const viewport = document.createElement('span');
    viewport.className = 'qaap-counter-push-digit-viewport';
    const layer = document.createElement('span');
    layer.className = 'qaap-counter-push-digit';
    layer.textContent = char;
    viewport.append(layer);
    col.append(viewport);
    return col;
}

function getDigitViewport(col: HTMLElement): HTMLElement {
    return col.querySelector<HTMLElement>('.qaap-counter-push-digit-viewport')!;
}

function getActiveDigitLayer(viewport: HTMLElement): HTMLElement | undefined {
    const layers = viewport.querySelectorAll<HTMLElement>('.qaap-counter-push-digit');
    return layers.item(layers.length - 1) ?? undefined;
}

function renderInstantDigits(state: CounterPushState, formatted: string): void {
    const { prefix, digits } = parseFormattedCounter(formatted);
    state.prefixEl.textContent = prefix;
    state.digitsRow.replaceChildren();
    for (const char of digits) {
        state.digitsRow.append(createDigitColumn(char));
    }
}

function animateDigitLayer(
    viewport: HTMLElement,
    nextChar: string,
    increasing: boolean,
): Promise<void> {
    const oldLayer = getActiveDigitLayer(viewport);
    if (!oldLayer) {
        const layer = document.createElement('span');
        layer.className = 'qaap-counter-push-digit';
        layer.textContent = nextChar;
        viewport.append(layer);
        return Promise.resolve();
    }
    if (oldLayer.textContent === nextChar) {
        return Promise.resolve();
    }

    const from = increasing ? '100%' : '-100%';
    const to = increasing ? '-100%' : '100%';

    return new Promise(resolve => {
        const newLayer = document.createElement('span');
        newLayer.className = 'qaap-counter-push-digit qaap-mod-entering';
        newLayer.textContent = nextChar;
        newLayer.style.transform = `translateY(${from})`;
        oldLayer.classList.add('qaap-mod-exiting');
        oldLayer.style.transform = 'translateY(0)';
        viewport.append(newLayer);

        scheduleCounterPushFrame(() => {
            oldLayer.style.transform = `translateY(${to})`;
            newLayer.style.transform = 'translateY(0)';
        });

        const finish = (): void => {
            oldLayer.remove();
            newLayer.classList.remove('qaap-mod-entering');
            newLayer.removeAttribute('style');
            resolve();
        };

        newLayer.addEventListener('transitionend', event => {
            if (event.propertyName === 'transform') {
                finish();
            }
        }, { once: true });
        window.setTimeout(finish, QAAP_COUNTER_PUSH_TRANSITION_MS + 80);
    });
}

function animateColumnRemoval(col: HTMLElement, increasing: boolean): Promise<void> {
    const viewport = getDigitViewport(col);
    const oldLayer = getActiveDigitLayer(viewport);
    if (!oldLayer) {
        return Promise.resolve();
    }
    const to = increasing ? '-100%' : '100%';
    return new Promise(resolve => {
        oldLayer.classList.add('qaap-mod-exiting');
        scheduleCounterPushFrame(() => {
            oldLayer.style.transform = `translateY(${to})`;
        });
        const finish = (): void => {
            col.remove();
            resolve();
        };
        oldLayer.addEventListener('transitionend', event => {
            if (event.propertyName === 'transform') {
                finish();
            }
        }, { once: true });
        window.setTimeout(finish, QAAP_COUNTER_PUSH_TRANSITION_MS + 80);
    });
}

function animateColumnInsert(
    digitsRow: HTMLElement,
    index: number,
    char: string,
    increasing: boolean,
): Promise<void> {
    const col = createDigitColumn(char);
    const viewport = getDigitViewport(col);
    const layer = getActiveDigitLayer(viewport)!;
    layer.remove();
    const from = increasing ? '100%' : '-100%';
    const newLayer = document.createElement('span');
    newLayer.className = 'qaap-counter-push-digit qaap-mod-entering';
    newLayer.textContent = char;
    newLayer.style.transform = `translateY(${from})`;
    viewport.append(newLayer);
    const insertBefore = digitsRow.children.item(index);
    if (insertBefore) {
        digitsRow.insertBefore(col, insertBefore);
    } else {
        digitsRow.append(col);
    }
    return new Promise(resolve => {
        scheduleCounterPushFrame(() => {
            newLayer.style.transform = 'translateY(0)';
        });
        const finish = (): void => {
            newLayer.classList.remove('qaap-mod-entering');
            newLayer.removeAttribute('style');
            resolve();
        };
        newLayer.addEventListener('transitionend', event => {
            if (event.propertyName === 'transform') {
                finish();
            }
        }, { once: true });
        window.setTimeout(finish, QAAP_COUNTER_PUSH_TRANSITION_MS + 80);
    });
}

function columnIndexForAlignedPosition(alignedIndex: number, oldChars: string[]): number | undefined {
    if (oldChars[alignedIndex] === ' ') {
        return undefined;
    }
    let columnsBefore = 0;
    for (let index = 0; index <= alignedIndex; index++) {
        if (oldChars[index] !== ' ') {
            columnsBefore++;
        }
    }
    return columnsBefore - 1;
}

function insertIndexForAlignedPosition(alignedIndex: number, newChars: string[]): number {
    let columnsBefore = 0;
    for (let index = 0; index < alignedIndex; index++) {
        if (newChars[index] !== ' ') {
            columnsBefore++;
        }
    }
    return columnsBefore;
}

async function animateFormattedCounter(state: CounterPushState, nextFormatted: string, nextValue: number): Promise<void> {
    const oldParsed = parseFormattedCounter(state.format(state.value));
    const newParsed = parseFormattedCounter(nextFormatted);
    state.prefixEl.textContent = newParsed.prefix;

    const { oldChars, newChars } = alignDigitStrings(oldParsed.digits, newParsed.digits);
    const cols = Array.from(state.digitsRow.querySelectorAll<HTMLElement>('.qaap-counter-push-digit-col'));
    const increasing = nextValue > state.value;
    const tasks: Promise<void>[] = [];

    for (let index = 0; index < oldChars.length; index++) {
        const oldChar = oldChars[index];
        const newChar = newChars[index];
        const colIndex = columnIndexForAlignedPosition(index, oldChars);
        const col = colIndex === undefined ? undefined : cols[colIndex];

        if (oldChar === ' ' && newChar !== ' ') {
            tasks.push(animateColumnInsert(
                state.digitsRow,
                insertIndexForAlignedPosition(index, newChars),
                newChar,
                increasing,
            ));
            continue;
        }
        if (oldChar !== ' ' && newChar === ' ') {
            if (col) {
                tasks.push(animateColumnRemoval(col, increasing));
            }
            continue;
        }
        if (oldChar !== newChar && col) {
            tasks.push(animateDigitLayer(getDigitViewport(col), newChar, increasing));
        }
    }

    await Promise.all(tasks);
    renderInstantDigits(state, nextFormatted);
}

export function mountQaapCounterPush(options: {
    readonly value: number;
    readonly format: (value: number) => string;
    readonly className?: string;
}): QaapCounterPushHandle {
    const root = document.createElement('span');
    if (options.className) {
        root.className = options.className;
    }
    const prefixEl = document.createElement('span');
    prefixEl.className = 'qaap-counter-push-prefix';
    const digitsRow = document.createElement('span');
    digitsRow.className = 'qaap-counter-push-digits';
    root.append(prefixEl, digitsRow);

    const state: CounterPushState = {
        value: options.value,
        locked: false,
        root,
        prefixEl,
        digitsRow,
        format: options.format,
    };

    renderInstantDigits(state, options.format(options.value));

    const flushPending = (): void => {
        if (!state.pending) {
            return;
        }
        const pending = state.pending;
        state.pending = undefined;
        applyValue(pending.value, pending.animate);
    };

    const applyValue = (nextValue: number, animate: boolean): void => {
        if (nextValue === state.value) {
            return;
        }
        if (state.locked) {
            state.pending = { value: nextValue, animate };
            return;
        }
        const nextFormatted = state.format(nextValue);
        if (!animate || prefersReducedMotion()) {
            state.value = nextValue;
            renderInstantDigits(state, nextFormatted);
            flushPending();
            return;
        }

        state.locked = true;
        void animateFormattedCounter(state, nextFormatted, nextValue).then(() => {
            state.value = nextValue;
            state.locked = false;
            flushPending();
        });
    };

    const handle: QaapCounterPushHandle = {
        element: root,
        getValue: () => state.value,
        setValue: (nextValue, setOptions) => {
            applyValue(nextValue, setOptions?.animate ?? true);
        },
        dispose: () => {
            state.pending = undefined;
            state.locked = false;
            counterPushHandles.delete(root);
            root.remove();
        },
    };
    counterPushHandles.set(root, handle);
    return handle;
}

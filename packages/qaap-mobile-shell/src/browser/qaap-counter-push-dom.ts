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
    viewport: HTMLElement;
    format: (value: number) => string;
}

const counterPushHandles = new WeakMap<HTMLElement, QaapCounterPushHandle>();

export function resolveQaapCounterPushHandle(host: HTMLElement): QaapCounterPushHandle | undefined {
    return counterPushHandles.get(host);
}

function getActiveCounterLayer(viewport: HTMLElement): HTMLElement | undefined {
    const layers = viewport.querySelectorAll<HTMLElement>('.qaap-counter-push-number');
    return layers.item(layers.length - 1) ?? undefined;
}

function clearCounterLayers(viewport: HTMLElement, keep?: HTMLElement): void {
    for (const layer of viewport.querySelectorAll<HTMLElement>('.qaap-counter-push-number')) {
        if (layer !== keep) {
            layer.remove();
        }
    }
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
    const viewport = document.createElement('span');
    viewport.className = 'qaap-counter-push-viewport';
    const current = document.createElement('span');
    current.className = 'qaap-counter-push-number';
    current.textContent = options.format(options.value);
    viewport.append(current);
    root.append(viewport);

    const state: CounterPushState = {
        value: options.value,
        locked: false,
        viewport,
        format: options.format,
    };

    const renderInstant = (nextValue: number): void => {
        state.value = nextValue;
        clearCounterLayers(viewport);
        const layer = document.createElement('span');
        layer.className = 'qaap-counter-push-number';
        layer.textContent = state.format(nextValue);
        viewport.append(layer);
    };

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
        if (!animate || prefersReducedMotion()) {
            renderInstant(nextValue);
            flushPending();
            return;
        }

        const oldNumber = getActiveCounterLayer(viewport);
        if (!oldNumber) {
            renderInstant(nextValue);
            flushPending();
            return;
        }

        state.locked = true;
        const direction = nextValue > state.value ? 'up' : 'down';
        const from = direction === 'up' ? '100%' : '-100%';
        const to = direction === 'up' ? '-100%' : '100%';

        const newNumber = document.createElement('span');
        newNumber.className = 'qaap-counter-push-number qaap-mod-entering';
        newNumber.textContent = state.format(nextValue);
        newNumber.style.transform = `translate3d(0, ${from}, 0)`;
        oldNumber.classList.add('qaap-mod-exiting');
        oldNumber.style.transform = 'translate3d(0, 0, 0)';
        viewport.append(newNumber);

        const scheduleFrame = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (callback: FrameRequestCallback): number => window.setTimeout(() => callback(Date.now()), 0);

        scheduleFrame(() => {
            oldNumber.style.transform = `translate3d(0, ${to}, 0)`;
            newNumber.style.transform = 'translate3d(0, 0, 0)';
        });

        const finish = (): void => {
            if (!state.locked) {
                return;
            }
            oldNumber.remove();
            newNumber.classList.remove('qaap-mod-entering');
            newNumber.removeAttribute('style');
            state.value = nextValue;
            state.locked = false;
            flushPending();
        };

        newNumber.addEventListener('transitionend', event => {
            if (event.propertyName !== 'transform') {
                return;
            }
            finish();
        }, { once: true });
        window.setTimeout(finish, QAAP_COUNTER_PUSH_TRANSITION_MS + 64);
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

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
}

const counterPushHandles = new WeakMap<HTMLElement, QaapCounterPushHandle>();

export function resolveQaapCounterPushHandle(host: HTMLElement): QaapCounterPushHandle | undefined {
    return counterPushHandles.get(host);
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
    };

    const renderInstant = (nextValue: number): void => {
        state.value = nextValue;
        const layer = viewport.querySelector('.qaap-counter-push-number');
        if (layer instanceof HTMLElement) {
            layer.textContent = options.format(nextValue);
            layer.style.transform = '';
        }
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

        const oldNumber = viewport.querySelector('.qaap-counter-push-number');
        if (!(oldNumber instanceof HTMLElement)) {
            renderInstant(nextValue);
            flushPending();
            return;
        }

        state.locked = true;
        const direction = nextValue > state.value ? 'up' : 'down';
        const from = direction === 'up' ? '100%' : '-100%';
        const to = direction === 'up' ? '-100%' : '100%';

        const newNumber = document.createElement('span');
        newNumber.className = 'qaap-counter-push-number qaap-mod-layer';
        newNumber.textContent = options.format(nextValue);
        newNumber.style.transform = `translateY(${from})`;
        oldNumber.style.transform = 'translateY(0)';
        viewport.append(newNumber);

        const scheduleFrame = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame
            : (callback: FrameRequestCallback): number => window.setTimeout(() => callback(Date.now()), 0);

        scheduleFrame(() => {
            oldNumber.style.transform = `translateY(${to})`;
            newNumber.style.transform = 'translateY(0)';
        });

        const finish = (): void => {
            oldNumber.remove();
            newNumber.classList.remove('qaap-mod-layer');
            newNumber.removeAttribute('style');
            state.value = nextValue;
            state.locked = false;
            flushPending();
        };

        newNumber.addEventListener('transitionend', finish, { once: true });
        window.setTimeout(finish, QAAP_COUNTER_PUSH_TRANSITION_MS + 48);
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

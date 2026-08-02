// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as React from '@theia/core/shared/react';
import { createRoot, type Root } from '@theia/core/shared/react-dom/client';
import { ThinkingOrb, type OrbSize, type OrbState, type OrbTheme } from 'thinking-orbs';
import {
    resolveThinkingOrbPaused,
    resolveThinkingOrbStateFromActivity,
    type QaapThinkingOrbState,
    type ResolveThinkingOrbPhaseOptions,
} from '../common/qaap-thinking-orb-phase';

/** Host class for React-mounted ThinkingOrb indicators in DOM UIs. */
export const QAAP_THINKING_ORB_INDICATOR_CLASS = 'qaap-thinking-orb-indicator';

/** Compact inline preset from `thinking-orbs` (header / stream row). */
export const QAAP_THINKING_ORB_COMPACT_SIZE: OrbSize = 20;

/** Chat-avatar preset — reserved for larger surfaces. */
export const QAAP_THINKING_ORB_AVATAR_SIZE: OrbSize = 64;

export interface ThinkingOrbIndicatorOptions extends ResolveThinkingOrbPhaseOptions {
    /** Explicit orb state; wins over phase derivation when set. */
    readonly state?: QaapThinkingOrbState | OrbState;
    readonly size?: OrbSize;
    readonly speed?: number;
    readonly paused?: boolean;
    readonly theme?: OrbTheme;
    readonly className?: string;
}

interface MountRecord {
    root: Root;
    signature: string;
    disconnectObserver?: MutationObserver;
}

const mounts = new WeakMap<HTMLElement, MountRecord>();

const rootFinalizers: FinalizationRegistry<Root> | undefined =
    typeof FinalizationRegistry !== 'undefined'
        ? new FinalizationRegistry((root: Root) => {
            try {
                root.unmount();
            } catch {
                // Host already gone — ignore.
            }
        })
        : undefined;

/** Creates a host span and mounts a ThinkingOrb into it. */
export function createThinkingOrbIndicator(options: ThinkingOrbIndicatorOptions = {}): HTMLElement {
    const host = document.createElement('span');
    host.className = QAAP_THINKING_ORB_INDICATOR_CLASS;
    if (options.className) {
        for (const token of options.className.split(/\s+/)) {
            if (token) {
                host.classList.add(token);
            }
        }
    }
    host.setAttribute('aria-hidden', 'true');
    syncThinkingOrbIndicator(host, options);
    return host;
}

/** (Re)renders the orb inside an existing host. No-op when props are unchanged. */
export function syncThinkingOrbIndicator(host: HTMLElement, options: ThinkingOrbIndicatorOptions = {}): void {
    const resolved = resolveIndicatorProps(options);
    const signature = [
        resolved.state,
        resolved.size,
        resolved.speed,
        resolved.paused ? '1' : '0',
        resolved.theme,
    ].join('\u001f');

    let record = mounts.get(host);
    if (!record) {
        const root = createRoot(host);
        record = { root, signature: '' };
        mounts.set(host, record);
        rootFinalizers?.register(host, root);
        watchHostDisconnect(host, record);
    }
    if (record.signature === signature) {
        return;
    }
    record.signature = signature;
    // jsdom (unit tests) does not implement canvas 2d — keep an empty host there.
    if (!canPaintOrbCanvas()) {
        record.root.render(<span className="qaap-thinking-orb-indicator-fallback" data-orb-state={resolved.state} />);
        return;
    }
    record.root.render(
        <ThinkingOrb
            state={resolved.state}
            size={resolved.size}
            speed={resolved.speed}
            paused={resolved.paused}
            theme={resolved.theme}
        />,
    );
}

/** Unmounts the React root for a host (safe to call repeatedly). */
export function destroyThinkingOrbIndicator(host: HTMLElement | null | undefined): void {
    if (!host) {
        return;
    }
    const record = mounts.get(host);
    if (!record) {
        return;
    }
    record.disconnectObserver?.disconnect();
    try {
        record.root.unmount();
    } catch {
        // Already unmounted.
    }
    mounts.delete(host);
    rootFinalizers?.unregister(host);
}

function resolveIndicatorProps(options: ThinkingOrbIndicatorOptions): {
    state: OrbState;
    size: OrbSize;
    speed: number;
    paused: boolean;
    theme: OrbTheme;
} {
    const state = (options.state ?? resolveThinkingOrbStateFromActivity(options)) as OrbState;
    return {
        state,
        size: options.size ?? QAAP_THINKING_ORB_COMPACT_SIZE,
        speed: options.speed ?? 1.25,
        paused: options.paused ?? resolveThinkingOrbPaused(options),
        theme: options.theme ?? resolveTheiaOrbTheme(),
    };
}

/** Theia uses `qaap-theme-*` / `data-theia-theme-mode`, not `data-theme`. */
export function resolveTheiaOrbTheme(): OrbTheme {
    const body = typeof document !== 'undefined' ? document.body : undefined;
    if (!body) {
        return 'auto';
    }
    const mode = body.getAttribute('data-theia-theme-mode');
    if (mode === 'light' || body.classList.contains('qaap-theme-light')) {
        return 'light';
    }
    if (mode === 'dark' || body.classList.contains('qaap-theme-dark')) {
        return 'dark';
    }
    return 'auto';
}

function canPaintOrbCanvas(): boolean {
    if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') {
        return false;
    }
    // Theia `enableJSDOM()` / Node test harnesses — calling getContext is noisy and useless.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/jsdom|node\.js|^Node\.js\//i.test(ua)) {
        return false;
    }
    try {
        const probe = document.createElement('canvas');
        return !!probe.getContext?.('2d');
    } catch {
        return false;
    }
}

function scheduleAttach(callback: () => void): void {
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(callback);
        return;
    }
    setTimeout(callback, 0);
}

/** ~2s of frames; late-attached hosts fall back to the FinalizationRegistry cleanup. */
const WATCH_ATTACH_MAX_ATTEMPTS = 120;

function watchHostDisconnect(host: HTMLElement, record: MountRecord): void {
    let attempts = 0;
    const attach = (): void => {
        // Stop when the record was destroyed/replaced, or the host was never inserted — an
        // unbounded rAF retry spins one frame forever (and overflows with synchronous rAF shims).
        if (mounts.get(host) !== record || attempts++ >= WATCH_ATTACH_MAX_ATTEMPTS) {
            return;
        }
        const parent = host.parentNode;
        if (!parent) {
            scheduleAttach(attach);
            return;
        }
        if (typeof MutationObserver !== 'function') {
            return;
        }
        const observer = new MutationObserver(() => {
            if (!host.isConnected) {
                destroyThinkingOrbIndicator(host);
            }
        });
        observer.observe(parent, { childList: true });
        record.disconnectObserver = observer;
    };
    attach();
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { JsonRpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

/** Electron main <-> renderer JSON-RPC channel for native WebContentsView browser tabs. */
export const QAAP_NATIVE_BROWSER_SERVICE_PATH = '/services/qaap-native-browser';

export const QaapNativeBrowserService = Symbol('QaapNativeBrowserService');

export interface QaapNativeBrowserBounds {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface QaapNativeBrowserStateEvent {
    readonly viewId: string;
    readonly url: string;
    readonly title?: string;
    readonly loading: boolean;
    readonly canGoBack: boolean;
    readonly canGoForward: boolean;
    readonly focused?: boolean;
    readonly error?: {
        readonly code: number;
        readonly description: string;
        readonly url: string;
    };
}

export interface QaapNativeBrowserEnsureOptions {
    readonly viewId: string;
    /** Renderer `webContents.id` so multi-window Electron attaches the view to the right window. */
    readonly ownerWebContentsId?: number;
    readonly url?: string;
    /** Shell origin of the owning Qaap window, used to block recursive self-framing. */
    readonly shellOrigin?: string;
}

export interface QaapNativeBrowserClient {
    onStateChanged(event: QaapNativeBrowserStateEvent): void;
}

export interface QaapNativeBrowserService extends JsonRpcServer<QaapNativeBrowserClient> {
    ensureView(options: QaapNativeBrowserEnsureOptions): Promise<QaapNativeBrowserStateEvent>;
    navigate(viewId: string, url: string, options?: { readonly hard?: boolean }): Promise<void>;
    setBounds(viewId: string, bounds: QaapNativeBrowserBounds, visible: boolean): Promise<void>;
    goBack(viewId: string): Promise<void>;
    goForward(viewId: string): Promise<void>;
    reload(viewId: string, hard?: boolean): Promise<void>;
    focus(viewId: string): Promise<void>;
    openDevTools(viewId: string): Promise<void>;
    destroyView(viewId: string): Promise<void>;
    destroyAllForOwner(ownerWebContentsId?: number): Promise<void>;
}

/** Minimum dimension (CSS px) required before showing a native WebContentsView. */
export const QAAP_NATIVE_BROWSER_MIN_VISIBLE_PX = 10;

/**
 * Only `http:` and `https:` URLs may load in a native browser view, and the Qaap IDE shell
 * origin itself is blocked unless addressing a `/qaap-preview/` or `/qaap-dev/` proxy path.
 */
export function isAllowedQaapNativeBrowserUrl(url: string, shellOrigin?: string): boolean {
    const trimmed = url.trim();
    if (!trimmed) {
        return false;
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
    }
    if (shellOrigin) {
        try {
            const shell = new URL(shellOrigin);
            if (parsed.origin === shell.origin) {
                return parsed.pathname.startsWith('/qaap-preview/')
                    || parsed.pathname.startsWith('/qaap-dev/');
            }
        } catch {
            // Ignore malformed shellOrigin; scheme check above already passed.
        }
    }
    return true;
}

/** Rounds and clamps bounds to non-negative integers acceptable to Electron `View.setBounds`. */
export function sanitizeQaapNativeBrowserBounds(bounds: QaapNativeBrowserBounds): QaapNativeBrowserBounds {
    const x = Number.isFinite(bounds.x) ? Math.max(0, Math.round(bounds.x)) : 0;
    const y = Number.isFinite(bounds.y) ? Math.max(0, Math.round(bounds.y)) : 0;
    const width = Number.isFinite(bounds.width) ? Math.max(0, Math.round(bounds.width)) : 0;
    const height = Number.isFinite(bounds.height) ? Math.max(0, Math.round(bounds.height)) : 0;
    return { x, y, width, height };
}

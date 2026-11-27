// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { Disposable } from '@theia/core/lib/common/disposable';
import type {
    QaapNativeBrowserBounds,
    QaapNativeBrowserStateEvent,
} from '../common/qaap-native-browser-protocol';

/**
 * Renderer-side bridge to Electron's native `WebContentsView` manager.
 * Registered only in the Electron desktop bundle (`@theia/qaap-product/lib/electron-browser`);
 * remains `undefined` on web/mobile builds so preview chrome falls back seamlessly to `<iframe>`.
 */
export interface QaapNativeBrowserBridge {
    ensureView(viewId: string, url?: string): Promise<QaapNativeBrowserStateEvent>;
    navigate(viewId: string, url: string, options?: { readonly hard?: boolean }): Promise<void>;
    setBounds(viewId: string, bounds: QaapNativeBrowserBounds, visible: boolean): Promise<void>;
    goBack(viewId: string): Promise<void>;
    goForward(viewId: string): Promise<void>;
    reload(viewId: string, hard?: boolean): Promise<void>;
    focus(viewId: string): Promise<void>;
    openDevTools(viewId: string): Promise<void>;
    destroyView(viewId: string): Promise<void>;
    subscribe(viewId: string, listener: (event: QaapNativeBrowserStateEvent) => void): Disposable;
}

let activeNativeBrowserBridge: QaapNativeBrowserBridge | undefined;

export function registerQaapNativeBrowserBridge(bridge: QaapNativeBrowserBridge | undefined): Disposable {
    activeNativeBrowserBridge = bridge;
    return {
        dispose: () => {
            if (activeNativeBrowserBridge === bridge) {
                activeNativeBrowserBridge = undefined;
            }
        },
    };
}

export function getQaapNativeBrowserBridge(): QaapNativeBrowserBridge | undefined {
    return activeNativeBrowserBridge;
}

/**
 * Selectors for renderer overlays (menus, popovers, dialogs, bottom sheets, command palettes)
 * that must paint above the browser slot. Because an Electron `WebContentsView` composites on top
 * of renderer DOM, we hide the native view whenever one of these overlaps the slot rectangle.
 */
const OVERLAY_SELECTORS = [
    '[role="dialog"]:not([hidden])',
    '[role="alertdialog"]:not([hidden])',
    '[role="menu"]:not([hidden])',
    '[role="listbox"]:not([hidden])',
    '.qaap-preview-history-popover:not([hidden])',
    '.qaap-preview-edit-menu:not([hidden])',
    '.qaap-agent-preview-overflow-menu:not([hidden])',
    '.qaap-work-hub-aux-panel-menu:not([hidden])',
    '.theia-mobile-sheet:not([hidden])',
    '.theia-mobile-projects-sheet:not([hidden])',
    '.theia-mobile-backdrop:not([hidden])',
    '.qaap-modal-backdrop:not([hidden])',
    '.qaap-popover:not([hidden])',
    '.p-Menu',
    '.lm-Menu',
    '.monaco-menu-container',
    '.quick-input-widget',
    '.theia-dialog-shell',
].join(', ');

export interface SimpleRect {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly width: number;
    readonly height: number;
}

export function rectsOverlap(a: SimpleRect, b: SimpleRect): boolean {
    if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) {
        return false;
    }
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** True when `element` is connected and not hidden by `hidden`, `display: none`, or `visibility: hidden`. */
export function isPreviewElementVisible(element: HTMLElement): boolean {
    if (!element.isConnected) {
        return false;
    }
    let current: HTMLElement | null = element;
    while (current) {
        if (current.hidden) {
            return false;
        }
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            const style = window.getComputedStyle(current);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                return false;
            }
        }
        current = current.parentElement;
    }
    return true;
}

/**
 * True when any open renderer overlay (dialog, popover, dropdown, sheet, context menu) visually
 * intersects `slotRect`, so the native `WebContentsView` should hide until the overlay closes.
 */
export function isPreviewSlotOccludedByOverlay(slotRect: SimpleRect, doc: Document = document, excludeContainer?: HTMLElement): boolean {
    if (slotRect.width <= 0 || slotRect.height <= 0) {
        return false;
    }
    const candidates = doc.querySelectorAll<HTMLElement>(OVERLAY_SELECTORS);
    for (const candidate of candidates) {
        if (excludeContainer && candidate === excludeContainer) {
            continue;
        }
        if (!isPreviewElementVisible(candidate)) {
            continue;
        }
        const rect = candidate.getBoundingClientRect();
        if (rectsOverlap(slotRect, rect)) {
            return true;
        }
    }
    return false;
}

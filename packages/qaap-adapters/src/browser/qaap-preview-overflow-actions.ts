// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { MessageService } from '@theia/core/lib/common/message-service';

export type QaapPreviewOverflowActionId =
    | 'take-screenshot'
    | 'reload'
    | 'hard-reload'
    | 'copy-url'
    | 'bookmark-bar'
    | 'clear-history'
    | 'clear-cookies'
    | 'clear-cache'
    | 'open-external';

export const QAAP_PREVIEW_OVERFLOW_MENU_Z_INDEX = '2147483025';

export interface QaapPreviewOverflowActionContext {
    readonly getFrame: () => HTMLIFrameElement | undefined;
    readonly getCurrentUrl: () => string;
    readonly reload: () => void;
    readonly hardReload: () => void;
    readonly openExternal: () => void;
    readonly copyCurrentUrl: () => Promise<void>;
    readonly clipboard?: ClipboardService;
    readonly messageService?: MessageService;
    /** Optional toast (e.g. mobile snackbar) in addition to MessageService. */
    readonly notify?: (message: string, kind?: 'info' | 'warn') => void;
    readonly bookmarkBarVisible: () => boolean;
    readonly toggleBookmarkBar: () => void;
    readonly clearHistory: () => void;
}

export function previewNotify(ctx: Pick<QaapPreviewOverflowActionContext, 'messageService' | 'notify'>, message: string, kind: 'info' | 'warn' = 'info'): void {
    if (kind === 'warn') {
        ctx.messageService?.warn(message);
    } else {
        ctx.messageService?.info(message);
    }
    ctx.notify?.(message, kind);
}

export interface QaapPreviewOverflowMenuItem {
    readonly id: QaapPreviewOverflowActionId;
    readonly label: string;
    readonly toggle?: boolean;
    readonly checked?: boolean;
}

export interface QaapPreviewCaptureLimits {
    readonly maxWidth?: number;
    readonly maxHeight?: number;
}

export interface QaapPreviewCaptureDimensions {
    readonly width: number;
    readonly height: number;
}

export const QAAP_PREVIEW_CAPTURE_DEFAULT_MAX_WIDTH = 1600;
export const QAAP_PREVIEW_CAPTURE_DEFAULT_MAX_HEIGHT = 2400;
export const QAAP_PREVIEW_CAPTURE_MAX_DOM_ELEMENTS = 5000;
const QAAP_PREVIEW_CAPTURE_HARD_MAX_WIDTH = 4096;
const QAAP_PREVIEW_CAPTURE_HARD_MAX_HEIGHT = 8192;
const QAAP_PREVIEW_CAPTURE_HARD_MAX_PIXELS = 8_000_000;
const QAAP_PREVIEW_CAPTURE_MAX_SERIALIZED_CHARACTERS = 4 * 1024 * 1024;

/** Prevent simultaneous DOM cloning/canvas allocation across preview surfaces. */
export class QaapPreviewCaptureGuard {
    protected active = false;

    async run<T>(capture: () => Promise<T>): Promise<T | undefined> {
        if (this.active) {
            return undefined;
        }
        this.active = true;
        try {
            return await capture();
        } finally {
            this.active = false;
        }
    }
}

const previewCaptureGuard = new QaapPreviewCaptureGuard();

export function resolvePreviewCaptureDimensions(
    naturalWidth: number,
    naturalHeight: number,
    limits: QaapPreviewCaptureLimits = {},
): QaapPreviewCaptureDimensions {
    const maxWidth = normalizePreviewCaptureLimit(
        limits.maxWidth,
        QAAP_PREVIEW_CAPTURE_DEFAULT_MAX_WIDTH,
        QAAP_PREVIEW_CAPTURE_HARD_MAX_WIDTH,
    );
    const maxHeight = normalizePreviewCaptureLimit(
        limits.maxHeight,
        QAAP_PREVIEW_CAPTURE_DEFAULT_MAX_HEIGHT,
        QAAP_PREVIEW_CAPTURE_HARD_MAX_HEIGHT,
    );
    let width = Math.min(normalizePreviewCaptureSize(naturalWidth), maxWidth);
    let height = Math.min(normalizePreviewCaptureSize(naturalHeight), maxHeight);
    const pixels = width * height;
    if (pixels > QAAP_PREVIEW_CAPTURE_HARD_MAX_PIXELS) {
        const scale = Math.sqrt(QAAP_PREVIEW_CAPTURE_HARD_MAX_PIXELS / pixels);
        width = Math.max(1, Math.floor(width * scale));
        height = Math.max(1, Math.floor(height * scale));
    }
    return { width, height };
}

function normalizePreviewCaptureLimit(value: number | undefined, fallback: number, hardMaximum: number): number {
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
        return fallback;
    }
    return Math.min(Math.floor(value), hardMaximum);
}

function normalizePreviewCaptureSize(value: number): number {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

export function buildPreviewOverflowMenuItems(ctx: Pick<QaapPreviewOverflowActionContext, 'bookmarkBarVisible'>): QaapPreviewOverflowMenuItem[] {
    const bookmarkVisible = ctx.bookmarkBarVisible();
    return [
        {
            id: 'take-screenshot',
            label: nls.localize('qaap/preview/takeScreenshot', 'Take Screenshot'),
        },
        {
            id: 'hard-reload',
            label: nls.localize('qaap/preview/hardReload', 'Hard Reload'),
        },
        {
            id: 'copy-url',
            label: nls.localize('qaap/preview/copyUrl', 'Copy Current URL'),
        },
        {
            id: 'bookmark-bar',
            label: bookmarkVisible
                ? nls.localize('qaap/preview/hideBookmarkBar', 'Hide Bookmark Bar')
                : nls.localize('qaap/preview/showBookmarkBar', 'Show Bookmark Bar'),
            toggle: true,
            checked: bookmarkVisible,
        },
        {
            id: 'clear-history',
            label: nls.localize('qaap/preview/clearHistory', 'Clear Browsing History'),
        },
        {
            id: 'clear-cookies',
            label: nls.localize('qaap/preview/clearCookies', 'Clear Cookies'),
        },
        {
            id: 'clear-cache',
            label: nls.localize('qaap/preview/clearCache', 'Clear Cache'),
        },
    ];
}

export async function runPreviewOverflowAction(
    id: QaapPreviewOverflowActionId,
    ctx: QaapPreviewOverflowActionContext,
): Promise<void> {
    switch (id) {
        case 'take-screenshot':
            await runPreviewTakeScreenshot(ctx);
            return;
        case 'reload':
            ctx.reload();
            previewNotify(ctx, nls.localize('qaap/preview/reloaded', 'Preview reloaded'));
            return;
        case 'hard-reload':
            ctx.hardReload();
            previewNotify(ctx, nls.localize('qaap/preview/hardReloaded', 'Preview hard reloaded'));
            return;
        case 'copy-url':
            await runPreviewCopyCurrentUrl(ctx);
            return;
        case 'open-external':
            ctx.openExternal();
            return;
        case 'bookmark-bar':
            ctx.toggleBookmarkBar();
            return;
        case 'clear-history':
            ctx.clearHistory();
            return;
        case 'clear-cookies':
            clearSameOriginPreviewCookies(ctx);
            return;
        case 'clear-cache':
            await clearSameOriginPreviewCache(ctx);
            return;
    }
}

export interface MountPreviewOverflowMenuOptions {
    readonly anchor: HTMLElement;
    readonly bookmarkBarVisible: () => boolean;
    readonly getContext: () => QaapPreviewOverflowActionContext;
    readonly onClose: () => void;
}

/** Portal overflow menu to `document.body` with per-item click handlers (mobile-safe). */
export function mountPreviewOverflowMenu(options: MountPreviewOverflowMenuOptions): { menu: HTMLElement; dispose: () => void } {
    const menu = document.createElement('div');
    menu.className = 'qaap-agent-preview-overflow-menu';
    menu.setAttribute('role', 'menu');

    const items = buildPreviewOverflowMenuItems({ bookmarkBarVisible: options.bookmarkBarVisible });
    for (const item of items) {
        menu.append(createPreviewOverflowMenuRow(item));
    }

    const activate = (actionId: QaapPreviewOverflowActionId): void => {
        void runPreviewOverflowAction(actionId, options.getContext()).catch(() => {
            previewNotify(
                options.getContext(),
                nls.localize('qaap/preview/actionFailed', 'Could not run that action'),
                'warn',
            );
        });
        options.onClose();
    };

    for (const row of menu.querySelectorAll<HTMLButtonElement>('[data-action]')) {
        const actionId = row.getAttribute('data-action') as QaapPreviewOverflowActionId | null;
        if (!actionId) {
            continue;
        }
        const onActivate = (e: Event): void => {
            e.preventDefault();
            e.stopPropagation();
            activate(actionId);
        };
        row.addEventListener('click', onActivate);
        row.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
                onActivate(e);
            }
        });
    }

    document.body.append(menu);
    positionPreviewOverflowMenu(menu, options.anchor);
    menu.style.zIndex = QAAP_PREVIEW_OVERFLOW_MENU_Z_INDEX;

    const closeOnOutside = (e: MouseEvent): void => {
        const target = e.target as Node;
        if (menu.contains(target) || options.anchor.contains(target)) {
            return;
        }
        options.onClose();
    };

    const dispose = (): void => {
        document.removeEventListener('click', closeOnOutside, true);
        menu.remove();
    };

    requestAnimationFrame(() => document.addEventListener('click', closeOnOutside, true));

    return { menu, dispose };
}

function createPreviewOverflowMenuRow(item: QaapPreviewOverflowMenuItem): HTMLButtonElement {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'qaap-agent-preview-overflow-item';
    row.setAttribute('role', 'menuitem');
    row.setAttribute('data-action', item.id);
    if (item.toggle) {
        row.classList.add('qaap-agent-preview-overflow-toggle');
        row.setAttribute('aria-checked', item.checked ? 'true' : 'false');
        const label = document.createElement('span');
        label.className = 'qaap-agent-preview-overflow-item-label';
        label.textContent = item.label;
        const toggle = document.createElement('span');
        toggle.className = 'qaap-agent-preview-overflow-toggle-switch';
        toggle.setAttribute('aria-hidden', 'true');
        row.append(label, toggle);
    } else {
        row.textContent = item.label;
    }
    return row;
}

function positionPreviewOverflowMenu(menu: HTMLElement, anchor: HTMLElement): void {
    const margin = 8;
    const gap = 4;
    const anchorRect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.visibility = 'hidden';
    menu.style.pointerEvents = 'auto';
    const menuHeight = menu.offsetHeight || 1;
    let top = anchorRect.bottom + gap;
    const maxBottom = window.innerHeight - margin;
    if (top + menuHeight > maxBottom) {
        const aboveTop = anchorRect.top - gap - menuHeight;
        top = aboveTop >= margin ? aboveTop : Math.max(margin, maxBottom - menuHeight);
    }
    let right = window.innerWidth - anchorRect.right;
    right = Math.max(margin, right);
    menu.style.top = `${top}px`;
    menu.style.right = `${right}px`;
    menu.style.left = 'auto';
    menu.style.visibility = '';
}

async function runPreviewCopyCurrentUrl(ctx: QaapPreviewOverflowActionContext): Promise<void> {
    const url = ctx.getCurrentUrl().trim();
    if (!url) {
        previewNotify(ctx, nls.localize('qaap/preview/noUrlToCopy', 'No URL to copy'), 'warn');
        return;
    }
    try {
        if (ctx.clipboard) {
            await ctx.clipboard.writeText(url);
        } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
        } else {
            throw new Error('clipboard unavailable');
        }
        previewNotify(ctx, nls.localize('qaap/preview/urlCopied', 'URL copied to clipboard'));
    } catch {
        previewNotify(ctx, nls.localize('qaap/preview/urlCopyFailed', 'Could not copy URL to clipboard'), 'warn');
    }
}

export async function captureSameOriginPreview(
    doc: Document,
    frame: HTMLIFrameElement,
    limits?: QaapPreviewCaptureLimits,
): Promise<Blob | undefined> {
    return previewCaptureGuard.run(() => captureSameOriginPreviewUnlocked(doc, frame, limits));
}

async function captureSameOriginPreviewUnlocked(
    doc: Document,
    frame: HTMLIFrameElement,
    limits?: QaapPreviewCaptureLimits,
): Promise<Blob | undefined> {
    if (doc.documentElement.querySelectorAll('*').length + 1 > QAAP_PREVIEW_CAPTURE_MAX_DOM_ELEMENTS) {
        return undefined;
    }
    const naturalWidth = Math.max(doc.documentElement.scrollWidth, doc.documentElement.clientWidth, frame.clientWidth, 1);
    const naturalHeight = Math.max(doc.documentElement.scrollHeight, doc.documentElement.clientHeight, frame.clientHeight, 1);
    const { width, height } = resolvePreviewCaptureDimensions(naturalWidth, naturalHeight, limits);
    const captureRoot = clonePreviewDocumentWithComputedStyles(doc);
    const serializedCaptureRoot = new XMLSerializer().serializeToString(captureRoot);
    if (serializedCaptureRoot.length > QAAP_PREVIEW_CAPTURE_MAX_SERIALIZED_CHARACTERS) {
        return undefined;
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return undefined;
    }
    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject width="100%" height="100%">
    ${serializedCaptureRoot}
  </foreignObject>
</svg>`;
    const img = new Image();
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('svg render failed'));
        img.src = url;
    });
    ctx.drawImage(img, 0, 0);
    return new Promise<Blob | undefined>(resolve => {
        canvas.toBlob(blob => resolve(blob ?? undefined), 'image/png');
    });
}

const CAPTURE_COMPUTED_STYLE_PROPERTIES = [
    'position', 'display', 'visibility', 'box-sizing',
    'top', 'right', 'bottom', 'left', 'inset', 'z-index',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border', 'border-width', 'border-style', 'border-color', 'border-radius',
    'background', 'background-color', 'background-image', 'background-size', 'background-position',
    'color', 'opacity', 'box-shadow', 'filter',
    'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'line-height',
    'letter-spacing', 'text-align', 'text-decoration', 'text-transform', 'white-space',
    'overflow', 'overflow-x', 'overflow-y', 'object-fit',
    'flex', 'flex-basis', 'flex-direction', 'flex-grow', 'flex-shrink', 'flex-wrap',
    'align-content', 'align-items', 'align-self', 'justify-content', 'justify-items', 'justify-self',
    'grid', 'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
    'gap', 'column-gap', 'row-gap', 'place-content', 'place-items', 'place-self',
    'transform', 'transform-origin', 'vertical-align', 'list-style',
] as const;

/** ForeignObject does not reliably retain linked/cascaded CSS, so freeze computed styles inline. */
export function clonePreviewDocumentWithComputedStyles(doc: Document): HTMLElement {
    const clone = doc.documentElement.cloneNode(true) as HTMLElement;
    const originals = [doc.documentElement, ...doc.documentElement.querySelectorAll<HTMLElement>('*')];
    const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
    const view = doc.defaultView;
    if (!view) {
        return clone;
    }
    for (let index = 0; index < Math.min(originals.length, copies.length); index++) {
        const original = originals[index];
        const copy = copies[index];
        if (!(original instanceof view.HTMLElement)) {
            continue;
        }
        const computed = view.getComputedStyle(original);
        const frozen = CAPTURE_COMPUTED_STYLE_PROPERTIES
            .map(property => {
                const value = computed.getPropertyValue(property);
                return value ? `${property}:${value}` : '';
            })
            .filter(Boolean)
            .join(';');
        if (frozen) {
            copy.setAttribute('style', frozen);
        }
        if (original instanceof view.HTMLInputElement || original instanceof view.HTMLTextAreaElement) {
            copy.setAttribute('value', original.value);
        }
    }
    return clone;
}

/** Copy a PNG blob to the system clipboard. Returns false when ClipboardItem/write is unavailable or blocked. */
export async function writePngBlobToClipboard(blob: Blob): Promise<boolean> {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        return false;
    }
    try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch {
        return false;
    }
}

export async function blobToBase64(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
    }
    return btoa(binary);
}

async function runPreviewTakeScreenshot(ctx: QaapPreviewOverflowActionContext): Promise<void> {
    const frame = ctx.getFrame();
    const doc = frame?.contentDocument;
    if (!frame || !doc?.body) {
        previewNotify(ctx, nls.localize(
            'qaap/preview/screenshotUnavailable',
            'Screenshots only work for same-origin previews. Open in browser to capture cross-origin pages.',
        ), 'warn');
        return;
    }
    try {
        const blob = await captureSameOriginPreview(doc, frame);
        if (!blob) {
            throw new Error('capture failed');
        }
        if (ctx.clipboard && typeof ClipboardItem !== 'undefined') {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            previewNotify(ctx, nls.localize('qaap/preview/screenshotCopied', 'Screenshot copied to clipboard'));
            return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'preview-screenshot.png';
        link.click();
        URL.revokeObjectURL(url);
        previewNotify(ctx, nls.localize('qaap/preview/screenshotDownloaded', 'Screenshot downloaded'));
    } catch {
        previewNotify(ctx, nls.localize(
            'qaap/preview/screenshotFailed',
            'Could not capture a screenshot for this page.',
        ), 'warn');
    }
}

function clearSameOriginPreviewCookies(ctx: QaapPreviewOverflowActionContext): void {
    try {
        const frame = ctx.getFrame();
        const doc = frame?.contentDocument;
        if (!doc) {
            throw new Error('cross-origin');
        }
        const cookies = doc.cookie.split(';');
        for (const chunk of cookies) {
            const name = chunk.split('=')[0]?.trim();
            if (!name) {
                continue;
            }
            const paths = ['/', window.location.pathname].filter(Boolean);
            for (const path of paths) {
                doc.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=${path}`;
            }
            doc.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
        }
        previewNotify(ctx, nls.localize('qaap/preview/cookiesCleared', 'Preview cookies cleared'));
        ctx.reload();
    } catch {
        previewNotify(ctx, nls.localize(
            'qaap/preview/cookiesUnavailable',
            'Cookies cannot be cleared for cross-origin previews.',
        ), 'warn');
    }
}

async function clearSameOriginPreviewCache(ctx: QaapPreviewOverflowActionContext): Promise<void> {
    const frame = ctx.getFrame();
    let cleared = false;
    try {
        const win = frame?.contentWindow;
        if (win && 'caches' in win) {
            const cacheStorage = (win as Window & { caches: CacheStorage }).caches;
            const keys = await cacheStorage.keys();
            await Promise.all(keys.map(key => cacheStorage.delete(key)));
            cleared = keys.length > 0;
        }
    } catch {
        /* cross-origin or unsupported */
    }
    ctx.hardReload();
    previewNotify(ctx, cleared
        ? nls.localize('qaap/preview/cacheCleared', 'Preview cache cleared')
        : nls.localize('qaap/preview/cacheReloaded', 'Preview reloaded (cache API unavailable for this page)'));
}

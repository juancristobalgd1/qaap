// *****************************************************************************
// Copyright (C) 2026 theia-ide and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '@theia/core/lib/common/disposable';
import { MOBILE_HORIZONTAL_SCROLL_SELECTOR } from './mobile-horizontal-touch-scroll';

/** Applied during active vertical touch pan to promote the scroll layer (see qaap-mobile-touch-scroll.css). */
export const MOBILE_SCROLL_GPU_COMPOSITOR_CLASS = 'theia-mod-touch-scrolling';

/**
 * Scroll hosts that must not receive compositor transform — sticky descendants
 * (e.g. Work Hub row heads) break when the scroller is promoted to its own layer.
 */
export const MOBILE_SCROLL_COMPOSITOR_EXCLUDED_SELECTORS = [
    '.theia-mobile-projects-scroll',
] as const;

export function isMobileScrollCompositorExcluded(element: HTMLElement): boolean {
    return MOBILE_SCROLL_COMPOSITOR_EXCLUDED_SELECTORS.some(selector => element.matches(selector));
}

/** Elements that must keep horizontal pan only (see qaap-mobile-touch-scroll.css). */
const HORIZONTAL_STRIP_SELECTOR =
    '.lm-TabBar-content-container, .lm-DockPanel-tabBar[data-orientation="horizontal"], ' +
    '.theia-mobile-bottom-activity-bar, #theia-statusBar, .theia-mobile-keyboard-accessory-page, ' +
    '.theia-statusBar-track';

const isInsideHorizontalScrollHost = (target: EventTarget | null): boolean =>
    target instanceof Element && !!target.closest(MOBILE_HORIZONTAL_SCROLL_SELECTOR);

/**
 * Scroll hosts that must always scroll natively, even on engines that get the JS
 * fallback. The agent transcript streams content continuously and runs its own
 * passive scroll controller (`qaap-transcript-scroll-controller.ts`); a
 * non-passive `touchmove` + manual `scrollTop` writes there stall scrolling
 * behind streaming work and kill momentum.
 */
export const MOBILE_VERTICAL_SCROLL_NATIVE_ONLY_SELECTORS = [
    '.theia-mobile-agent-transcript',
] as const;

let nativeNestedTouchScrollSupport: boolean | undefined;

/**
 * Whether nested `overflow-y: auto` hosts pan natively (with momentum and
 * compositor scrolling) under `html/body { overflow: hidden }`.
 *
 * The JS fallback exists for old WebKit (iOS < 16), where nested scroll under a
 * locked body could fail to engage once PerfectScrollbar had set
 * `overflow: hidden` on the host. `qaap-mobile-touch-scroll.css` now forces
 * native overflow + `touch-action: pan-y` + `overscroll-behavior-y: contain` on
 * every registered host; every engine that implements `overscroll-behavior`
 * (Chromium 63+, Firefox 59+, Safari/iOS 16+) scrolls those hosts natively, so
 * the fallback — which blocks the compositor with a non-passive `touchmove` —
 * is only installed where that feature is missing.
 */
export function supportsNativeNestedTouchScroll(): boolean {
    if (nativeNestedTouchScrollSupport === undefined) {
        nativeNestedTouchScrollSupport = typeof CSS !== 'undefined'
            && typeof CSS.supports === 'function'
            && CSS.supports('overscroll-behavior-y', 'contain');
    }
    return nativeNestedTouchScrollSupport;
}

/** Whether {@link installMobileVerticalTouchScroll} would attach JS touch handlers to `element`. */
export function needsMobileVerticalTouchScrollFallback(element: HTMLElement): boolean {
    if (supportsNativeNestedTouchScroll()) {
        return false;
    }
    return !MOBILE_VERTICAL_SCROLL_NATIVE_ONLY_SELECTORS.some(selector => element.matches(selector));
}

/**
 * Touch fallback for vertically scrollable regions on old iOS WebKit when nested
 * scroll under `body { overflow: hidden }` does not move natively. No-op on
 * engines with native nested touch scroll (see {@link supportsNativeNestedTouchScroll})
 * and on {@link MOBILE_VERTICAL_SCROLL_NATIVE_ONLY_SELECTORS}.
 */
export function installMobileVerticalTouchScroll(element: HTMLElement): Disposable {
    if (typeof window === 'undefined') {
        return Disposable.NULL;
    }
    if (!needsMobileVerticalTouchScrollFallback(element)) {
        return Disposable.NULL;
    }
    if (element.closest(HORIZONTAL_STRIP_SELECTOR)) {
        return Disposable.NULL;
    }
    if (element.dataset.theiaMobileScrollY === 'true') {
        return Disposable.NULL;
    }
    element.dataset.theiaMobileScrollY = 'true';

    let startX = 0;
    let startY = 0;
    let scrollTop = 0;
    let tracking = false;
    let axisLocked = false;
    let lockToVertical = false;
    const threshold = 6;

    const canScroll = (): boolean => element.scrollHeight > element.clientHeight + 1;

    const setCompositorScrolling = (active: boolean): void => {
        if (isMobileScrollCompositorExcluded(element)) {
            return;
        }
        element.classList.toggle(MOBILE_SCROLL_GPU_COMPOSITOR_CLASS, active);
    };

    const onTouchStart = (event: TouchEvent): void => {
        if (event.touches.length !== 1 || !canScroll() || isInsideHorizontalScrollHost(event.target)) {
            tracking = false;
            return;
        }
        tracking = true;
        startX = event.touches[0].pageX;
        startY = event.touches[0].pageY;
        scrollTop = element.scrollTop;
        axisLocked = false;
        lockToVertical = false;
        setCompositorScrolling(true);
    };

    const onTouchMove = (event: TouchEvent): void => {
        if (!tracking || event.touches.length !== 1 || !canScroll()) {
            return;
        }
        const dx = event.touches[0].pageX - startX;
        const dy = event.touches[0].pageY - startY;
        if (!axisLocked) {
            if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
                return;
            }
            axisLocked = true;
            lockToVertical = Math.abs(dy) >= Math.abs(dx);
        }
        if (!lockToVertical) {
            return;
        }
        if (event.cancelable) {
            event.preventDefault();
        }
        const max = element.scrollHeight - element.clientHeight;
        element.scrollTop = Math.max(0, Math.min(max, scrollTop - dy));
    };

    const stop = (): void => {
        tracking = false;
        axisLocked = false;
        lockToVertical = false;
        setCompositorScrolling(false);
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', stop, { passive: true });
    element.addEventListener('touchcancel', stop, { passive: true });

    return Disposable.create(() => {
        element.removeEventListener('touchstart', onTouchStart);
        element.removeEventListener('touchmove', onTouchMove);
        element.removeEventListener('touchend', stop);
        element.removeEventListener('touchcancel', stop);
        setCompositorScrolling(false);
        delete element.dataset.theiaMobileScrollY;
    });
}

/**
 * Vertical scroll hosts on mobile. Native overflow is enforced for all of them by
 * `qaap-mobile-touch-scroll.css`; the JS fallback is only installed on engines
 * without native nested touch scroll (see {@link supportsNativeNestedTouchScroll}).
 * Keep in sync with `qaap-mobile-touch-scroll.css` (overlay hosts are outside `#theia-app-shell`).
 */
export const MOBILE_VERTICAL_SCROLL_SELECTORS = [
    '.theia-Tree',
    '.theia-TreeContainer',
    '.treeContainer',
    '.body.ps',
    '.ps[tabindex]',
    '[data-virtuoso-scroller="true"]',
    '.xterm-viewport',
    '.chat-view-widget',
    '.chat-tree-view-widget .body',
    '.theia-mobile-projects-scroll',
    '.theia-mobile-work-hub-sessions-sidebar-scroll',
    '.theia-mobile-work-hub-sessions-sidebar-status-legend-list',
    '.theia-mobile-pr-stack',
    '.theia-mobile-pr-picker',
    '.theia-mobile-pr-quick-row',
    '.theia-mobile-onboarding-body',
    '.theia-mobile-bottom-actionsheet',
    '.theia-mobile-sticky-composer-sheet-list',
    '.qaap-chat-context-usage-sheet-body',
    '.theia-mobile-projects-sticky-composer-mention-popover',
    '.theia-mobile-projects-sticky-composer-plugin-picker-body',
    '.theia-mobile-mcp-attach-scroll',
    '.theia-mobile-skills-attach-scroll',
    '.theia-qaap-approval-policy-sheet-list',
    '.theia-mobile-sticky-composer-tools-host',
    '.theia-mobile-projects-sticky-composer-context-files.theia-mod-attachments',
    '.theia-mobile-sticky-composer-changed-files-list',
    '.theia-mobile-sticky-composer-activity-body',
    '.qaap-working-agents-detail-body',
    '.qaap-working-agents-detail-activity-feed',
    '.qaap-working-agents-detail-command-log-output',
    '.qaap-working-agents-popover-list',
    '.theia-mobile-sticky-composer-step-menu-list',
    '.theia-mobile-routine-sheet-form',
    '.theia-mobile-parallel-body',
    '.theia-mobile-parallel-model-menu-list',
    '.theia-mobile-transcript-checks-panel',
    '.theia-mobile-transcript-review-checks-body',
    '.theia-mobile-open-repo-list',
    '.theia-mobile-routine-sheet-panel',
    '.theia-mobile-agent-transcript',
    '.theia-mobile-agent-log-output',
    '.theia-mobile-work-hub-preferences-widget-host .preferences-editor-widget',
    '.theia-mobile-work-hub-preferences-embed .settings-main-scroll-container',
    '.theia-mobile-work-hub-preferences-embed .preferences-tree-widget',
    '.theia-mobile-work-hub-billing-scroll',
    '.theia-mobile-work-hub-ai-config-embed .ai-configuration-list',
    '.theia-mobile-work-hub-ai-config-embed .ai-configuration-detail',
    '.theia-mobile-work-hub-ai-config-embed .ai-configuration-table-container',
    '.theia-mobile-work-hub-ai-config-embed .mcp-configuration-container',
    '.theia-mobile-agent-activity-timeline:not(.theia-mod-cursor-trace) .theia-mobile-agent-activity-list.theia-mod-virtualized',
    '.theia-mobile-agent-activity-terminal-stack',
    '.theia-mobile-agent-activity-terminal-output',
    // Codex-style execution event timeline: terminal output card content is a
    // scroll host rendered inside the transcript overlay (outside #theia-app-shell),
    // so it needs the touch fallback to pan on iOS.
    '.theia-mobile-terminal-output-content',
    '.theia-mobile-agent-activity-read-stack',
    '.theia-mobile-agent-activity-edit-stack',
    '.theia-mobile-agent-activity-search-stack',
    '.theia-mobile-agent-activity-error-panel-message',
    '.theia-mobile-agent-activity-expand-body',
    '.theia-mobile-agent-activity-todo-panel',
    '.theia-mobile-agent-changed-files-mini-diff-lines',
    '.theia-mobile-transcript-verify',
    '.theia-mobile-transcript-checks-panel',
    '.theia-mobile-transcript-files-preview-body',
    '.theia-mobile-transcript-files-tree-scroll',
    '.qaap-agent-changes-scroll',
    '.qaap-diff-review-hunks',
    '.qaap-diff-review-files',
    '.theia-mobile-pr-diff',
    '.qaap-project-bootstrap-picker',
    '.qaap-lh-tool-args',
    // WorkflowCollapse semi level caps the detail panel at
    // min(40vh, 320px) while its children (args 240px + result 320px + gaps)
    // can exceed that, so the detail panel itself becomes the scroll host.
    '.qaap-lh-tool-detail[data-expand-level="semi"]',
    '.qaap-lh-tool-result pre',
    '.qaap-lh-tool-result .theia-toolCall-text-result',
    '.qaap-lh-tool-result .theia-toolCall-default-result',
    '.qaap-lh-tool-result .theia-toolCall-error-result',
    '.qaap-lh-thinking-content',
    // Workspace agent-hooks review dialog: the full command list scrolls inside the dialog.
    '.qaap-agent-hooks-review-list',
    '.gs-container',
    '.monaco-editor .overflow-guard',
] as const;

export const MOBILE_VERTICAL_SCROLL_SELECTOR = MOBILE_VERTICAL_SCROLL_SELECTORS.join(',');

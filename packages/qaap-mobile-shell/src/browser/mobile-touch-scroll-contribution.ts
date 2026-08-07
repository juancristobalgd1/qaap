// *****************************************************************************
// Copyright (C) 2026 theia-ide and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { MOBILE_NARROW_VIEWPORT_MEDIA_QUERY } from '@theia/core/lib/browser/shell/mobile-layout-state';
import {
    installMobileVerticalTouchScroll,
    MOBILE_VERTICAL_SCROLL_SELECTOR,
} from './mobile-vertical-touch-scroll';
import {
    installMobileHorizontalTouchScroll,
    MOBILE_HORIZONTAL_SCROLL_SELECTOR,
} from './mobile-horizontal-touch-scroll';

/**
 * Wires {@link installMobileVerticalTouchScroll} onto dynamically created scroll
 * hosts (file tree, AI chat, terminal viewport, output, …) on narrow / touch UIs.
 */
@injectable()
export class MobileTouchScrollContribution implements FrontendApplicationContribution {

    protected readonly toDispose = new DisposableCollection();
    protected readonly patchedVertical = new WeakSet<HTMLElement>();
    protected readonly patchedHorizontal = new WeakSet<HTMLElement>();
    protected scrollPatches = new DisposableCollection();
    protected observer: MutationObserver | undefined;
    protected mobileMq: MediaQueryList | undefined;
    protected coarseMq: MediaQueryList | undefined;
    protected active = false;

    onStart(_app: FrontendApplication): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.mobileMq = window.matchMedia(MOBILE_NARROW_VIEWPORT_MEDIA_QUERY);
        this.coarseMq = window.matchMedia('(pointer: coarse)');
        this.mobileMq.addEventListener('change', this.refresh);
        this.coarseMq.addEventListener('change', this.refresh);
        this.toDispose.push(
            Disposable.create(() => {
                this.mobileMq?.removeEventListener('change', this.refresh);
                this.coarseMq?.removeEventListener('change', this.refresh);
            }),
        );
        this.refresh();
    }

    onStop(_app: FrontendApplication): void {
        this.deactivate();
        this.toDispose.dispose();
    }

    protected readonly refresh = (): void => {
        const shouldActivate = !!this.mobileMq?.matches || !!this.coarseMq?.matches;
        if (shouldActivate && !this.active) {
            this.activate();
        } else if (!shouldActivate && this.active) {
            this.deactivate();
        }
    };

    protected activate(): void {
        if (typeof document === 'undefined' || this.active) {
            return;
        }
        this.active = true;
        this.scrollPatches = new DisposableCollection();
        // Observe `document.body` so overlays appended outside `#theia-app-shell`
        // (agent transcript sheets, parallel-run dialogs, …) receive the touch fallback.
        this.patchExisting(document.body);
        this.observer = new MutationObserver(mutations => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node instanceof HTMLElement) {
                        this.patchExisting(node);
                    }
                }
            }
        });
        this.observer.observe(document.body, { childList: true, subtree: true });
        // Clear stuck :focus / :hover on touch devices: after a tap, mobile browsers
        // keep the element in :focus and fire a synthetic :hover that persists until
        // the next touch elsewhere. Blurring non-input elements on touchend removes
        // both states, preventing the "stuck selected" visual.
        document.addEventListener('touchend', this.handleTouchEnd, { passive: true });
    }

    protected deactivate(): void {
        this.active = false;
        this.observer?.disconnect();
        this.observer = undefined;
        document.removeEventListener('touchend', this.handleTouchEnd);
        this.scrollPatches.dispose();
    }

    protected readonly handleTouchEnd = (e: TouchEvent): void => {
        const active = document.activeElement;
        if (!active || active === document.body) {
            return;
        }
        // Never blur inputs, textareas, or contenteditable elements — the user
        // needs focus to keep typing.
        const tag = active.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (active as HTMLElement).isContentEditable) {
            return;
        }
        // Tapping the active element again should not steal its focus before the
        // click handler fires. Defer the blur so the click can run, then clear the
        // stale focus state unless another control has taken focus in the meantime.
        const target = e.target as Node | null;
        if (target && active.contains(target)) {
            const activeElement = active as HTMLElement;
            window.setTimeout(() => {
                if (document.activeElement === activeElement) {
                    activeElement.blur();
                }
            }, 0);
            return;
        }
        (active as HTMLElement).blur();
    };

    protected patchExisting(root: ParentNode): void {
        // Only patch known scroll hosts. Do not call patchElement on every inserted node — otherwise
        // controls such as the inline mic toggle get touch-scroll handlers and break taps on iOS.
        if (root instanceof HTMLElement && root.matches(MOBILE_VERTICAL_SCROLL_SELECTOR)) {
            this.patchElement(root);
        }
        root.querySelectorAll<HTMLElement>(MOBILE_VERTICAL_SCROLL_SELECTOR).forEach(el => this.patchElement(el));
        if (root instanceof HTMLElement && root.matches(MOBILE_HORIZONTAL_SCROLL_SELECTOR)) {
            this.patchHorizontalElement(root);
        }
        root.querySelectorAll<HTMLElement>(MOBILE_HORIZONTAL_SCROLL_SELECTOR).forEach(el => this.patchHorizontalElement(el));
    }

    protected patchElement(element: HTMLElement): void {
        if (this.patchedVertical.has(element)) {
            return;
        }
        if (!element.isConnected) {
            return;
        }
        this.patchedVertical.add(element);
        this.scrollPatches.push(installMobileVerticalTouchScroll(element));
    }

    protected patchHorizontalElement(element: HTMLElement): void {
        if (this.patchedHorizontal.has(element)) {
            return;
        }
        if (!element.isConnected) {
            return;
        }
        this.patchedHorizontal.add(element);
        this.scrollPatches.push(installMobileHorizontalTouchScroll(element));
    }
}

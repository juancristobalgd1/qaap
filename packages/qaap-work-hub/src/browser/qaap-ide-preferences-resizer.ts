// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { injectable } from '@theia/core/shared/inversify';

const SETTINGS_ROOT_SELECTOR = '.theia-settings-container';
const TREE_SELECTOR = '.preferences-tree-widget';
const RESIZER_CLASS = 'qaap-ide-preferences-resizer';
const RESIZABLE_CLASS = 'qaap-ide-preferences-resizable';
const WORK_HUB_EMBED_CLASS = 'theia-mobile-work-hub-preferences-embed';
const MIN_TREE_WIDTH = 180;
const MAX_TREE_WIDTH = 420;
const MIN_EDITOR_WIDTH = 320;
const DEFAULT_TREE_WIDTH = 280;

interface ResizeState {
    width: number;
    min: number;
    max: number;
}

/** Adds a keyboard- and pointer-accessible divider to the native IDE settings tree. */
@injectable()
export class QaapIdePreferencesResizer implements FrontendApplicationContribution {

    protected readonly toDispose = new DisposableCollection();
    protected readonly roots = new Map<HTMLElement, ResizeObserver>();
    protected readonly states = new WeakMap<HTMLElement, ResizeState>();
    protected readonly resizers = new WeakMap<HTMLElement, HTMLElement>();
    protected readonly rootsByResizer = new WeakMap<HTMLElement, HTMLElement>();
    protected bodyObserver: MutationObserver | undefined;
    protected refreshHandle: number | undefined;
    protected activeRoot: HTMLElement | undefined;
    protected activePointerId: number | undefined;
    protected activeStartX = 0;
    protected activeStartWidth = 0;

    protected readonly onPointerMove = (event: PointerEvent): void => {
        if (!this.activeRoot || event.pointerId !== this.activePointerId) {
            return;
        }
        const state = this.getResizeState(this.activeRoot);
        this.applyWidth(this.activeRoot, this.activeStartWidth + event.clientX - this.activeStartX, state);
        event.preventDefault();
    };

    protected readonly onPointerUp = (event: PointerEvent): void => {
        if (this.activePointerId !== undefined && event.pointerId !== this.activePointerId) {
            return;
        }
        this.stopPointerResize();
    };

    protected readonly onPointerDown = (event: PointerEvent): void => {
        if (event.pointerType === 'mouse' && event.button !== 0) {
            return;
        }
        const resizer = event.currentTarget;
        if (!(resizer instanceof HTMLElement)) {
            return;
        }
        const root = this.rootsByResizer.get(resizer);
        if (!(root instanceof HTMLElement)) {
            return;
        }
        const state = this.getResizeState(root);
        this.activeRoot = root;
        this.activePointerId = event.pointerId;
        this.activeStartX = event.clientX;
        this.activeStartWidth = state.width;
        resizer.classList.add('theia-mod-resizing');
        document.body.classList.add('qaap-ide-preferences-resizing');
        document.addEventListener('pointermove', this.onPointerMove, { passive: false });
        document.addEventListener('pointerup', this.onPointerUp);
        document.addEventListener('pointercancel', this.onPointerUp);
        resizer.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    };

    protected readonly onKeyDown = (event: KeyboardEvent): void => {
        const resizer = event.currentTarget;
        if (!(resizer instanceof HTMLElement)) {
            return;
        }
        const root = this.rootsByResizer.get(resizer);
        if (!(root instanceof HTMLElement)) {
            return;
        }
        const state = this.getResizeState(root);
        const step = event.shiftKey ? 32 : 8;
        let width: number | undefined;
        if (event.key === 'ArrowLeft') {
            width = state.width - step;
        } else if (event.key === 'ArrowRight') {
            width = state.width + step;
        } else if (event.key === 'Home') {
            width = state.min;
        } else if (event.key === 'End') {
            width = state.max;
        }
        if (width === undefined) {
            return;
        }
        this.applyWidth(root, width, state);
        event.preventDefault();
    };

    onStart(_app: FrontendApplication): void {
        this.bodyObserver = new MutationObserver(() => this.scheduleRefresh());
        this.bodyObserver.observe(document.body, { childList: true, subtree: true });
        this.toDispose.push(Disposable.create(() => this.bodyObserver?.disconnect()));
        window.addEventListener('resize', this.scheduleRefresh);
        this.toDispose.push(Disposable.create(() => window.removeEventListener('resize', this.scheduleRefresh)));
        this.scheduleRefresh();
    }

    onStop(): void {
        this.stopPointerResize();
        if (this.refreshHandle !== undefined) {
            window.cancelAnimationFrame(this.refreshHandle);
        }
        for (const [root, observer] of this.roots) {
            observer.disconnect();
            this.removeResizer(root);
            root.classList.remove(RESIZABLE_CLASS);
            root.style.removeProperty('grid-template-columns');
        }
        this.roots.clear();
        this.toDispose.dispose();
    }

    protected readonly scheduleRefresh = (): void => {
        if (this.refreshHandle !== undefined) {
            return;
        }
        this.refreshHandle = window.requestAnimationFrame(() => {
            this.refreshHandle = undefined;
            this.refresh();
        });
    };

    protected refresh(): void {
        const roots = Array.from(document.querySelectorAll<HTMLElement>(SETTINGS_ROOT_SELECTOR))
            .filter(root => !root.classList.contains(WORK_HUB_EMBED_CLASS));
        for (const root of roots) {
            this.ensureRoot(root);
        }
        for (const [root, observer] of this.roots) {
            if (!root.isConnected || !roots.includes(root)) {
                observer.disconnect();
                this.removeResizer(root);
                root.classList.remove(RESIZABLE_CLASS);
                root.style.removeProperty('grid-template-columns');
                this.roots.delete(root);
            }
        }
    }

    protected ensureRoot(root: HTMLElement): void {
        const tree = root.querySelector<HTMLElement>(TREE_SELECTOR);
        if (!tree || !tree.isConnected) {
            return;
        }
        root.classList.add(RESIZABLE_CLASS);
        let resizer = this.resizers.get(root);
        if (!resizer) {
            resizer = document.createElement('div');
            resizer.className = RESIZER_CLASS;
            resizer.setAttribute('role', 'separator');
            resizer.setAttribute('aria-orientation', 'vertical');
            resizer.setAttribute('aria-label', nls.localize(
                'qaap/preferences/resizeCategories',
                'Resize settings categories',
            ));
            resizer.tabIndex = 0;
            resizer.addEventListener('pointerdown', this.onPointerDown);
            resizer.addEventListener('keydown', this.onKeyDown);
            this.resizers.set(root, resizer);
            this.rootsByResizer.set(resizer, root);
            document.body.appendChild(resizer);
        }
        const state = this.getResizeState(root);
        this.applyWidth(root, state.width, state);
        this.syncResizerGeometry(root, tree, resizer);
        if (!this.roots.has(root) && typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(() => this.scheduleRefresh());
            observer.observe(root);
            observer.observe(tree);
            this.roots.set(root, observer);
        }
    }

    protected getResizeState(root: HTMLElement): ResizeState {
        const rootWidth = root.getBoundingClientRect().width;
        const min = Math.min(MIN_TREE_WIDTH, Math.max(150, Math.floor(rootWidth - MIN_EDITOR_WIDTH)));
        const max = Math.max(min, Math.min(MAX_TREE_WIDTH, Math.floor(rootWidth - MIN_EDITOR_WIDTH)));
        const existing = this.states.get(root);
        const tree = root.querySelector<HTMLElement>(TREE_SELECTOR);
        const treeWidth = tree?.getBoundingClientRect().width ?? 0;
        const initialWidth = existing?.width ?? (treeWidth > 0 ? treeWidth : DEFAULT_TREE_WIDTH);
        const state = existing ?? { width: initialWidth, min, max };
        state.min = min;
        state.max = max;
        state.width = Math.min(max, Math.max(min, state.width));
        this.states.set(root, state);
        return state;
    }

    protected applyWidth(root: HTMLElement, width: number, state: ResizeState): void {
        const clampedWidth = Math.min(state.max, Math.max(state.min, width));
        state.width = clampedWidth;
        root.style.gridTemplateColumns = `${Math.round(clampedWidth)}px minmax(0, 1fr)`;
        const tree = root.querySelector<HTMLElement>(TREE_SELECTOR);
        const resizer = this.resizers.get(root);
        if (tree && resizer) {
            this.syncResizerGeometry(root, tree, resizer);
        }
    }

    protected syncResizerGeometry(root: HTMLElement, tree: HTMLElement, resizer: HTMLElement): void {
        const treeRect = tree.getBoundingClientRect();
        const visible = treeRect.width > 0 && treeRect.height > 0 && getComputedStyle(tree).display !== 'none';
        resizer.hidden = !visible;
        if (!visible) {
            return;
        }
        resizer.style.left = `${Math.round(treeRect.right)}px`;
        resizer.style.top = `${Math.round(treeRect.top)}px`;
        resizer.style.height = `${Math.round(treeRect.height)}px`;
        const state = this.getResizeState(root);
        resizer.setAttribute('aria-valuemin', String(Math.round(state.min)));
        resizer.setAttribute('aria-valuemax', String(Math.round(state.max)));
        resizer.setAttribute('aria-valuenow', String(Math.round(state.width)));
    }

    protected stopPointerResize(): void {
        const resizer = this.activeRoot ? this.resizers.get(this.activeRoot) : undefined;
        if (this.activePointerId !== undefined && resizer?.hasPointerCapture(this.activePointerId)) {
            resizer.releasePointerCapture(this.activePointerId);
        }
        this.activeRoot = undefined;
        this.activePointerId = undefined;
        resizer?.classList.remove('theia-mod-resizing');
        document.body.classList.remove('qaap-ide-preferences-resizing');
        document.removeEventListener('pointermove', this.onPointerMove);
        document.removeEventListener('pointerup', this.onPointerUp);
        document.removeEventListener('pointercancel', this.onPointerUp);
    }

    protected removeResizer(root: HTMLElement): void {
        const resizer = this.resizers.get(root);
        if (!resizer) {
            return;
        }
        resizer.remove();
        this.resizers.delete(root);
    }
}

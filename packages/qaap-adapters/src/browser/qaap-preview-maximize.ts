// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { Disposable, DisposableCollection } from '@theia/core/lib/common/disposable';
import { addEventListener } from '@theia/core/lib/browser/widgets/widget';
import { QaapAgentPreviewChromeStyle as Style } from './qaap-agent-preview-chrome-style';

export interface CreatePreviewMaximizeControlOptions {
    readonly getPreviewRoot: () => HTMLElement;
    readonly toDispose: DisposableCollection;
}

export interface PreviewMaximizeControl {
    readonly button: HTMLButtonElement;
    readonly controller: QaapPreviewMaximizeController;
}

/** Workbench maximize / restore toggle (left of Edit). */
export function createPreviewMaximizeControl(options: CreatePreviewMaximizeControlOptions): PreviewMaximizeControl {
    const controller = new QaapPreviewMaximizeController(options.getPreviewRoot);
    const button = createPreviewMaximizeButton(controller);
    wirePreviewMaximizeButton(button, controller, options.toDispose);
    options.toDispose.push(controller);
    return { button, controller };
}

export class QaapPreviewMaximizeController implements Disposable {
    protected maximized = false;

    constructor(protected readonly getPreviewRoot: () => HTMLElement) { }

    isMaximized(): boolean {
        return this.maximized;
    }

    toggle(): void {
        this.setMaximized(!this.maximized);
    }

    setMaximized(maximized: boolean): void {
        if (this.maximized === maximized) {
            return;
        }
        this.maximized = maximized;
        for (const root of collectPreviewMaximizeScopeRoots(this.getPreviewRoot())) {
            root.classList.toggle(Style.PREVIEW_MAXIMIZED, maximized);
        }
    }

    dispose(): void {
        if (this.maximized) {
            this.setMaximized(false);
        }
    }
}

export function createPreviewMaximizeButton(controller: QaapPreviewMaximizeController): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('theia-mini-browser-workbench-button', Style.TOOLBAR_MAXIMIZE);
    syncPreviewMaximizeButton(button, controller.isMaximized());
    return button;
}

export function wirePreviewMaximizeButton(
    button: HTMLButtonElement,
    controller: QaapPreviewMaximizeController,
    toDispose: DisposableCollection,
): void {
    toDispose.push(addEventListener(button, 'click', (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        controller.toggle();
        syncPreviewMaximizeButton(button, controller.isMaximized());
    }));
}

export function syncPreviewMaximizeButton(button: HTMLButtonElement, maximized: boolean): void {
    const label = maximized
        ? nls.localize('qaap/preview/restore', 'Restore')
        : nls.localize('qaap/preview/maximize', 'Maximize');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', maximized ? 'true' : 'false');
    button.replaceChildren(createPreviewMaximizeIcon(maximized));
}

function createPreviewMaximizeIcon(maximized: boolean): HTMLElement {
    const host = document.createElement('span');
    host.className = Style.TOOLBAR_MAXIMIZE_ICON;
    host.setAttribute('aria-hidden', 'true');
    host.append(maximized ? createLucideExpandIcon() : createLucideMaximize2Icon());
    return host;
}

function svgEl(tag: string, attrs: Record<string, string>): SVGElement {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) {
        el.setAttribute(key, value);
    }
    return el;
}

function createLucideSvg(paths: string[]): SVGSVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '16');
    svg.setAttribute('height', '16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('focusable', 'false');
    for (const d of paths) {
        svg.append(svgEl('path', { d }));
    }
    return svg;
}

/** lucide-maximize-2 — click to maximize. */
function createLucideMaximize2Icon(): SVGSVGElement {
    return createLucideSvg([
        'M15 3h6v6',
        'm21 3-7 7',
        'm3 21 7-7',
        'M9 21H3v-6',
    ]);
}

/** lucide-expand — click to restore. */
function createLucideExpandIcon(): SVGSVGElement {
    return createLucideSvg([
        'm15 15 6 6',
        'm15 9 6-6',
        'M21 16v5h-5',
        'M21 8V3h-5',
        'M3 16v5h5',
        'm3 21 6-6',
        'M3 8V3h5',
        'M9 9 3 3',
    ]);
}

/** Resolve every ancestor that receives the maximized scope class (for tests). */
export function collectPreviewMaximizeScopeRoots(previewRoot: HTMLElement): HTMLElement[] {
    const roots: HTMLElement[] = [previewRoot, document.body];
    const workHubRoot = previewRoot.closest('.theia-mobile-projects, .theia-mobile-agent-log-sheet');
    if (workHubRoot instanceof HTMLElement) {
        roots.push(workHubRoot);
    }
    const mainPanel = previewRoot.closest('#theia-main-content-panel');
    if (mainPanel instanceof HTMLElement) {
        roots.push(mainPanel);
    }
    return roots;
}

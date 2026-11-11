// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// The chrome modules touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { mountEmbeddedAgentPreviewChrome, type EmbeddedAgentPreviewChrome } from './qaap-agent-preview-chrome';
import { createQaapPreviewToolbarSkeleton, QAAP_PREVIEW_TOOLBAR_SKELETON_CLASS } from './qaap-agent-preview-toolbar-skeleton';

disableImportJSDOM();

describe('qaap-agent-preview-toolbar-skeleton', () => {
    let disableJSDOM: (() => void) | undefined;
    const mounted: EmbeddedAgentPreviewChrome[] = [];
    const PLACEHOLDER = 'Starting preview…';

    let restoreJsdomGaps: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
        restoreJsdomGaps = stubJsdomGaps();
    });

    afterEach(() => {
        mounted.splice(0).forEach(chrome => chrome.dispose());
        document.body.replaceChildren();
    });

    after(() => {
        restoreJsdomGaps?.();
        restoreJsdomGaps = undefined;
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    /**
     * jsdom lacks two browser APIs the embedded chrome calls while mounting: the iframe `sandbox`
     * token list and `window.matchMedia`. Each is stubbed only when missing and restored afterwards.
     */
    function stubJsdomGaps(): (() => void) {
        const restores: Array<() => void> = [];
        const frameProto = window.HTMLIFrameElement.prototype;
        if (!('sandbox' in frameProto)) {
            const tokens = new Set<string>();
            const tokenList = {
                add: (...names: string[]) => names.forEach(name => tokens.add(name)),
                remove: (...names: string[]) => names.forEach(name => tokens.delete(name)),
                contains: (name: string) => tokens.has(name),
            };
            Object.defineProperty(frameProto, 'sandbox', {
                configurable: true,
                get: () => tokenList,
            });
            restores.push(() => delete (frameProto as unknown as Record<string, unknown>).sandbox);
        }
        if (typeof window.matchMedia !== 'function') {
            const hadOwn = Object.prototype.hasOwnProperty.call(window, 'matchMedia');
            Object.defineProperty(window, 'matchMedia', {
                configurable: true,
                value: (query: string): MediaQueryList => ({
                    matches: false,
                    media: query,
                    onchange: null,
                    addListener: () => undefined,
                    removeListener: () => undefined,
                    addEventListener: () => undefined,
                    removeEventListener: () => undefined,
                    dispatchEvent: () => false,
                }),
            });
            restores.push(() => {
                if (hadOwn) {
                    return;
                }
                delete (window as unknown as Record<string, unknown>).matchMedia;
            });
        }
        return () => restores.forEach(restore => restore());
    }

    function mountRealToolbar(): HTMLElement {
        const host = document.createElement('div');
        document.body.append(host);
        const chrome = mountEmbeddedAgentPreviewChrome(host, { url: 'http://localhost:3000/' });
        mounted.push(chrome);
        const toolbar = chrome.root.querySelector<HTMLElement>('.qaap-agent-preview-embedded-toolbar');
        if (!toolbar) {
            throw new Error('the embedded preview chrome rendered no toolbar');
        }
        return toolbar;
    }

    function mountSkeleton(): HTMLElement {
        const skeleton = createQaapPreviewToolbarSkeleton({ placeholder: PLACEHOLDER });
        document.body.append(skeleton);
        return skeleton;
    }

    /** Structure of a toolbar: each direct child's tag and classes, then each button's classes and labels. */
    function toolbarOutline(toolbar: HTMLElement): { children: string[]; buttons: string[] } {
        const children = Array.from(toolbar.children).map(child => `${child.tagName}.${child.className}`);
        const buttons = Array.from(toolbar.querySelectorAll('button')).map(button => [
            button.className,
            button.getAttribute('aria-label') ?? '',
            button.title,
        ].join('|'));
        return { children, buttons };
    }

    it('matches the real toolbar: same direct children, buttons, classes and labels', () => {
        const real = toolbarOutline(mountRealToolbar());
        const skeleton = toolbarOutline(mountSkeleton());
        expect(skeleton.children).to.deep.equal(real.children);
        expect(skeleton.buttons).to.deep.equal(real.buttons);
    });

    it('orders the controls Back, Forward, URL field, Maximize, Edit, overflow', () => {
        const toolbar = mountSkeleton();
        const children = Array.from(toolbar.children);
        expect(children.map(child => child.tagName)).to.deep.equal(['BUTTON', 'BUTTON', 'DIV', 'DIV', 'BUTTON']);
        const urlField = children[2];
        expect(urlField.classList.contains('theia-mini-browser-url-field')).to.equal(true);
        const workbench = children[3];
        expect(workbench.classList.contains('theia-mini-browser-workbench-controls')).to.equal(true);
        const workbenchButtons = Array.from(workbench.querySelectorAll('button'));
        expect(workbenchButtons.map(button => button.classList.contains('qaap-preview-maximize-button') || button.classList.contains('qaap-preview-edit-button')))
            .to.deep.equal([true, true]);
        expect(children[4].classList.contains('qaap-agent-preview-toolbar-overflow')).to.equal(true);
        expect(urlField.querySelector('.theia-mini-browser-open')).to.not.equal(null);
    });

    it('disables every control and the URL input, and keeps the loading state', () => {
        const toolbar = mountSkeleton();
        const buttons = Array.from(toolbar.querySelectorAll('button'));
        expect(buttons.length).to.equal(6);
        for (const button of buttons) {
            expect(button.disabled, button.className).to.equal(true);
        }
        const input = toolbar.querySelector<HTMLInputElement>('.theia-mini-browser-url-field input');
        expect(input?.disabled).to.equal(true);
        expect(input?.readOnly).to.equal(true);
        expect(input?.placeholder).to.equal(PLACEHOLDER);
        expect(toolbar.getAttribute('aria-busy')).to.equal('true');
        expect(toolbar.classList.contains(QAAP_PREVIEW_TOOLBAR_SKELETON_CLASS)).to.equal(true);
        expect(toolbar.classList.contains('qaap-mod-frame-loading')).to.equal(true);
        expect(toolbar.classList.contains('theia-mobile-execution-surface-sidebar-toolbar')).to.equal(true);
    });

    it('uses the real icons: arrows for navigation, lucide maximize, edit, kebab overflow', () => {
        const toolbar = mountSkeleton();
        const codiconOf = (button: Element): string | undefined => Array.from(button.classList).find(name => name.startsWith('codicon-'));
        const [back, forward] = Array.from(toolbar.querySelectorAll('button'));
        expect(codiconOf(back)).to.equal('codicon-arrow-left');
        expect(codiconOf(forward)).to.equal('codicon-arrow-right');
        const maximize = toolbar.querySelector<HTMLButtonElement>('.qaap-preview-maximize-button');
        expect(maximize?.getAttribute('aria-pressed')).to.equal('false');
        expect(maximize?.querySelector('svg')).to.not.equal(null);
        expect(toolbar.querySelector('.qaap-agent-preview-toolbar-overflow')?.classList.contains('codicon-kebab-vertical')).to.equal(true);
        expect(toolbar.querySelector('.codicon-screen-full')).to.equal(null);
    });
});

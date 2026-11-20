// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import type { MobileComposerAttachHandlers } from './qaap-mobile-composer-device-attach';
import {
    dismissMobileContextAttachMenu,
    pickMobileContextVariable,
    type MobileContextAttachServices,
} from './qaap-mobile-context-attach-menu';

type VariableService = Parameters<typeof pickMobileContextVariable>[1];
type QuickInput = Parameters<typeof pickMobileContextVariable>[2];

/** A rect that is laid out, so the menu is not dismissed as anchored to nothing. */
function laidOut(element: HTMLElement): void {
    element.getBoundingClientRect = (): DOMRect => ({
        x: 100, y: 600, left: 100, top: 600, width: 40, height: 30, right: 140, bottom: 630, toJSON: () => ({}),
    }) as DOMRect;
}

describe('qaap-mobile-context-attach-menu "File" item', () => {
    let disableJSDOM: () => void;
    let anchor: HTMLButtonElement;
    let nodeAbortController: typeof AbortController;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
        // The popover wiring hands an AbortSignal to window.addEventListener; it must be jsdom's own.
        nodeAbortController = globalThis.AbortController;
        globalThis.AbortController = window.AbortController;
        if (typeof window.requestAnimationFrame !== 'function') {
            window.requestAnimationFrame = (callback: FrameRequestCallback): number => window.setTimeout(() => callback(Date.now()), 0);
        }
        if (typeof window.cancelAnimationFrame !== 'function') {
            window.cancelAnimationFrame = (handle: number): void => window.clearTimeout(handle);
        }
        anchor = document.createElement('button');
        anchor.className = 'theia-mobile-projects-sticky-composer-attach';
        laidOut(anchor);
        document.body.append(anchor);
    });

    afterEach(() => {
        dismissMobileContextAttachMenu();
        document.body.replaceChildren();
        globalThis.AbortController = nodeAbortController;
        disableJSDOM();
    });

    /** Work Hub composer: no workspace open, but the project folder is searchable. */
    function createAttachServices(): MobileContextAttachServices {
        return {
            fileUploadService: {},
            fileService: {},
            workspaceService: {
                opened: false,
                tryGetRoots: () => [],
            },
            searchProjectFiles: async () => [],
        } as unknown as MobileContextAttachServices;
    }

    function openMenu(attachServices: MobileContextAttachServices | undefined, handlers: MobileComposerAttachHandlers): Promise<unknown> {
        return pickMobileContextVariable(
            anchor,
            { getContextVariables: () => [] } as unknown as VariableService,
            {} as QuickInput,
            attachServices,
            handlers,
        );
    }

    function menuItemLabels(): string[] {
        return Array.from(document.querySelectorAll<HTMLElement>('.theia-mobile-projects-sticky-composer-attach-menu-item-label'))
            .map(label => label.textContent ?? '');
    }

    it('is shown when no workspace is open but the composer has a project folder to search', () => {
        void openMenu(createAttachServices(), { uploadTargetDir: new URI('file:///proj') } as MobileComposerAttachHandlers);

        expect(menuItemLabels()).to.include('File');
    });

    it('is hidden when no workspace is open and the composer has no project folder', () => {
        void openMenu(createAttachServices(), {} as MobileComposerAttachHandlers);

        expect(menuItemLabels()).to.not.include('File');
    });
});

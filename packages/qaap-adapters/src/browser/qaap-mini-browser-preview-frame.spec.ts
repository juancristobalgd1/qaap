// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

let disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import type { ApplicationShell } from '@theia/core/lib/browser/shell';
import { MiniBrowser } from '@theia/mini-browser/lib/browser/mini-browser';
import { QaapMiniBrowserContent } from './qaap-mini-browser-content';
import { syncQaapMiniBrowserPreviewSuspension } from './qaap-mini-browser-preview-frame';

disableJSDOM();

interface FakePreview {
    readonly widget: MiniBrowser;
    readonly calls: string[];
}

function fakePreview(id: string, isVisible: boolean): FakePreview {
    const calls: string[] = [];
    const content = Object.create(QaapMiniBrowserContent.prototype);
    Object.assign(content, {
        suspendPreviewFrame: () => calls.push('suspend'),
        resumePreviewFrame: () => calls.push('resume'),
    });
    const widget = Object.create(MiniBrowser.prototype);
    Object.defineProperty(widget, 'id', { value: id });
    Object.defineProperty(widget, 'isVisible', { value: isVisible });
    Object.defineProperty(widget, 'layout', { value: { widgets: [content] } });
    return { widget, calls };
}

describe('syncQaapMiniBrowserPreviewSuspension', () => {

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    it('suspends only previews that are off screen while the IDE preview is in use', () => {
        const active = fakePreview('active', true);
        const split = fakePreview('split', true);
        const background = fakePreview('background', false);
        const shell = {
            activeWidget: active.widget,
            currentWidget: active.widget,
            getWidgets: (area: string) => area === 'main' ? [active.widget, split.widget, background.widget] : [],
        } as unknown as ApplicationShell;

        syncQaapMiniBrowserPreviewSuspension(shell, true);

        expect(active.calls).to.deep.equal(['resume']);
        expect(split.calls).to.deep.equal(['resume']);
        expect(background.calls).to.deep.equal(['suspend']);
    });
});

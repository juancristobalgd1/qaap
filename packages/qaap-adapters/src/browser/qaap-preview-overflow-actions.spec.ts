// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    buildPreviewOverflowMenuItems,
    captureSameOriginPreview,
    clonePreviewDocumentWithComputedStyles,
    QAAP_PREVIEW_CAPTURE_MAX_DOM_ELEMENTS,
    QaapPreviewCaptureGuard,
    resolvePreviewCaptureDimensions,
} from './qaap-preview-overflow-actions';

describe('qaap-preview-overflow-actions', () => {

    it('buildPreviewOverflowMenuItems includes all Cursor-style preview actions', () => {
        const ids = buildPreviewOverflowMenuItems({ bookmarkBarVisible: () => false }).map(item => item.id);
        expect(ids).to.deep.equal([
            'take-screenshot',
            'hard-reload',
            'copy-url',
            'bookmark-bar',
            'clear-history',
            'clear-cookies',
            'clear-cache',
        ]);
    });

    it('bookmark bar label reflects visibility', () => {
        const hidden = buildPreviewOverflowMenuItems({ bookmarkBarVisible: () => false })
            .find(item => item.id === 'bookmark-bar');
        const shown = buildPreviewOverflowMenuItems({ bookmarkBarVisible: () => true })
            .find(item => item.id === 'bookmark-bar');
        expect(hidden?.label).to.contain('Show');
        expect(shown?.label).to.contain('Hide');
        expect(shown?.checked).to.equal(true);
    });

    it('freezes cascaded layout and colors into the screenshot clone', () => {
        const disableJSDOM = enableJSDOM();
        try {
            document.head.innerHTML = '<style>main { width: 420px; background: rgb(255, 255, 255); color: rgb(1, 2, 3); }</style>';
            document.body.innerHTML = '<main><h1>Preview</h1></main>';
            const clone = clonePreviewDocumentWithComputedStyles(document);
            const main = clone.querySelector('main');
            expect(main?.style.width).to.equal('420px');
            expect(main?.style.backgroundColor).to.equal('rgb(255, 255, 255)');
            expect(main?.style.color).to.equal('rgb(1, 2, 3)');
        } finally {
            disableJSDOM();
        }
    });

    it('bounds full-page captures by default and enforces a hard pixel ceiling', () => {
        expect(resolvePreviewCaptureDimensions(12000, 30000)).to.deep.equal({ width: 1600, height: 2400 });
        const explicitlyLarge = resolvePreviewCaptureDimensions(12000, 30000, {
            maxWidth: 12000,
            maxHeight: 30000,
        });
        expect(explicitlyLarge.width * explicitlyLarge.height).to.be.at.most(8_000_000);
        expect(resolvePreviewCaptureDimensions(12000, 30000, { maxWidth: 800, maxHeight: 600 }))
            .to.deep.equal({ width: 800, height: 600 });
    });

    it('blocks a concurrent capture and releases the guard after settlement', async () => {
        const guard = new QaapPreviewCaptureGuard();
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const first = guard.run(async () => {
            await gate;
            return 'first';
        });

        expect(await guard.run(async () => 'second')).to.equal(undefined);
        release();
        expect(await first).to.equal('first');
        expect(await guard.run(async () => 'third')).to.equal('third');
    });

    it('refuses an over-complex DOM before allocating a canvas', async () => {
        const disableJSDOM = enableJSDOM();
        try {
            const fragment = document.createDocumentFragment();
            for (let index = 0; index < QAAP_PREVIEW_CAPTURE_MAX_DOM_ELEMENTS; index++) {
                fragment.append(document.createElement('div'));
            }
            document.body.append(fragment);
            const frame = document.createElement('iframe');

            expect(await captureSameOriginPreview(document, frame)).to.equal(undefined);
        } finally {
            disableJSDOM();
        }
    });
});

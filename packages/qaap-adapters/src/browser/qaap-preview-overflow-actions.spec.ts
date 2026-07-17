// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { buildPreviewOverflowMenuItems, clonePreviewDocumentWithComputedStyles } from './qaap-preview-overflow-actions';

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
});

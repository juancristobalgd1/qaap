// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { expect } from 'chai';
import { mountHeaderProjectButtonContents } from './mobile-projects-panel-chrome-ui';

describe('mountHeaderProjectButtonContents', () => {

    beforeEach(() => {
        if (typeof document === 'undefined') {
            enableJSDOM();
        }
    });

    it('puts a folder glyph before the project name and keeps the chevron after it', () => {
        const button = document.createElement('button');
        const label = document.createElement('span');
        label.textContent = 'sample-files1';
        const { folder, chevron } = mountHeaderProjectButtonContents(button, label);

        expect(folder.classList.contains('codicon-folder')).to.equal(true);
        expect(chevron.classList.contains('codicon-chevron-down')).to.equal(true);
        expect(Array.from(button.childNodes)).to.deep.equal([folder, label, chevron]);
        expect(label.className).to.equal('theia-mobile-projects-header-project-label');
    });
});

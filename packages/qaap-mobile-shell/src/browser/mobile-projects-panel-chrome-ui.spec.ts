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

    it('puts the project chevron beside the folder and a conversations chevron after the title', () => {
        const cluster = document.createElement('div');
        const switcher = document.createElement('button');
        const conversations = document.createElement('button');
        const label = document.createElement('span');
        label.textContent = 'sample-files1';
        const { folder, separator, projectChevron, conversationsChevron } = mountHeaderProjectButtonContents(
            cluster, switcher, conversations, label,
        );

        expect(folder.classList.contains('codicon-folder')).to.equal(true);
        expect(separator.textContent).to.equal('|');
        expect(separator.hidden).to.equal(true);
        expect(projectChevron.classList.contains('codicon-chevron-down')).to.equal(true);
        expect(conversationsChevron.classList.contains('codicon-chevron-down')).to.equal(true);
        expect(conversationsChevron.classList.contains('theia-mobile-projects-header-conversations-icon')).to.equal(true);
        expect(Array.from(cluster.childNodes)).to.deep.equal([switcher, separator, conversations]);
        expect(Array.from(switcher.childNodes)).to.deep.equal([folder, projectChevron]);
        expect(Array.from(conversations.childNodes)).to.deep.equal([label, conversationsChevron]);
        expect(label.className).to.equal('theia-mobile-projects-header-project-label');
    });
});

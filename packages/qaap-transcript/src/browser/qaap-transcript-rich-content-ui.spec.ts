// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { enhanceTranscriptMarkdownRichContent } from './qaap-transcript-rich-content-ui';

disableImportJSDOM();

describe('enhanceTranscriptMarkdownRichContent', () => {

    let disableJSDOM: () => void;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM();
    });

    function renderHost(html: string): HTMLElement {
        const element = document.createElement('div');
        element.innerHTML = html;
        document.body.appendChild(element);
        return element;
    }

    it('turns a bare article link into a link preview card', () => {
        const root = renderHost('<p><a href="https://example.com/guide">https://example.com/guide</a></p>');
        enhanceTranscriptMarkdownRichContent(root);
        expect(root.querySelector('.theia-mobile-agent-link-preview-card-domain')).to.not.equal(null);
        root.remove();
    });

    it('does not show a link preview card for a provider API endpoint quoted in an error', () => {
        const root = renderHost('<p><a href="https://api.openai.com/v1/responses">https://api.openai.com/v1/responses</a></p>');
        enhanceTranscriptMarkdownRichContent(root);
        expect(root.querySelector('.theia-mobile-agent-link-preview-card-domain')).to.equal(null);
        expect(root.querySelector('a[href="https://api.openai.com/v1/responses"]')).to.not.equal(null);
        root.remove();
    });
});

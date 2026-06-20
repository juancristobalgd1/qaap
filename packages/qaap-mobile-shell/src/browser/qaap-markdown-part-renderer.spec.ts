// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { MiniBrowserCommands } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import {
    openQaapMarkdownHref,
    shouldOpenMarkdownHrefInWorkHubBrowser,
} from './qaap-markdown-part-renderer';

describe('qaap-markdown-part-renderer', () => {

    let disableJSDOM: (() => void) | undefined;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
    });

    beforeEach(() => {
        document.body.className = '';
    });

    it('routes WorkHub http links to the mini-browser command', async () => {
        document.body.classList.add('theia-mobile-mod-workhub-composer-header');
        const calls: unknown[][] = [];

        await openQaapMarkdownHref(
            'https://example.com/path',
            {} as never,
            { executeCommand: async (...args: unknown[]) => { calls.push(args); } } as never,
            document,
        );

        expect(calls).to.deep.equal([[MiniBrowserCommands.OPEN_URL.id, 'https://example.com/path']]);
    });

    it('recognizes localhost urls as WorkHub browser links', () => {
        document.body.classList.add('theia-mobile-mod-workhub-no-bottom-chrome');

        expect(shouldOpenMarkdownHrefInWorkHubBrowser('localhost:5173', document)).to.equal(true);
        expect(shouldOpenMarkdownHrefInWorkHubBrowser('http://127.0.0.1:5173', document)).to.equal(true);
        expect(shouldOpenMarkdownHrefInWorkHubBrowser('file:///tmp/report.txt', document)).to.equal(false);
    });

    it('does not route web links to the WorkHub browser outside WorkHub', () => {
        expect(shouldOpenMarkdownHrefInWorkHubBrowser('https://example.com', document)).to.equal(false);
    });

});

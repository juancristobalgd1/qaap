// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { parseHTML } from 'linkedom';
import {
    chatMarkdownNeedsFenceParse,
    chatMarkdownNeedsInlineFormatting,
    chatMarkdownShouldUseWorker,
    getSharedChatMarkdownIt,
    QAAP_CHAT_MARKDOWN_PLAIN_MAX_CHARS,
    resetSharedChatMarkdownItForTests,
    resolveChatMarkdownRenderMode,
} from './qaap-chat-markdown-render';

disableImportJSDOM();

describe('qaap-chat-markdown-render', () => {

    const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
    let previousDocument: Document | undefined;

    // Installed per test and restored afterwards: a document swapped in once in `before` would either be replaced by
    // the root JSDOM hook or leak into every later suite.
    beforeEach(() => {
        previousDocument = globalThis.document;
        (globalThis as typeof globalThis & { document: Document }).document = document as unknown as Document;
    });

    afterEach(() => {
        resetSharedChatMarkdownItForTests();
        if (previousDocument) {
            (globalThis as typeof globalThis & { document: Document }).document = previousDocument;
        }
    });

    it('getSharedChatMarkdownIt returns one shared instance', () => {
        const first = getSharedChatMarkdownIt();
        const second = getSharedChatMarkdownIt();
        expect(first).to.equal(second);
    });

    it('resolveChatMarkdownRenderMode uses plain text for short unformatted streams', () => {
        expect(resolveChatMarkdownRenderMode('hello there', '', undefined)).to.equal('plain');
        expect(resolveChatMarkdownRenderMode('hello world', 'hello ', 'plain')).to.equal('plain');
    });

    it('resolveChatMarkdownRenderMode switches to worker or sync for fences or inline markdown', () => {
        expect(chatMarkdownNeedsFenceParse('```ts\nconst x = 1')).to.equal(true);
        expect(chatMarkdownNeedsInlineFormatting('**bold**')).to.equal(true);
        expect(resolveChatMarkdownRenderMode('**bold**', '', undefined)).to.equal('sync');
        expect(resolveChatMarkdownRenderMode('text\n```\ncode', 'text\n', 'plain')).to.equal('worker');
    });

    it('chatMarkdownShouldUseWorker prefers worker for fences, long text, or formatted streams', () => {
        expect(chatMarkdownShouldUseWorker('```\ncode')).to.equal(true);
        expect(chatMarkdownShouldUseWorker('x'.repeat(QAAP_CHAT_MARKDOWN_PLAIN_MAX_CHARS))).to.equal(true);
        expect(chatMarkdownShouldUseWorker('**' + 'word '.repeat(30))).to.equal(true);
        expect(chatMarkdownShouldUseWorker('short plain')).to.equal(false);
    });

    it('getSharedChatMarkdownIt renders markdown syntax', () => {
        const html = getSharedChatMarkdownIt().render('**Hello**');
        expect(html).to.include('<strong>Hello</strong>');
    });

    it('keeps plain mode for long append-only prose without markdown syntax', () => {
        const prefix = 'word '.repeat(QAAP_CHAT_MARKDOWN_PLAIN_MAX_CHARS / 5);
        expect(resolveChatMarkdownRenderMode(prefix + ' tail', prefix, 'plain')).to.equal('plain');
    });
});

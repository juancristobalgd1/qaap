// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapPreviewNavigableUrl, resolveQaapPreviewAddressInput } from './qaap-preview-address-input';

describe('resolveQaapPreviewAddressInput', () => {

    const urlOf = (raw: string): string | undefined => {
        const result = resolveQaapPreviewAddressInput(raw);
        return result.kind === 'url' || result.kind === 'search' ? result.url : undefined;
    };

    it('adds https:// to bare domains', () => {
        expect(urlOf('claude.ai')).to.equal('https://claude.ai');
        expect(urlOf('  www.anthropic.com/news ')).to.equal('https://www.anthropic.com/news');
        expect(urlOf('example.com:8080/x?y=1')).to.equal('https://example.com:8080/x?y=1');
        expect(urlOf('//example.com/')).to.equal('https://example.com/');
    });

    it('keeps explicit http(s) URLs and IDE-origin paths', () => {
        expect(urlOf('https://claude.ai/new')).to.equal('https://claude.ai/new');
        expect(urlOf('http://example.com')).to.equal('http://example.com');
        expect(urlOf('HTTPS://Example.com')).to.equal('HTTPS://Example.com');
        expect(urlOf('/qaap-dev/5173/')).to.equal('/qaap-dev/5173/');
        expect(urlOf('about:blank')).to.equal('about:blank');
    });

    it('uses http:// for bare local dev hosts', () => {
        expect(urlOf('localhost:5173')).to.equal('http://localhost:5173/');
        expect(urlOf('127.0.0.1:3000/app')).to.equal('http://127.0.0.1:3000/app');
        expect(urlOf('localhost')).to.equal('http://localhost/');
    });

    it('turns free text into a web search', () => {
        const result = resolveQaapPreviewAddressInput('react hooks tutorial');
        expect(result.kind).to.equal('search');
        expect(urlOf('react hooks tutorial')).to.equal('https://www.google.com/search?q=react%20hooks%20tutorial');
        expect(resolveQaapPreviewAddressInput('anthropic').kind).to.equal('search');
    });

    it('refuses non-web schemes', () => {
        for (const raw of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,<b>x</b>', 'file:///etc/passwd', 'vbscript:x', 'mailto:a@b.com']) {
            expect(resolveQaapPreviewAddressInput(raw).kind, raw).to.equal('rejected');
        }
    });

    it('treats blank input as empty', () => {
        expect(resolveQaapPreviewAddressInput('   ').kind).to.equal('empty');
    });
});

describe('isQaapPreviewNavigableUrl', () => {
    const base = 'https://ide.qaap.dev/';

    it('accepts http(s), about:blank and IDE-origin paths', () => {
        for (const url of ['https://claude.ai', 'http://x.com', 'about:blank', '/qaap-dev/3000/', '']) {
            expect(isQaapPreviewNavigableUrl(url, base), url).to.equal(true);
        }
    });

    it('rejects script and local-file schemes', () => {
        for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'blob:https://x/1']) {
            expect(isQaapPreviewNavigableUrl(url, base), url).to.equal(false);
        }
    });
});

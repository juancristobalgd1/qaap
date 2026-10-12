// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { isQaapExternalPreviewUrl } from './qaap-mini-browser-blocked-frame';
import { QaapLocationWithoutSchemeMapper, resolveQaapMiniBrowserLocation } from './qaap-mini-browser-location-mapper';

describe('qaap mini-browser location mapping', () => {

    it('defaults external hosts to https', () => {
        expect(resolveQaapMiniBrowserLocation('example.com')).to.equal('https://example.com');
        expect(resolveQaapMiniBrowserLocation('example.com:8080/a?b=1')).to.equal('https://example.com:8080/a?b=1');
    });

    it('keeps http for local hosts', () => {
        for (const host of ['localhost:3000', '127.0.0.1:5173/x', '0.0.0.0:80', '[::1]:3000', 'printer.local', '192.168.1.5', '10.0.0.2:8080', '172.20.1.1']) {
            expect(resolveQaapMiniBrowserLocation(host), host).to.equal(`http://${host}`);
        }
        expect(resolveQaapMiniBrowserLocation('localhost')).to.equal('http://localhost');
    });

    it('treats 172.x outside the private range as external', () => {
        expect(resolveQaapMiniBrowserLocation('172.32.0.1')).to.equal('https://172.32.0.1');
    });

    it('turns free text into a search URL', () => {
        expect(resolveQaapMiniBrowserLocation('react hooks')).to.equal('https://duckduckgo.com/?q=react%20hooks');
        expect(resolveQaapMiniBrowserLocation('react')).to.equal('https://duckduckgo.com/?q=react');
    });

    it('leaves explicit schemes and paths to other mappers', () => {
        const mapper = new QaapLocationWithoutSchemeMapper();
        for (const location of ['https://a.com', 'http://a.com', 'file:///tmp/a.html', 'about:blank', '/qaap-dev/3000/']) {
            expect(mapper.canHandle(location), location).to.equal(0);
        }
        expect(mapper.canHandle('example.com')).to.equal(2);
        expect(mapper.canHandle('localhost:3000')).to.equal(2);
    });

    it('detects external preview origins', () => {
        const ide = 'https://ide.qaap.dev';
        expect(isQaapExternalPreviewUrl('https://example.com/', ide)).to.equal(true);
        expect(isQaapExternalPreviewUrl('https://ide.qaap.dev/qaap-dev/3000/', ide)).to.equal(false);
        expect(isQaapExternalPreviewUrl('https://ide.qaap.dev/qaap-preview/x/', ide)).to.equal(false);
        expect(isQaapExternalPreviewUrl('about:blank', ide)).to.equal(false);
    });
});

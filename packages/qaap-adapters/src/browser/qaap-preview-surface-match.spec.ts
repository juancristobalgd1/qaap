// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { qaapPreviewFrameMatchesUrl } from './qaap-preview-surface-match';

const ID_A = 'u-alice-w-file-wor-p-file-wor-x-11111111-abcdefgh';
const ID_B = 'u-alice-w-file-wor-p-file-wor-x-22222222-ijklmnop';

function frame(src: string): Pick<HTMLIFrameElement, 'src'> {
    return { src };
}

describe('qaap-preview-surface-match', () => {

    it('matches identical preview identities', () => {
        expect(qaapPreviewFrameMatchesUrl(
            frame(`http://ide.example/qaap-preview/${ID_A}/`),
            `http://ide.example/qaap-preview/${ID_A}/some/route`
        )).to.equal(true);
    });

    it('rejects two different preview identities even though both live on the IDE origin/port', () => {
        expect(qaapPreviewFrameMatchesUrl(
            frame(`http://ide.example:4873/qaap-preview/${ID_A}/`),
            `http://ide.example:4873/qaap-preview/${ID_B}/`
        )).to.equal(false);
    });

    it('never matches an identity URL against a port-only URL', () => {
        expect(qaapPreviewFrameMatchesUrl(
            frame(`http://ide.example:4873/qaap-preview/${ID_A}/`),
            'http://ide.example:4873/qaap-dev/3000/'
        )).to.equal(false);
        expect(qaapPreviewFrameMatchesUrl(
            frame('http://ide.example:4873/qaap-dev/3000/'),
            `http://ide.example:4873/qaap-preview/${ID_A}/`
        )).to.equal(false);
    });

    it('keeps matching legacy port proxy URLs by port', () => {
        expect(qaapPreviewFrameMatchesUrl(
            frame('http://ide.example/qaap-dev/5173/app'),
            'http://ide.example/qaap-dev/5173/'
        )).to.equal(true);
        expect(qaapPreviewFrameMatchesUrl(
            frame('http://ide.example/qaap-dev/5173/'),
            'http://ide.example/qaap-dev/5174/'
        )).to.equal(false);
    });

    it('matches direct host:port URLs by port', () => {
        expect(qaapPreviewFrameMatchesUrl(
            frame('http://localhost:5173/'),
            'http://127.0.0.1:5173/'
        )).to.equal(true);
    });

    it('falls back to origin+pathname when neither side carries identity or port', () => {
        expect(qaapPreviewFrameMatchesUrl(
            frame('http://example.com/docs'),
            'http://example.com/docs'
        )).to.equal(true);
        expect(qaapPreviewFrameMatchesUrl(
            frame('http://example.com/docs'),
            'http://example.com/other'
        )).to.equal(false);
    });

    describe('isolated origin', () => {
        const LABEL = '0123456789abcdef0123456789abcdef';
        const OTHER = 'ffffffffffffffffffffffffffffffff';

        it('matches isolated URLs by host label, never by the shared 443 port', () => {
            expect(qaapPreviewFrameMatchesUrl(
                frame(`https://${LABEL}.previews.qaap.example/cart`),
                `https://${LABEL}.previews.qaap.example/`
            )).to.equal(true);
            expect(qaapPreviewFrameMatchesUrl(
                frame(`https://${LABEL}.previews.qaap.example/`),
                `https://${OTHER}.previews.qaap.example/`
            )).to.equal(false);
            expect(qaapPreviewFrameMatchesUrl(
                frame(`https://${LABEL}.previews.qaap.example/`),
                'https://ide.example/qaap-dev/443/'
            )).to.equal(false);
        });

        it('treats the canonical identity URL and the isolated URL of one claim as the same surface', () => {
            const identityUrl = `http://ide.example/qaap-preview/${ID_A}/`;
            const isolatedUrl = `https://${LABEL}.previews.qaap.example/`;
            expect(qaapPreviewFrameMatchesUrl(frame(isolatedUrl), identityUrl)).to.equal(false);
            expect(qaapPreviewFrameMatchesUrl(frame(isolatedUrl), identityUrl, [ID_A, LABEL])).to.equal(true);
            expect(qaapPreviewFrameMatchesUrl(frame(identityUrl), isolatedUrl, [ID_A, LABEL])).to.equal(true);
            // Aliases of a claim never join an unrelated identity.
            expect(qaapPreviewFrameMatchesUrl(frame(`http://ide.example/qaap-preview/${ID_B}/`), isolatedUrl, [ID_A, LABEL]))
                .to.equal(false);
        });
    });

    it('rejects empty and about:blank frames', () => {
        expect(qaapPreviewFrameMatchesUrl(frame(''), `http://ide.example/qaap-preview/${ID_A}/`)).to.equal(false);
        expect(qaapPreviewFrameMatchesUrl(frame('about:blank'), 'http://ide.example/qaap-dev/5173/')).to.equal(false);
    });
});

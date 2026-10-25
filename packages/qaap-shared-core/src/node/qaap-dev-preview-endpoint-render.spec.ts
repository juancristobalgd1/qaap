// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Response } from '@theia/core/shared/express';
import { qaapPublicOriginFromEnv, renderUnknownPreviewHostHtml, respondUnknownPreviewHost } from './qaap-dev-preview-endpoint-render';

describe('qaap-dev-preview-endpoint-render', () => {

    describe('respondUnknownPreviewHost', () => {
        function fakeResponse(): { res: Response; sent: { status?: number; type?: string; body?: unknown } } {
            const sent: { status?: number; type?: string; body?: unknown } = {};
            const res = {
                status(code: number): unknown {
                    sent.status = code;
                    return res;
                },
                type(value: string): unknown {
                    sent.type = value;
                    return res;
                },
                send(body: unknown): void {
                    sent.body = body;
                },
            } as unknown as Response;
            return { res, sent };
        }

        it('answers 404 HTML that says the link is no longer current and links back to Qaap', () => {
            const { res, sent } = fakeResponse();
            respondUnknownPreviewHost(res, 'https://qaap.example.test');
            expect(sent.status).to.equal(404);
            expect(sent.type).to.equal('text/html');
            expect(sent.body).to.equal(renderUnknownPreviewHostHtml('https://qaap.example.test'));
        });
    });

    describe('renderUnknownPreviewHostHtml', () => {
        it('keeps the legacy "Preview not found." line and the recovery hint', () => {
            const html = renderUnknownPreviewHostHtml();
            expect(html).to.contain('<p>Preview not found.</p>');
            expect(html).to.contain('no longer current');
            expect(html).to.contain('Open the preview again from Qaap');
        });

        it('links to the Qaap origin only when one is configured', () => {
            expect(renderUnknownPreviewHostHtml('https://qaap.example.test')).to.contain('href="https://qaap.example.test"');
            expect(renderUnknownPreviewHostHtml('https://qaap.example.test')).to.contain('>Open Qaap</a>');
            expect(renderUnknownPreviewHostHtml()).to.not.contain('Open Qaap');
        });

        it('escapes the origin it links to', () => {
            const html = renderUnknownPreviewHostHtml('https://qaap.example.test"><script>x</script>');
            expect(html).to.not.contain('<script>');
            expect(html).to.contain('&quot;&gt;&lt;script&gt;');
        });
    });

    describe('qaapPublicOriginFromEnv', () => {
        it('returns the origin of an http(s) QAAP_OAUTH_PUBLIC_URL and nothing else', () => {
            expect(qaapPublicOriginFromEnv({ QAAP_OAUTH_PUBLIC_URL: 'https://qaap.example.test/some/path' })).to.equal('https://qaap.example.test');
            expect(qaapPublicOriginFromEnv({ QAAP_OAUTH_PUBLIC_URL: 'javascript:alert(1)' })).to.equal(undefined);
            expect(qaapPublicOriginFromEnv({ QAAP_OAUTH_PUBLIC_URL: 'not a url' })).to.equal(undefined);
            expect(qaapPublicOriginFromEnv({})).to.equal(undefined);
        });
    });
});

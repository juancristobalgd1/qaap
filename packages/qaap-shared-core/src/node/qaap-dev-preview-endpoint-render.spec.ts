// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Response } from '@theia/core/shared/express';
import { QAAP_PREVIEW_HOST_UNKNOWN_MESSAGE, respondUnknownPreviewHost } from './qaap-dev-preview-endpoint-render';

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

        it('answers 404 as plain text that says the link is no longer current and how to recover', () => {
            const { res, sent } = fakeResponse();
            respondUnknownPreviewHost(res);
            expect(sent.status).to.equal(404);
            expect(sent.type).to.equal('text/plain');
            expect(sent.body).to.equal(QAAP_PREVIEW_HOST_UNKNOWN_MESSAGE);
        });

        it('keeps the legacy "Preview not found." prefix and adds the recovery hint', () => {
            expect(QAAP_PREVIEW_HOST_UNKNOWN_MESSAGE.startsWith('Preview not found.\n')).to.equal(true);
            expect(QAAP_PREVIEW_HOST_UNKNOWN_MESSAGE).to.contain('no longer current');
            expect(QAAP_PREVIEW_HOST_UNKNOWN_MESSAGE).to.contain('Open the preview again');
        });
    });
});

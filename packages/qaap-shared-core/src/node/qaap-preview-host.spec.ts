// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Response } from '@theia/core/shared/express';
import { parseQaapPreviewIdFromHost, resolveQaapPreviewBaseDomain } from './qaap-preview-host';
import { advertisePreviewRouteOnJson, isQaapTenantBackendRuntime } from './qaap-dev-preview-endpoint-render';
import { QAAP_PREVIEW_ROUTE_HEADER } from '../common/qaap-preview-route';

describe('qaap-preview-host', () => {
    it('enables isolated preview hosts only with an explicit public URL', () => {
        expect(resolveQaapPreviewBaseDomain({ QAAP_PREVIEW_BASE_DOMAIN: 'preview.example.test' })).to.equal(undefined);
        expect(resolveQaapPreviewBaseDomain({ QAAP_PREVIEW_BASE_DOMAIN: 'preview.example.test', QAAP_OAUTH_PUBLIC_URL: 'https://qaap.example.test' }))
            .to.equal('preview.example.test');
    });

    it('extracts the preview id of a preview host and nothing else', () => {
        expect(parseQaapPreviewIdFromHost('u-alice-w-x-1.preview.example.test', 'preview.example.test')).to.equal('u-alice-w-x-1');
        expect(parseQaapPreviewIdFromHost('U-ALICE-W-X-1.preview.example.test:443', 'preview.example.test')).to.equal('u-alice-w-x-1');
        expect(parseQaapPreviewIdFromHost('qaap.example.test', 'preview.example.test')).to.equal(undefined);
        expect(parseQaapPreviewIdFromHost('a.b.preview.example.test', 'preview.example.test')).to.equal(undefined);
        expect(parseQaapPreviewIdFromHost('evilpreview.example.test', 'preview.example.test')).to.equal(undefined);
        expect(parseQaapPreviewIdFromHost('u-alice-w-x-1.preview.example.test', undefined)).to.equal(undefined);
    });
});

describe('advertisePreviewRouteOnJson', () => {
    function fakeResponse(): { res: Response; headers: Record<string, string>; bodies: unknown[] } {
        const headers: Record<string, string> = {};
        const bodies: unknown[] = [];
        const res = {
            headersSent: false,
            setHeader: (key: string, value: string) => { headers[key] = value; },
            json: (body: unknown) => { bodies.push(body); return res; },
        };
        return { res: res as unknown as Response, headers, bodies };
    }

    it('advertises the preview id a JSON answer hands out', () => {
        const { res, headers, bodies } = fakeResponse();
        advertisePreviewRouteOnJson(res);
        res.json({ previewId: 'u-alice-w-x-1', previewUrl: 'https://u-alice-w-x-1.preview.example.test/' });
        expect(headers[QAAP_PREVIEW_ROUTE_HEADER]).to.equal('preview:u-alice-w-x-1');
        expect(bodies).to.have.length(1);
    });

    it('adds nothing for answers without a valid preview id', () => {
        const { res, headers } = fakeResponse();
        advertisePreviewRouteOnJson(res);
        res.json({ ready: false, previewUrl: '' });
        res.json({ previewId: 'Not A Label' });
        expect(headers).to.deep.equal({});
    });

    it('is only active inside a tenant backend', () => {
        expect(isQaapTenantBackendRuntime({ QAAP_TENANT_BACKEND_MODE: '1' })).to.equal(true);
        expect(isQaapTenantBackendRuntime({})).to.equal(false);
    });
});

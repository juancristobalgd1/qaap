// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Handler, Request, Response } from '@theia/core/shared/express';
import { buildQaapPreviewHostLabel, parseQaapPreviewHostLabel, resolveQaapPreviewBaseDomain } from './qaap-preview-host';
import { advertisePreviewRouteOnJson, earlyMiddlewareExtracted, isQaapTenantBackendRuntime } from './qaap-dev-preview-endpoint-render';
import type { QaapDevPreviewEndpointContext } from './qaap-dev-preview-endpoint-context';
import { QAAP_PREVIEW_ROUTE_HEADER } from '../common/qaap-preview-route';

describe('qaap-preview-host', () => {
    it('enables isolated preview hosts only with an explicit public URL', () => {
        expect(resolveQaapPreviewBaseDomain({ QAAP_PREVIEW_BASE_DOMAIN: 'preview.example.test' })).to.equal(undefined);
        expect(resolveQaapPreviewBaseDomain({ QAAP_PREVIEW_BASE_DOMAIN: 'preview.example.test', QAAP_OAUTH_PUBLIC_URL: 'https://qaap.example.test' }))
            .to.equal('preview.example.test');
    });

    it('extracts the host label of a preview host and nothing else', () => {
        expect(parseQaapPreviewHostLabel('u-alice-w-x-1.preview.example.test', 'preview.example.test')).to.equal('u-alice-w-x-1');
        expect(parseQaapPreviewHostLabel('U-ALICE-W-X-1.preview.example.test:443', 'preview.example.test')).to.equal('u-alice-w-x-1');
        expect(parseQaapPreviewHostLabel('qaap.example.test', 'preview.example.test')).to.equal(undefined);
        expect(parseQaapPreviewHostLabel('a.b.preview.example.test', 'preview.example.test')).to.equal(undefined);
        expect(parseQaapPreviewHostLabel('evilpreview.example.test', 'preview.example.test')).to.equal(undefined);
        expect(parseQaapPreviewHostLabel('u-alice-w-x-1.preview.example.test', undefined)).to.equal(undefined);
    });

    it('derives a stable 128-bit DNS label from the preview id and its secret token', () => {
        const label = buildQaapPreviewHostLabel('u-alice-w-x-1', 'token-a');
        expect(label).to.match(/^[0-9a-f]{32}$/);
        expect(buildQaapPreviewHostLabel('u-alice-w-x-1', 'token-a')).to.equal(label);
        expect(buildQaapPreviewHostLabel('u-alice-w-x-1', 'token-b')).to.not.equal(label);
        expect(buildQaapPreviewHostLabel('u-bob-w-x-1', 'token-a')).to.not.equal(label);
        expect(parseQaapPreviewHostLabel(`${label}.preview.example.test`, 'preview.example.test')).to.equal(label);
    });
});

function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
}

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

    it('also advertises the host label of an isolated preview URL', () => {
        const priorBase = process.env.QAAP_PREVIEW_BASE_DOMAIN;
        const priorPublic = process.env.QAAP_OAUTH_PUBLIC_URL;
        process.env.QAAP_PREVIEW_BASE_DOMAIN = 'preview.example.test';
        process.env.QAAP_OAUTH_PUBLIC_URL = 'https://qaap.example.test';
        try {
            const label = buildQaapPreviewHostLabel('u-alice-w-x-1', 'secret');
            const { res, headers } = fakeResponse();
            advertisePreviewRouteOnJson(res);
            res.json({ previewId: 'u-alice-w-x-1', previewUrl: `https://${label}.preview.example.test/` });
            expect(headers[QAAP_PREVIEW_ROUTE_HEADER]).to.equal(`preview:u-alice-w-x-1, preview:${label}`);
        } finally {
            restoreEnv('QAAP_PREVIEW_BASE_DOMAIN', priorBase);
            restoreEnv('QAAP_OAUTH_PUBLIC_URL', priorPublic);
        }
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

describe('earlyMiddlewareExtracted', () => {
    type Sent = { status?: number; body?: string; headers: Record<string, string>; nextCalled: boolean; forwarded?: { port: number; path: string; prefix: string } };

    function run(handlers: Handler[], host: string, reqPath: string, ctx: Partial<QaapDevPreviewEndpointContext>): Sent {
        const sent: Sent = { headers: {}, nextCalled: false };
        const res = {
            status(code: number): unknown { sent.status = code; return res; },
            type(): unknown { return res; },
            send(body: string): unknown { sent.body = body; return res; },
            setHeader(key: string, value: string): void { sent.headers[key] = value; },
        } as unknown as Response;
        const req = { headers: { host }, path: reqPath, url: reqPath } as unknown as Request;
        let index = 0;
        const next = (): void => {
            const handler = handlers[index++];
            if (handler) {
                handler(req, res, next);
            } else {
                sent.nextCalled = true;
            }
        };
        (ctx as { forwardHttp?: unknown }).forwardHttp = (_req: Request, _res: Response, port: number, path: string, prefix: string) => {
            sent.forwarded = { port, path, prefix };
            return Promise.resolve();
        };
        next();
        return sent;
    }

    const label = buildQaapPreviewHostLabel('u-alice-w-x-1', 'secret');
    const record = { previewId: 'u-alice-w-x-1', ownerLogin: 'alice', port: 5173, accessToken: 'secret' };
    const ctx = (): Partial<QaapDevPreviewEndpointContext> => ({
        previewHostLabel: (req: Request) => parseQaapPreviewHostLabel(req.headers.host as string, 'preview.example.test'),
        portRegistry: {
            getByHostLabel: (value: string) => (value === label ? record : undefined),
            touchPreview: () => undefined,
        } as unknown as QaapDevPreviewEndpointContext['portRegistry'],
        isIdeListenPort: () => false,
    });

    it('answers isolated preview hosts before static files, at the origin root', () => {
        const context = ctx();
        const handlers = earlyMiddlewareExtracted(context as QaapDevPreviewEndpointContext);
        const served = run(handlers, `${label}.preview.example.test`, '/', context);
        expect(served.forwarded).to.deep.equal({ port: 5173, path: '/', prefix: '' });
        expect(served.nextCalled).to.equal(false);
        expect(served.headers).to.deep.equal({});
        const unknown = run(handlers, `${'0'.repeat(32)}.preview.example.test`, '/index.html', context);
        expect(unknown.status).to.equal(404);
        expect(unknown.nextCalled).to.equal(false);
    });

    it('lets main-origin requests through with the shell frame guard on the shell document only', () => {
        const context = ctx();
        const handlers = earlyMiddlewareExtracted(context as QaapDevPreviewEndpointContext);
        const shell = run(handlers, 'qaap.example.test', '/', context);
        expect(shell.nextCalled).to.equal(true);
        expect(shell.headers['X-Frame-Options']).to.equal('DENY');
        const asset = run(handlers, 'qaap.example.test', '/bundle.js', context);
        expect(asset.nextCalled).to.equal(true);
        expect(asset.headers).to.deep.equal({});
    });
});

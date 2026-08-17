// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildSameOriginDevPreviewUrl,
    canonicalPreviewHistoryKey,
    getSameOriginPreviewProxyPort,
    normalizePreviewUrlForSameOrigin,
    applyNestedPathToPreviewUrl,
    previewAppPathFromUrl,
    rebasePreviewUrlToIdentityClaim,
    resolveEffectivePreviewUrl,
    toPreviewHistoryDisplayUrl,
} from './qaap-preview-url-utils';

describe('qaap-preview-url-utils', () => {

    it('rewrites direct localhost dev ports to the qaap-dev proxy', () => {
        expect(normalizePreviewUrlForSameOrigin('http://localhost:5173/', 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/5173/');
        expect(normalizePreviewUrlForSameOrigin('http://127.0.0.1:5173/@vite/client', 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/5173/@vite/client');
    });

    it('rewrites bare localhost dev ports to the qaap-dev proxy', () => {
        expect(normalizePreviewUrlForSameOrigin('localhost:5184', 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/5184/');
        expect(normalizePreviewUrlForSameOrigin('127.0.0.1:5184/app', 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/5184/app');
    });

    it('leaves already-proxied URLs unchanged', () => {
        const proxied = 'http://localhost:3000/qaap-dev/5173/';
        expect(normalizePreviewUrlForSameOrigin(proxied, 'http://localhost:3000')).to.equal(proxied);
    });

    it('recognizes only proxy paths on the IDE origin as claim targets', () => {
        const origin = 'http://localhost:3000';
        expect(getSameOriginPreviewProxyPort(`${origin}/qaap-dev/5173/`, origin)).to.equal(5173);
        expect(getSameOriginPreviewProxyPort('https://example.com/qaap-dev/5173/', origin)).to.equal(undefined);
        expect(getSameOriginPreviewProxyPort(`${origin}/`, origin)).to.equal(undefined);
    });

    it('buildSameOriginDevPreviewUrl uses the proxy path', () => {
        expect(buildSameOriginDevPreviewUrl(5173, 'http://localhost:3000'))
            .to.equal('http://localhost:3000/qaap-dev/5173/');
    });

    it('toPreviewHistoryDisplayUrl maps proxy paths to direct localhost ports', () => {
        expect(toPreviewHistoryDisplayUrl('http://localhost:3000/qaap-dev/3001/', 'http://localhost:3000'))
            .to.equal('http://localhost:3001/');
        expect(toPreviewHistoryDisplayUrl('http://localhost:3000/qaap-dev/5173/app', 'http://localhost:3000'))
            .to.equal('http://localhost:5173/app');
    });

    it('canonicalPreviewHistoryKey dedupes proxy and direct dev URLs', () => {
        const origin = 'http://localhost:3000';
        const direct = 'http://localhost:3001/';
        const proxied = 'http://localhost:3000/qaap-dev/3001/';
        expect(canonicalPreviewHistoryKey(direct, origin))
            .to.equal(canonicalPreviewHistoryKey(proxied, origin));
    });

    it('rebases retired preview identities to the live claim without losing the app route', () => {
        const claim = 'http://localhost:3000/qaap-preview/live-execution/';
        expect(rebasePreviewUrlToIdentityClaim(
            'http://localhost:3000/qaap-preview/retired-execution/dashboard?tab=activity#latest',
            claim,
        )).to.equal('http://localhost:3000/qaap-preview/live-execution/dashboard?tab=activity#latest');
        expect(rebasePreviewUrlToIdentityClaim(
            'http://localhost:3000/qaap-dev/5173/settings',
            claim,
        )).to.equal('http://localhost:3000/qaap-preview/live-execution/settings');
        expect(rebasePreviewUrlToIdentityClaim(
            'http://127.0.0.1:5173/profile',
            claim,
        )).to.equal('http://localhost:3000/qaap-preview/live-execution/profile');
        expect(rebasePreviewUrlToIdentityClaim(
            'http://127.0.0.1:8080/docs/demo/',
            claim,
        )).to.equal('http://localhost:3000/qaap-preview/live-execution/docs/demo/');
    });

    it('pins a nested static entry onto identity and proxy roots without clobbering an app route', () => {
        expect(applyNestedPathToPreviewUrl(
            'http://localhost:3000/qaap-preview/live-execution/',
            '/docs/demo/',
        )).to.equal('http://localhost:3000/qaap-preview/live-execution/docs/demo/');
        expect(applyNestedPathToPreviewUrl(
            'http://localhost:3000/qaap-dev/8080/',
            'docs/demo',
        )).to.equal('http://localhost:3000/qaap-dev/8080/docs/demo/');
        expect(applyNestedPathToPreviewUrl(
            'http://127.0.0.1:8080/',
            '/docs/demo/',
        )).to.equal('http://127.0.0.1:8080/docs/demo/');
        expect(applyNestedPathToPreviewUrl(
            'http://localhost:3000/qaap-preview/live-execution/docs/demo/',
            '/docs/demo/',
        )).to.equal('http://localhost:3000/qaap-preview/live-execution/docs/demo/');
        expect(applyNestedPathToPreviewUrl(
            'http://localhost:3000/qaap-preview/live-execution/settings',
            '/docs/demo/',
        )).to.equal('http://localhost:3000/qaap-preview/live-execution/settings');
        expect(applyNestedPathToPreviewUrl(
            'http://localhost:3000/qaap-preview/live-execution/',
            '/',
        )).to.equal('http://localhost:3000/qaap-preview/live-execution/');
    });

    it('resolveEffectivePreviewUrl rebases remembered nested demos onto a fresh identity root', () => {
        expect(previewAppPathFromUrl('http://localhost:3000/qaap-preview/old-id/docs/demo/'))
            .to.equal('/docs/demo/');
        expect(previewAppPathFromUrl('http://localhost:3000/qaap-preview/old-id/')).to.equal(undefined);
        expect(resolveEffectivePreviewUrl({
            candidateUrl: 'http://localhost:3000/qaap-preview/new-id/',
            identityUrl: 'http://localhost:3000/qaap-preview/new-id/',
            nestedEntry: '/docs/demo/',
        })).to.equal('http://localhost:3000/qaap-preview/new-id/docs/demo/');
        expect(resolveEffectivePreviewUrl({
            candidateUrl: 'http://localhost:3000/qaap-preview/new-id/',
            identityUrl: 'http://localhost:3000/qaap-preview/new-id/',
            rememberedUrls: ['http://localhost:3000/qaap-preview/old-id/docs/demo/'],
        })).to.equal('http://localhost:3000/qaap-preview/new-id/docs/demo/');
        expect(resolveEffectivePreviewUrl({
            candidateUrl: 'http://127.0.0.1:8080/docs/demo/',
            identityUrl: 'http://localhost:3000/qaap-preview/live-execution/',
        })).to.equal('http://localhost:3000/qaap-preview/live-execution/docs/demo/');
        expect(resolveEffectivePreviewUrl({
            candidateUrl: 'http://localhost:3000/qaap-preview/live-execution/settings',
            identityUrl: 'http://localhost:3000/qaap-preview/live-execution/',
            nestedEntry: '/docs/demo/',
        })).to.equal('http://localhost:3000/qaap-preview/live-execution/settings');
    });
});

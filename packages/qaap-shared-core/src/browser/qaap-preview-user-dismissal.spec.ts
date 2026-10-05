// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import URI from '@theia/core/lib/common/uri';
import {
    QAAP_PREVIEW_USER_DISMISSED_STORAGE_KEY,
    clearQaapPreviewDismissedByUser,
    isQaapPreviewDismissedByUser,
    markQaapPreviewDismissedByUser,
} from './qaap-preview-user-dismissal';
import type { QaapProjectBootstrapServiceContext } from './qaap-project-bootstrap-service-context';

disableImportJSDOM();

describe('qaap-preview-user-dismissal', () => {

    let disableJSDOM: (() => void) | undefined;
    let timeline: typeof import('./qaap-project-bootstrap-service-timeline');
    let activity: typeof import('./qaap-project-bootstrap-service-activity');

    before(function (): void {
        this.timeout(60_000);
        disableJSDOM = enableJSDOM();
        // Same stub as the dev-run-guards spec: keep the mini-browser DI graph out of a unit test.
        const frameModule = require.resolve('@theia/qaap-adapters/lib/browser/qaap-mini-browser-preview-frame');
        require.cache[frameModule] = {
            id: frameModule,
            filename: frameModule,
            loaded: true,
            exports: { syncQaapMiniBrowserPreviewSuspension: () => undefined },
        } as NodeJS.Module;
        timeline = require('./qaap-project-bootstrap-service-timeline');
        activity = require('./qaap-project-bootstrap-service-activity');
    });

    afterEach(() => {
        window.sessionStorage.removeItem(QAAP_PREVIEW_USER_DISMISSED_STORAGE_KEY);
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    function bootstrapContext(root: string, gate?: () => boolean): QaapProjectBootstrapServiceContext {
        return {
            _descriptor: { rootUri: new URI(root) },
            previewAutoOpenGate: gate,
        } as unknown as QaapProjectBootstrapServiceContext;
    }

    it('remembers a close per project directory in sessionStorage (survives F5 in the same tab)', () => {
        markQaapPreviewDismissedByUser('/srv/users/ana/acme/shop/');
        expect(isQaapPreviewDismissedByUser('/srv/users/ana/acme/shop')).to.equal(true);
        expect(isQaapPreviewDismissedByUser('/srv/users/ana/acme/blog')).to.equal(false);
        expect(window.sessionStorage.getItem(QAAP_PREVIEW_USER_DISMISSED_STORAGE_KEY)).to.contain('shop');

        clearQaapPreviewDismissedByUser('/srv/users/ana/acme/shop');
        expect(isQaapPreviewDismissedByUser('/srv/users/ana/acme/shop')).to.equal(false);
        expect(window.sessionStorage.getItem(QAAP_PREVIEW_USER_DISMISSED_STORAGE_KEY)).to.equal(null);
    });

    it('bootstrap auto-open paths (port detected, server ready, attach) only stage once the user closed the preview', () => {
        const ctx = bootstrapContext('file:///srv/users/ana/acme/shop', () => true);
        expect(timeline.mayAutoOpenPreviewNowExtracted(ctx)).to.equal(true);

        markQaapPreviewDismissedByUser('/srv/users/ana/acme/shop');
        expect(timeline.mayAutoOpenPreviewNowExtracted(ctx)).to.equal(false);
        // Another project of the same user is not affected.
        expect(timeline.mayAutoOpenPreviewNowExtracted(bootstrapContext('file:///srv/users/ana/acme/blog'))).to.equal(true);

        clearQaapPreviewDismissedByUser('/srv/users/ana/acme/shop');
        expect(timeline.mayAutoOpenPreviewNowExtracted(ctx)).to.equal(true);
    });

    it('openPreview stages instead of navigating after a close, and an explicit open lifts the close', async () => {
        const opened: string[] = [];
        const phases: string[] = [];
        const ctx = {
            _descriptor: { rootUri: new URI('file:///srv/users/ana/acme/shop') },
            previewAutoOpenGate: undefined,
            activePreviewClaim: undefined,
            _previewUrl: undefined as string | undefined,
            extractPort: () => undefined,
            claimDevPreviewPort: async () => undefined,
            reconcileSupersededPreviewClaim: async () => undefined,
            persistPhase: () => undefined,
            setPhase: (phase: string) => { phases.push(phase); },
            syncHubSession: () => undefined,
            markPortOpened: () => undefined,
            openPreviewWidget: async (url: string) => { opened.push(url); },
            syncMiniBrowserPreviewSuspensionAfterOpen: () => undefined,
        } as unknown as QaapProjectBootstrapServiceContext;
        (ctx as unknown as { mayAutoOpenPreviewNow: () => boolean }).mayAutoOpenPreviewNow = () => timeline.mayAutoOpenPreviewNowExtracted(ctx);

        markQaapPreviewDismissedByUser('/srv/users/ana/acme/shop');
        await activity.openPreviewExtracted(ctx, 'http://127.0.0.1:5173/', true, { auto: true });
        await activity.openPreviewExtracted(ctx, 'http://127.0.0.1:5173/', true, { auto: true });
        expect(opened).to.deep.equal([]);
        expect(phases).to.deep.equal(['running', 'running']);
        expect(ctx._previewUrl).to.contain('5173');

        const opens: Event[] = [];
        const dispatch = window.dispatchEvent;
        window.dispatchEvent = (event: Event) => { opens.push(event); return true; };
        try {
            await activity.openPreviewExtracted(ctx, 'http://127.0.0.1:5173/');
        } finally {
            window.dispatchEvent = dispatch;
        }
        expect(opened).to.have.length(1);
        expect(opens.map(event => event.type)).to.deep.equal(['qaap-bootstrap-preview-opened']);
        expect(isQaapPreviewDismissedByUser('/srv/users/ana/acme/shop')).to.equal(false);
    });
});

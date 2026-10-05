// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
let disableJSDOM = enableJSDOM();
import { expect } from 'chai';
import { MiniBrowser } from '@theia/mini-browser/lib/browser/mini-browser';
import { QaapMiniBrowserOpenHandler } from './qaap-mini-browser-open-handler';
disableJSDOM();

describe('Qaap mini-browser agent preview', () => {

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    it('routes a tenant localhost URL through the tenant preview proxy', async (): Promise<void> => {
        const previewStartPages: string[] = [];
        const navigatedUrls: string[] = [];
        const previewWidget = {
            layout: {
                widgets: [{
                    forceNavigate: async (url: string): Promise<void> => {
                        navigatedUrls.push(url);
                    }
                }]
            }
        } as unknown as MiniBrowser;
        const handler = Object.create(QaapMiniBrowserOpenHandler.prototype) as QaapMiniBrowserOpenHandler;
        Object.assign(handler, {
            locationMapperService: { map: async (url: string): Promise<string> => url },
            openPreviewForProduct: async (startPage: string): Promise<MiniBrowser> => {
                previewStartPages.push(startPage);
                return previewWidget;
            }
        });

        await handler.openAgentBrowserPreview(
            'http://127.0.0.1:5173/app?mode=agent#result',
            'task-7',
            'work-hub',
        );

        const tenantPreviewUrl = `${window.location.origin}/qaap-dev/5173/app?mode=agent#result`;
        expect(previewStartPages).to.deep.equal([tenantPreviewUrl]);
        expect(navigatedUrls).to.deep.equal([tenantPreviewUrl]);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
let disableJSDOM = enableJSDOM();
import { expect } from 'chai';
import { markPreferDesktopIde, clearPreferDesktopIde } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';
import { QaapAgentBrowserPreviewContribution } from './qaap-agent-browser-preview-contribution';
disableJSDOM();

describe('Qaap agent browser preview contribution', () => {
    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM();
    });

    beforeEach(() => {
        clearPreferDesktopIde();
        document.body.innerHTML = '<div id="theia-app-shell" class="theia-mod-mobile-one-column"></div>';
    });

    afterEach(() => clearPreferDesktopIde());

    it('keeps live agent previews independent while switching Work Hub and IDE at a mobile viewport', async () => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812 });
        const opened: { url: string; taskId: string; mode: string }[] = [];
        const contribution = Object.create(QaapAgentBrowserPreviewContribution.prototype) as QaapAgentBrowserPreviewContribution;
        Object.assign(contribution, {
            miniBrowser: {
                openAgentBrowserPreview: (url: string, taskId: string, mode: string) => {
                    opened.push({ url, taskId, mode });
                    return Promise.resolve(undefined);
                },
            },
            latest: undefined,
            shown: new Map<string, string>(),
            connect: () => undefined,
        });

        const internals = contribution as unknown as {
            handleMessage(raw: unknown): void;
        };
        contribution.onStart();
        internals.handleMessage(JSON.stringify({ type: 'browser-url', taskId: 'task-7', url: 'https://example.com/docs' }));
        await new Promise(resolve => window.setTimeout(resolve, 0));
        markPreferDesktopIde();
        await new Promise(resolve => window.setTimeout(resolve, 0));
        internals.handleMessage(JSON.stringify({ type: 'browser-url', taskId: 'task-7', url: 'https://example.com/next' }));
        await new Promise(resolve => window.setTimeout(resolve, 0));
        clearPreferDesktopIde();
        await new Promise(resolve => window.setTimeout(resolve, 0));

        expect(opened).to.deep.equal([
            { url: 'https://example.com/docs', taskId: 'task-7', mode: 'work-hub' },
            { url: 'https://example.com/docs', taskId: 'task-7', mode: 'ide' },
            { url: 'https://example.com/next', taskId: 'task-7', mode: 'ide' },
            { url: 'https://example.com/next', taskId: 'task-7', mode: 'work-hub' },
        ]);
        contribution.onStop();
    });
});

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

    it('opens the same live agent URL in distinct Work Hub and IDE previews at a mobile viewport', () => {
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
        });

        const internals = contribution as unknown as {
            handleMessage(raw: unknown): void;
            showLatest(): void;
        };
        internals.handleMessage(JSON.stringify({ type: 'browser-url', taskId: 'task-7', url: 'https://example.com/docs' }));
        markPreferDesktopIde();
        internals.showLatest();

        expect(opened).to.deep.equal([
            { url: 'https://example.com/docs', taskId: 'task-7', mode: 'work-hub' },
            { url: 'https://example.com/docs', taskId: 'task-7', mode: 'ide' },
        ]);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { clearPreferDesktopIde } from '@theia/qaap-shared-core/lib/browser/mobile-projects-open';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
import { syncHeaderPreviewRunButtonExtracted } from './mobile-projects-transcript-surfaces-ui-activity';
import { QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY } from './mobile-work-hub-sessions-sidebar';

disableImportJSDOM();

describe('mobile-projects-transcript-surfaces-ui-activity', () => {

    let disableJSDOM: (() => void) | undefined;
    let originalMatchMedia: typeof window.matchMedia | undefined;
    let desktop = true;

    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    beforeEach(() => {
        clearPreferDesktopIde();
        originalMatchMedia = window.matchMedia;
        window.matchMedia = ((query: string) => ({
            matches: desktop && query === QAAP_DESKTOP_SESSIONS_SIDEBAR_MEDIA_QUERY,
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
        })) as unknown as typeof window.matchMedia;
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia!;
    });

    function runSync(): HTMLElement {
        const host = document.createElement('div');
        host.hidden = true;
        const project = { id: 'p-preview', name: 'Preview' } as MobileProjectEntry;
        const summary = { id: 'conv-preview' } as QaapAgentConversationSummaryDTO;
        const ctx = {
            host: {
                headerPreviewRunHost: host,
                transcriptOpenProject: project,
                transcriptOpenSummary: summary,
                executionSurfaceTabsUi: { executionSurfaceTabForProject: () => 'preview' },
            },
            createTranscriptPreviewRunButton: () => {
                const button = document.createElement('button');
                button.className = 'theia-mobile-transcript-preview-run';
                return button;
            },
            applyTranscriptPreviewRunButtonState: () => undefined,
            syncHeaderPreviewAppSwitchButton: () => undefined,
        } as unknown as MobileProjectsTranscriptSurfacesUiContext;
        syncHeaderPreviewRunButtonExtracted(ctx, project, summary, undefined);
        return host;
    }

    it('keeps the header play button off the desktop Work Hub, where Browser has its own toolbar', () => {
        desktop = true;
        const host = runSync();
        expect(host.hidden).to.equal(true);
        expect(host.querySelector('.theia-mobile-transcript-preview-run')).to.equal(null);
    });

    it('still shows it in the mobile layout', () => {
        desktop = false;
        const host = runSync();
        expect(host.hidden).to.equal(false);
        expect(host.querySelector('.theia-mobile-transcript-preview-run')).to.not.equal(null);
    });
});

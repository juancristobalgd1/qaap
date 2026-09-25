// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

// Modules below may touch the DOM while loading; it is removed again after the imports
// so no suite depends on another spec file leaving jsdom behind.
const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { QAAP_MCP_MARKETPLACE_PLUGINS } from './qaap-mcp-plugin-marketplace-catalog';
import { renderStickyComposerAddPluginPicker } from './qaap-sticky-composer-plugin-picker';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';

disableImportJSDOM();

describe('qaap-sticky-composer-plugin-picker', () => {

    useSuiteJSDOM();

    it('renderStickyComposerAddPluginPicker builds Cursor-style rows and footer', () => {
        const list = document.createElement('div');
        const count = renderStickyComposerAddPluginPicker({
            list,
            plugins: QAAP_MCP_MARKETPLACE_PLUGINS.slice(0, 2),
            onBack: () => undefined,
            onSelectPlugin: () => undefined,
            onBrowseMarketplace: () => undefined,
            onPickStart: () => undefined,
        });
        expect(count).to.equal(2);
        expect(list.querySelector('.theia-mobile-projects-sticky-composer-plugin-picker-title')?.textContent).to.equal('Add Plugin');
        expect(list.querySelector('.theia-mobile-projects-sticky-composer-plugin-picker-browse')?.textContent).to.equal('Browse Marketplace');
        const first = list.querySelector('.theia-mobile-projects-sticky-composer-plugin-picker-option');
        expect(first?.querySelector('.theia-mobile-projects-sticky-composer-plugin-picker-option-name')?.textContent).to.equal('Datadog');
        expect(first?.querySelector('.theia-mobile-projects-sticky-composer-plugin-picker-option-slug')?.textContent).to.equal('datadog');
        expect(first?.querySelector('.theia-mobile-projects-sticky-composer-plugin-picker-option-description')?.textContent).to.match(/Datadog/);
    });
});

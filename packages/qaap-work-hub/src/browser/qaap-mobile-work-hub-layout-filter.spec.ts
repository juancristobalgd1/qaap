// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { stripIdeRegionsFromSerializedLayout } from './qaap-mobile-work-hub-layout-filter';

describe('stripIdeRegionsFromSerializedLayout', () => {

    it('drops main panel, bottom panel and active widget but keeps side panels and version', () => {
        const input = JSON.stringify({
            version: 6,
            mainPanel: { main: { type: 'tab-area', widgets: [{ constructionOptions: { factoryId: 'code-editor-opener' } }] } },
            mainPanelPinned: [false],
            bottomPanel: { config: { main: {} }, expanded: true },
            leftPanel: { type: 'sidepanel', items: [] },
            activeWidgetId: 'terminal-1'
        });
        const out = JSON.parse(stripIdeRegionsFromSerializedLayout(input));
        expect(out).to.deep.equal({ version: 6, leftPanel: { type: 'sidepanel', items: [] } });
    });

    it('returns the input unchanged when there is nothing to strip or it is not JSON', () => {
        const plain = JSON.stringify({ version: 6 });
        expect(stripIdeRegionsFromSerializedLayout(plain)).to.equal(plain);
        expect(stripIdeRegionsFromSerializedLayout('not json')).to.equal('not json');
        expect(stripIdeRegionsFromSerializedLayout('[]')).to.equal('[]');
    });
});

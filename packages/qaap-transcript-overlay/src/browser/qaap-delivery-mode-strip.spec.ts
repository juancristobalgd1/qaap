// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { renderQaapDeliveryModeStrip } from './qaap-delivery-mode-strip';

describe('qaap-delivery-mode-strip', () => {

    before(() => {
        enableJSDOM();
    });

    it('renders queue, isolated parallel, and interrupt actions', () => {
        const chosen: string[] = [];
        const strip = renderQaapDeliveryModeStrip({
            draft: 'follow up please',
            onChoose: mode => chosen.push(mode),
            onDismiss: () => undefined,
        });
        const pills = [...strip.querySelectorAll('.qaap-delivery-mode-pill')];
        expect(pills.map(pill => pill.className)).to.include.members([
            'qaap-delivery-mode-pill theia-mod-queue',
            'qaap-delivery-mode-pill theia-mod-parallel',
            'qaap-delivery-mode-pill theia-mod-interrupt',
        ]);
        (pills.find(pill => pill.classList.contains('theia-mod-parallel')) as HTMLButtonElement).click();
        expect(chosen).to.deep.equal(['parallel']);
        expect(strip.querySelector('.qaap-delivery-mode-strip-draft')?.textContent).to.equal('follow up please');
    });
});

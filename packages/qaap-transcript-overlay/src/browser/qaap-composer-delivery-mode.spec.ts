// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import {
    QAAP_COMPOSER_DELIVERY_MODE_STORAGE_KEY,
    populateDeliveryModeToolbarButton,
    readComposerDeliveryMode,
    renderQaapDeliveryModeMenu,
    resolveBusyFollowUpDeliveryMode,
    resolveComposerEnterDeliveryOverride,
    shouldBypassLocalFollowUpQueue,
    writeComposerDeliveryMode,
} from './qaap-composer-delivery-mode';

describe('qaap-composer-delivery-mode', () => {

    before(() => {
        enableJSDOM();
    });

    beforeEach(() => {
        sessionStorage.removeItem(QAAP_COMPOSER_DELIVERY_MODE_STORAGE_KEY);
        writeComposerDeliveryMode('queue');
        sessionStorage.removeItem(QAAP_COMPOSER_DELIVERY_MODE_STORAGE_KEY);
    });

    it('persists the selected delivery mode in sessionStorage', () => {
        expect(readComposerDeliveryMode()).to.equal('queue');
        writeComposerDeliveryMode('parallel');
        expect(sessionStorage.getItem(QAAP_COMPOSER_DELIVERY_MODE_STORAGE_KEY)).to.equal('parallel');
        expect(readComposerDeliveryMode()).to.equal('parallel');
    });

    it('renders a menu that selects a mode', () => {
        const chosen: string[] = [];
        const menu = renderQaapDeliveryModeMenu({
            selected: 'queue',
            onChoose: mode => chosen.push(mode),
        });
        const options = [...menu.querySelectorAll('.qaap-delivery-mode-menu-option')];
        expect(options).to.have.length(3);
        expect(menu.querySelector('.theia-mod-queue')?.classList.contains('theia-mod-selected')).to.equal(true);
        (menu.querySelector('.theia-mod-interrupt') as HTMLButtonElement).click();
        expect(chosen).to.deep.equal(['interrupt']);
    });

    it('populates the toolbar button with the selected label', () => {
        const button = document.createElement('button');
        populateDeliveryModeToolbarButton(button, { mode: 'parallel' });
        expect(button.querySelector('.theia-mobile-projects-sticky-composer-mode-label')?.textContent).to.equal('Parallel');
        expect(button.querySelector('.codicon-chevron-down')).to.not.equal(null);
    });

    it('maps Enter modifiers to one-shot delivery overrides', () => {
        expect(resolveComposerEnterDeliveryOverride({
            key: 'Enter', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false,
        })).to.equal(undefined);
        expect(resolveComposerEnterDeliveryOverride({
            key: 'Enter', shiftKey: true, altKey: false, metaKey: false, ctrlKey: false,
        })).to.equal('parallel');
        expect(resolveComposerEnterDeliveryOverride({
            key: 'Enter', shiftKey: false, altKey: false, metaKey: true, ctrlKey: false,
        })).to.equal('interrupt');
        expect(resolveComposerEnterDeliveryOverride({
            key: 'Enter', shiftKey: false, altKey: false, metaKey: false, ctrlKey: true,
        })).to.equal('interrupt');
        expect(resolveComposerEnterDeliveryOverride({
            key: 'a', shiftKey: true, altKey: false, metaKey: false, ctrlKey: false,
        })).to.equal(undefined);
    });

    it('bypasses the local queue only for parallel and interrupt', () => {
        expect(shouldBypassLocalFollowUpQueue('queue')).to.equal(false);
        expect(shouldBypassLocalFollowUpQueue('parallel')).to.equal(true);
        expect(shouldBypassLocalFollowUpQueue('interrupt')).to.equal(true);
        expect(resolveBusyFollowUpDeliveryMode({})).to.equal('queue');
        expect(resolveBusyFollowUpDeliveryMode({ selectedDeliveryMode: 'interrupt' })).to.equal('interrupt');
        expect(resolveBusyFollowUpDeliveryMode({
            forceDeliveryMode: 'parallel',
            selectedDeliveryMode: 'interrupt',
        })).to.equal('parallel');
    });
});

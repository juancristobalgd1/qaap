// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import type { MenuDto } from '@theia/core/lib/electron-common/electron-api';
import type { QaapWorkHubElectronMainMenuFactory as MenuFactoryType } from './qaap-work-hub-electron-main-menu-factory';

describe('QaapWorkHubElectronMainMenuFactory', () => {

    it('titles the macOS application menu with the product name, not «Theia»', () => {
        // The upstream core module touches `document` while loading, so the factory is required inside the jsdom window.
        const disableJSDOM = enableJSDOM();
        try {
            const { QaapWorkHubElectronMainMenuFactory } = require('./qaap-work-hub-electron-main-menu-factory') as {
                QaapWorkHubElectronMainMenuFactory: typeof MenuFactoryType;
            };
            class TestableMenuFactory extends QaapWorkHubElectronMainMenuFactory {
                osxMenu(): MenuDto {
                    return this.createOSXMenu();
                }
            }
            FrontendApplicationConfigProvider.set({ applicationName: 'Qaap' });
            const menu = new TestableMenuFactory().osxMenu();
            expect(menu.label).to.equal('Qaap');
            expect(menu.submenu?.some(item => item.role === 'about')).to.equal(true);
        } finally {
            disableJSDOM();
        }
    });
});

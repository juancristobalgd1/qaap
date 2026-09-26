// *****************************************************************************
// Copyright (C) 2026 Qaap and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ElementHandle } from '@playwright/test';
import { TheiaMainMenu, TheiaMenuBar } from './theia-main-menu';
import { normalizeId } from './util';

/** Marks the Lumino menu opened from the "Open menu" button (root: File, Edit, ...). */
const QAAP_ROOT_MENU_CLASS = 'qaap-playwright-root-menu';
/** Marks the submenu of the root menu that `openMenu(name)` opened (e.g. the File menu). */
const QAAP_MAIN_MENU_CLASS = 'qaap-playwright-main-menu';

/**
 * Qaap: the submenu opened through {@link QaapMenuBar.openMenu}. Upstream's `TheiaMainMenu` targets
 * `.lm-MenuBar-menu`, which only exists for menus opened from the horizontal menubar.
 */
export class QaapMainMenu extends TheiaMainMenu {
    override selector = `.lm-Menu.${QAAP_MAIN_MENU_CLASS}`;
}

/**
 * Qaap: drives the main menu through the top-bar "Open menu" button (`#theia:workbench-menu-button`)
 * that replaces the horizontal `#theia:menubar` on the classic IDE surface. The button opens the
 * `MAIN_MENU_BAR` model as a context menu whose items are the top-level menus (File, Edit, ...);
 * `openMenu(name)` expands one of them and returns it as a {@link TheiaMainMenu}, so the upstream
 * specs and page objects that go through `app.menuBar` work unchanged.
 */
export class QaapMenuBar extends TheiaMenuBar {
    override selector = normalizeId('#theia:workbench-menu-button');

    protected readonly toggleSelector = `${this.selector} button.theia-workbench-menu-toggle`;
    protected readonly rootMenuSelector = `.lm-Menu.${QAAP_ROOT_MENU_CLASS}`;

    override async waitForVisible(): Promise<void> {
        await this.page.waitForSelector(this.toggleSelector, { state: 'visible' });
    }

    override async openMenu(menuName: string): Promise<TheiaMainMenu> {
        const rootItem = await this.openRootMenuItem(menuName);
        await rootItem.hover();
        await rootItem.click();
        const submenu = await this.page.waitForFunction(rootClass => {
            const menus = Array.from(document.querySelectorAll('body > .lm-Menu'));
            const rootIndex = menus.findIndex(menu => menu.classList.contains(rootClass));
            return rootIndex >= 0 && menus.length > rootIndex + 1 ? menus[menus.length - 1] : undefined;
        }, QAAP_ROOT_MENU_CLASS);
        await submenu.evaluate((menu, mainClass) => (menu as HTMLElement).classList.add(mainClass), QAAP_MAIN_MENU_CLASS);
        const mainMenu = new QaapMainMenu(this.app);
        await mainMenu.waitForVisible();
        return mainMenu;
    }

    override async visibleMenuBarItems(): Promise<string[]> {
        await this.openRootMenu();
        const labels = await this.page.$$eval(`${this.rootMenuSelector} > .lm-Menu-content > .lm-Menu-item .lm-Menu-itemLabel`,
            elements => elements.map(element => element.textContent ?? ''));
        await this.closeMenus();
        return labels.filter(label => label.length > 0);
    }

    protected override menubarElementHandle(): Promise<ElementHandle<SVGElement | HTMLElement> | null> {
        return this.page.$(this.toggleSelector);
    }

    protected async openRootMenu(): Promise<void> {
        await this.waitForVisible();
        await this.closeMenus();
        await this.page.click(this.toggleSelector);
        const rootMenu = await this.page.waitForSelector('body > .lm-Menu', { state: 'visible' });
        await rootMenu.evaluate((menu, rootClass) => menu.classList.add(rootClass), QAAP_ROOT_MENU_CLASS);
    }

    protected async openRootMenuItem(menuName: string): Promise<ElementHandle<SVGElement | HTMLElement>> {
        await this.openRootMenu();
        const label = await this.page.waitForSelector(`${this.rootMenuSelector} .lm-Menu-itemLabel >> text="${menuName}"`);
        const item = await label.$('xpath=..');
        if (!item) {
            throw new Error(`Menu '${menuName}' not found!`);
        }
        return item;
    }

    /** Close the whole menu stack (same outside click as upstream `TheiaMenu.close()`). */
    protected async closeMenus(): Promise<void> {
        if (await this.page.$('.lm-Menu')) {
            await this.page.mouse.click(0, 0);
            await this.page.waitForSelector('.lm-Menu', { state: 'detached' });
        }
    }
}

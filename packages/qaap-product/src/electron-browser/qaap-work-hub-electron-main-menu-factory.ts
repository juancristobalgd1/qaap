// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { CommandMenu, MenuNode, MenuPath } from '@theia/core/lib/common';
import { ContextMatcher } from '@theia/core/lib/browser/context-key-service';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { ElectronMainMenuFactory, ElectronMenuOptions } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import { MenuDto } from '@theia/core/lib/electron-common/electron-api';
import { peekPreferDesktopIde } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';
import { isWorkHubNativeMenuNodeVisible } from './qaap-work-hub-native-menu-filter';

/**
 * Electron menu factory that trims the native menu bar while the Work Hub is the active surface.
 *
 * `fillMenuTemplate` recurses through the menu tree and is the single place where every node is turned
 * into a native item, so filtering there covers the top-level menus, their groups and their commands.
 * Only the `menubar` tree is filtered; context menus and the IDE surface keep the upstream output.
 */
@injectable()
export class QaapWorkHubElectronMainMenuFactory extends ElectronMainMenuFactory {

    protected override fillMenuTemplate(parentItems: MenuDto[],
        menuPath: MenuPath,
        menu: MenuNode,
        args: unknown[] = [],
        contextMatcher: ContextMatcher,
        options: ElectronMenuOptions,
        skipRoot: boolean
    ): MenuDto[] {
        if (this.isHiddenOnWorkHub(menuPath, menu)) {
            return parentItems;
        }
        return super.fillMenuTemplate(parentItems, menuPath, menu, args, contextMatcher, options, skipRoot);
    }

    /** The macOS application menu is titled with the product name (upstream hard-codes «Theia»). */
    protected override createOSXMenu(): MenuDto {
        return { ...super.createOSXMenu(), label: FrontendApplicationConfigProvider.get().applicationName };
    }

    /** True while the Work Hub is the active surface (the classic IDE is not the preferred one). */
    protected isWorkHubSurface(): boolean {
        return !peekPreferDesktopIde();
    }

    protected isHiddenOnWorkHub(menuPath: MenuPath, menu: MenuNode): boolean {
        if (!this.isWorkHubSurface()) {
            return false;
        }
        return !isWorkHubNativeMenuNodeVisible(menuPath, menu.id, CommandMenu.is(menu));
    }
}

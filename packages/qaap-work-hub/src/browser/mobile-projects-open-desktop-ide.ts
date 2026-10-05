// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import type { MobileProjectsPanelContext } from './mobile-projects-panel-context';
import {
    QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE,
    QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND,
} from './qaap-workbench-account-menu';
import { isQaapMobileDevice } from '@theia/qaap-mobile-shell/lib/common/qaap-mobile-device';

/** Desktop IDE entry from the Work Hub. A mobile tap leaves the Work Hub in place. */
export async function openDesktopIdeFromAgentsHubExtracted(ctx: MobileProjectsPanelContext): Promise<void> {
    if (isQaapMobileDevice()) {
        return;
    }
    if (ctx.commands.getCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)
        && ctx.commands.isEnabled(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE)) {
        await ctx.commands.executeCommand(QAAP_MOBILE_IDE_HEADER_VIEW_ACTIVATE, 'editor');
        ctx.hide();
        return;
    }
    if (!ctx.commands.getCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)
        || !ctx.commands.isEnabled(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)) {
        return;
    }
    await ctx.commands.executeCommand(QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND);
    ctx.hide();
}

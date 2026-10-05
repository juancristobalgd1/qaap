// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Command } from '@theia/core/lib/common/command';
import { QuickCommandService } from '@theia/core/lib/browser/quick-input/quick-command-service';
import { peekPreferDesktopIde } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';
import { isQaapMobileDevice } from '@theia/qaap-mobile-shell/lib/common/qaap-mobile-device';
import { QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND } from './qaap-workbench-account-menu';
import { isWorkHubCommandPaletteCommand } from '../common/qaap-work-hub-command-palette';

/**
 * Surface-aware command palette.
 *
 * - Classic IDE (`preferDesktopIde`): full Theia command list.
 * - Work Hub (default): only commands relevant to the hub (Qaap surface commands
 *   plus a small shared allowlist such as Color Theme / AI Configuration).
 */
@injectable()
export class QaapQuickCommandService extends QuickCommandService {

    protected override getValidCommands(raw: Command[]): Command[] {
        const valid = super.getValidCommands(raw);
        const mobile = isQaapMobileDevice();
        if (peekPreferDesktopIde()) {
            return mobile
                ? valid.filter(command => command.id !== QAAP_MOBILE_OPEN_DESKTOP_IDE_COMMAND)
                : valid;
        }
        return valid.filter(command => isWorkHubCommandPaletteCommand(command, { mobile }));
    }
}

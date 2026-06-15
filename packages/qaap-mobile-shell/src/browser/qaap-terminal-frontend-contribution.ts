// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { TerminalFrontendContribution } from '@theia/terminal/lib/browser/terminal-frontend-contribution';
import { shouldDeferTerminalLayoutInit } from './qaap-defer-terminal-layout-init';

export { shouldDeferTerminalLayoutInit } from './qaap-defer-terminal-layout-init';

@injectable()
export class QaapTerminalFrontendContribution extends TerminalFrontendContribution {

    override async initializeLayout(): Promise<void> {
        if (shouldDeferTerminalLayoutInit()) {
            return;
        }
        await super.initializeLayout();
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { ScmContribution } from '@theia/scm/lib/browser/scm-contribution';
import { shouldDeferWorkHubIdeLayoutInit } from './qaap-defer-terminal-layout-init';

/** Defer SCM view creation on Work Hub boot; openView registers it when the user opens Source Control. */
@injectable()
export class QaapScmContribution extends ScmContribution {

    override async initializeLayout(): Promise<void> {
        if (shouldDeferWorkHubIdeLayoutInit()) {
            return;
        }
        await super.initializeLayout();
    }
}

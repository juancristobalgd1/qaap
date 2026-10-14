// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Preloader } from '@theia/core/lib/browser/preload/preloader';
import { QaapMobileBootBudget } from './qaap-mobile-boot-budget';

/**
 * On a phone booting into the Work Hub, preload no longer waits for the backend (backend OS and
 * localization lookups): each contribution gets the boot budget and finishes in the background.
 * The client defaults (frontend OS, English) hold until the answers arrive.
 */
@injectable()
export class QaapPreloader extends Preloader {

    @inject(QaapMobileBootBudget)
    protected readonly bootBudget: QaapMobileBootBudget;

    override async initialize(): Promise<void> {
        if (!this.bootBudget.applies()) {
            return super.initialize();
        }
        await Promise.allSettled(this.contributions.getContributions().map(contribution =>
            this.bootBudget.settleWithinBudget(`${contribution.constructor.name}.initialize`, () => contribution.initialize())
        ));
    }
}

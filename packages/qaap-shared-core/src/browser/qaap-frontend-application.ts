// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { MaybePromise } from '@theia/core/lib/common/types';
import { QaapMobileBootBudget } from './qaap-mobile-boot-budget';

/**
 * Upstream attaches the shell only after every contribution's initialize / configure / onStart
 * settled, and removes the startup splash only after the layout restore (which needs the
 * workspace, i.e. the backend). On a waking tenant both keep the Work Hub, which renders from
 * client caches, off screen for seconds. On a phone booting into the Work Hub:
 *  - each startup hook gets the boot budget; slower hooks finish in the background;
 *  - the splash is removed when the shell is attached, so the login gate's skeleton hands over to
 *    the Work Hub directly while the layout restore still waits for the backend.
 * Bound by the mobile entry only.
 */
@injectable()
export class QaapFrontendApplication extends FrontendApplication {

    @inject(QaapMobileBootBudget)
    protected readonly bootBudget: QaapMobileBootBudget;

    /** Decided once, when contributions start (the boot guard is lifted later during startup). */
    protected budgetedStartup = false;

    protected override async startContributions(): Promise<void> {
        this.budgetedStartup = this.bootBudget.applies();
        return super.startContributions();
    }

    protected override async measureContribution<T>(
        contribution: FrontendApplicationContribution, hook: string, fn: () => MaybePromise<T>
    ): Promise<T> {
        // Only the startup hooks (state 'init'); onDidInitializeLayout keeps upstream waiting.
        if (!this.budgetedStartup || this.stateService.state !== 'init') {
            return super.measureContribution(contribution, hook, fn);
        }
        return super.measureContribution(contribution, hook,
            () => this.bootBudget.settleWithinBudget(`${contribution.constructor.name}.${hook}`, fn) as Promise<T>);
    }

    protected override attachShell(host: HTMLElement): void {
        super.attachShell(host);
        if (this.budgetedStartup) {
            // Drop the splash in the same task that attaches the shell (with the Work Hub), not
            // after the layout restore: the login gate's skeleton stays on top until the Work Hub
            // has painted, so the screen goes skeleton -> Work Hub without a logo in between. The
            // later upstream revealShell finds no splash and returns at once.
            this.getStartupIndicator(host)?.remove();
        }
    }
}

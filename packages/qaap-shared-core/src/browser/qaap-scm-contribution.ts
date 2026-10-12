// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { injectable } from '@theia/core/shared/inversify';
import { OpenViewArguments } from '@theia/core/lib/browser/shell/view-contribution';
import { ScmWidget } from '@theia/scm/lib/browser/scm-widget';
import { ScmContribution } from '@theia/scm/lib/browser/scm-contribution';
import { shouldDeferWorkHubIdeLayoutInit } from './qaap-defer-terminal-layout-init';

/** Defer SCM view creation on Work Hub boot; openView registers it when the user opens Source Control. */
@injectable()
export class QaapScmContribution extends ScmContribution {

    /** Mobile mode never opens the IDE Source Control view; the hub Changes tab replaces it. */
    override async openView(args: Partial<OpenViewArguments> = {}): Promise<ScmWidget> {
        if (matchesMobileOneColumnLayout()) {
            return this.widgetManager.getOrCreateWidget<ScmWidget>(this.options.viewContainerId || this.viewId);
        }
        return super.openView(args);
    }

    override async initializeLayout(): Promise<void> {
        if (shouldDeferWorkHubIdeLayoutInit()) {
            return;
        }
        await super.initializeLayout();
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { matchesMobileOneColumnLayout } from '@theia/core/lib/browser/shell/mobile-layout-state';
import { ShellLayoutRestorer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { peekPreferDesktopIde } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';
import { stripIdeRegionsFromSerializedLayout } from './qaap-mobile-work-hub-layout-filter';

/**
 * On the mobile Work Hub surface the persisted IDE regions (editors, terminals) are not inflated at
 * startup: widgets are created while the layout is inflated, so the filter has to run before
 * `super.inflate`. Once the user explicitly opens the IDE ({@link peekPreferDesktopIde}) layout
 * handling is the upstream behaviour. While the restore was skipped the layout is not re-persisted,
 * so the previously saved IDE layout is not overwritten by the empty one.
 */
@injectable()
export class QaapShellLayoutRestorer extends ShellLayoutRestorer {

    protected ideRestoreSkipped = false;

    protected shouldSkipIdeRestore(): boolean {
        return matchesMobileOneColumnLayout() && !peekPreferDesktopIde();
    }

    protected override async inflate(layoutData: string): Promise<ApplicationShell.LayoutData> {
        if (this.shouldSkipIdeRestore()) {
            this.ideRestoreSkipped = true;
            return super.inflate(stripIdeRegionsFromSerializedLayout(layoutData));
        }
        return super.inflate(layoutData);
    }

    override storeLayout(app: FrontendApplication): void {
        if (this.ideRestoreSkipped && !peekPreferDesktopIde()) {
            return;
        }
        super.storeLayout(app);
    }
}

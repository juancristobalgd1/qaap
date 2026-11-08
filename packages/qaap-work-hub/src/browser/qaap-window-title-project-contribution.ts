// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { QaapProjectBootstrapService } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-service';
import { QaapWorkspaceService } from '@theia/qaap-shared-core/lib/browser/qaap-workspace-service';

/**
 * Names the window after the project the Work Hub pinned (`vyyq - Preview`), not the open workspace.
 *
 * The Work Hub can show another project than the one Theia has open, so the title follows the
 * bootstrap's pinned root, and falls back to the workspace name when nothing is pinned.
 */
@injectable()
export class QaapWindowTitleProjectContribution implements FrontendApplicationContribution {

    @inject(QaapProjectBootstrapService)
    protected readonly bootstrap: QaapProjectBootstrapService;

    @inject(QaapWorkspaceService)
    protected readonly workspaceService: QaapWorkspaceService;

    onStart(_app: FrontendApplication): void {
        this.workspaceService.setHubProjectRoot(this.bootstrap.hubPinnedWorkspaceRoot);
        this.bootstrap.onDidChangeHubProjectRoot(root => this.workspaceService.setHubProjectRoot(root));
    }

}

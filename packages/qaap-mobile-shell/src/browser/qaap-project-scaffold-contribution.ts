// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { consumeQaapPendingComposerDraft } from '../common/qaap-project-scaffold-pending';
import { QaapProjectBootstrapService } from './qaap-project-bootstrap-service';
import { QaapProjectScaffoldService } from './qaap-project-scaffold-service';

/**
 * Applies pending Vite scaffolds after "Start new project" opens an empty workspace.
 */
@injectable()
export class QaapProjectScaffoldContribution implements FrontendApplicationContribution {

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    @inject(QaapProjectScaffoldService)
    protected readonly scaffoldService: QaapProjectScaffoldService;

    @inject(QaapProjectBootstrapService)
    protected readonly bootstrapService: QaapProjectBootstrapService;

    onStart(): void {
        this.workspaceService.onWorkspaceChanged(() => {
            void this.applyPendingScaffold();
        });
        this.workspaceService.onWorkspaceLocationChanged(() => {
            void this.applyPendingScaffold();
        });
        void this.applyPendingScaffold();
    }

    protected async applyPendingScaffold(): Promise<void> {
        const applied = await this.scaffoldService.applyPendingScaffoldIfNeeded();
        if (!applied) {
            return;
        }
        await this.bootstrapService.refreshFromCurrentWorkspace();
        const draft = consumeQaapPendingComposerDraft();
        if (draft && typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem('qaap.mobileProjects.pendingStickyComposerDraft', draft);
        }
    }
}

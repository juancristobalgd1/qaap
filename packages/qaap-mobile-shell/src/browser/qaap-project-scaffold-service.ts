// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import {
    clearQaapProjectScaffoldOnOpen,
    peekQaapProjectScaffoldOnOpen,
    stageQaapPendingComposerDraft,
} from '../common/qaap-project-scaffold-pending';
import { resolveQaapProjectScaffoldTemplate } from '../common/qaap-project-scaffold-templates';

/**
 * Writes a minimal Vite scaffold into an empty workspace after "Start new project".
 */
@injectable()
export class QaapProjectScaffoldService {

    @inject(FileService)
    protected readonly fileService: FileService;

    @inject(WorkspaceService)
    protected readonly workspaceService: WorkspaceService;

    protected applying = false;

    /** Apply a pending scaffold when the workspace root has no package.json yet. */
    async applyPendingScaffoldIfNeeded(): Promise<boolean> {
        if (this.applying) {
            return false;
        }
        const templateId = peekQaapProjectScaffoldOnOpen();
        if (!templateId) {
            return false;
        }
        const roots = this.workspaceService.tryGetRoots();
        const root = roots[0]?.resource;
        if (!root) {
            return false;
        }
        const packageJson = root.resolve('package.json');
        if (await this.fileService.exists(packageJson)) {
            clearQaapProjectScaffoldOnOpen();
            return false;
        }
        const template = resolveQaapProjectScaffoldTemplate(templateId);
        if (!template) {
            clearQaapProjectScaffoldOnOpen();
            return false;
        }
        this.applying = true;
        try {
            for (const [relativePath, content] of Object.entries(template.files)) {
                const resource = root.resolve(relativePath);
                const parent = resource.parent;
                if (parent && !await this.fileService.exists(parent)) {
                    await this.fileService.createFolder(parent);
                }
                await this.fileService.write(resource, content);
            }
            stageQaapPendingComposerDraft(template.composerPrompt);
            clearQaapProjectScaffoldOnOpen();
            return true;
        } finally {
            this.applying = false;
        }
    }

    async isWorkspaceEmpty(root: URI): Promise<boolean> {
        const packageJson = root.resolve('package.json');
        return !await this.fileService.exists(packageJson);
    }
}

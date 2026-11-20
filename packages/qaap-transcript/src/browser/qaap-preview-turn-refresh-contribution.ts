// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { QaapPreviewSurfaceRegistry, type QaapPreviewSurfaceHandle } from '@theia/qaap-adapters/lib/browser/qaap-preview-surface-registry';
import { MobileProjectsConversations } from '@theia/qaap-shared-core/lib/browser/mobile-projects-conversations';
import { QaapProjectBootstrapService } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-service';
import {
    QAAP_PREVIEW_CHANGE_WALK_MAX_DEPTH,
    QAAP_PREVIEW_CHANGE_WALK_MAX_ENTRIES,
    classifyQaapPreviewTurnRefresh,
    isQaapPreviewIgnoredPath,
    resolveQaapPreviewDevScript,
    type QaapPreviewTurnRefreshAction,
} from '@theia/qaap-shared-core/lib/common/qaap-preview-turn-refresh';
import { QaapPreviewTurnRefreshScheduler } from '../common/qaap-preview-turn-refresh-scheduler';
import { applyQaapPreviewTurnRefresh, isQaapPreviewTurnRefreshSameProject } from './qaap-preview-turn-refresh-apply';

/**
 * After an agent turn changes the project, bring the open preview up to date without a manual
 * Hard Reload: restart the Qaap-managed dev server when server code changed (unless it restarts
 * itself), then reload every surface showing the project preview on the page it was on. Dev
 * servers with their own HMR / live reload are left alone.
 */
@injectable()
export class QaapPreviewTurnRefreshContribution implements FrontendApplicationContribution {

    @inject(MobileProjectsConversations)
    protected readonly conversations: MobileProjectsConversations;

    @inject(QaapProjectBootstrapService)
    protected readonly bootstrap: QaapProjectBootstrapService;

    @inject(QaapPreviewSurfaceRegistry)
    protected readonly previewSurfaces: QaapPreviewSurfaceRegistry;

    @inject(FileService)
    protected readonly fileService: FileService;

    protected readonly scheduler = new QaapPreviewTurnRefreshScheduler({
        now: () => Date.now(),
        setTimer: (callback, ms) => window.setTimeout(callback, ms),
        clearTimer: handle => window.clearTimeout(handle as number),
        run: (cwd, since) => this.refreshAfterTurn(cwd, since),
    });

    onStart(): void {
        this.conversations.start();
        this.conversations.onDidChangeDetail(event => {
            if (event.kind === 'snapshot' || event.kind === 'created' || event.changedFields?.includes('status')) {
                this.scheduler.observe(this.conversations.listAllSummaries());
            }
        });
    }

    onStop(): void {
        this.scheduler.dispose();
    }

    protected async refreshAfterTurn(cwd: string, since: number): Promise<void | 'defer'> {
        const previewUrl = this.bootstrap.previewUrl;
        const descriptor = this.bootstrap.descriptor;
        const plan = this.bootstrap.resolveDevPlan();
        const root = plan?.cwd ?? descriptor?.rootUri;
        // No open preview: the next start loads fresh code anyway.
        if (!previewUrl || !root || !this.isSameProject(root, cwd)) {
            return;
        }
        const surfaces = this.previewSurfaces.getSurfacesForPreviewUrl(previewUrl, [this.bootstrap.previewId]);
        if (this.inFrameCaptureMayRun(cwd, previewUrl)) {
            return 'defer';
        }
        const changed = await this.listChangedFiles(root, since);
        const devCommand = [plan?.command, await this.readDevScript(root)].filter(Boolean).join(' ');
        const action = classifyQaapPreviewTurnRefresh(changed, devCommand);
        await this.applyRefresh(action, surfaces);
    }

    protected applyRefresh(action: QaapPreviewTurnRefreshAction, surfaces: readonly QaapPreviewSurfaceHandle[]): Promise<void> {
        return applyQaapPreviewTurnRefresh(action, surfaces, this.bootstrap);
    }

    /** The in-frame (same-origin) visual capture navigates the preview itself: wait for it to finish. */
    protected inFrameCaptureMayRun(cwd: string, previewUrl: string): boolean {
        let sameOrigin = false;
        try {
            sameOrigin = new URL(previewUrl, window.location.href).origin === window.location.origin;
        } catch {
            sameOrigin = false;
        }
        return sameOrigin && this.conversations.listAllSummaries()
            .some(summary => summary.cwd === cwd && summary.visualVerificationPending === true);
    }

    protected isSameProject(root: URI, cwd: string): boolean {
        return isQaapPreviewTurnRefreshSameProject(root, cwd);
    }

    protected async readDevScript(root: URI): Promise<string | undefined> {
        try {
            const content = await this.fileService.read(root.resolve('package.json'));
            return resolveQaapPreviewDevScript(JSON.parse(content.value));
        } catch {
            return undefined;
        }
    }

    /** Project files modified since `since` (relative paths), from a bounded walk. */
    protected async listChangedFiles(root: URI, since: number): Promise<string[]> {
        const changed: string[] = [];
        let visited = 0;
        const walk = async (dir: URI, relative: string, depth: number): Promise<void> => {
            if (depth > QAAP_PREVIEW_CHANGE_WALK_MAX_DEPTH || visited >= QAAP_PREVIEW_CHANGE_WALK_MAX_ENTRIES) {
                return;
            }
            let children;
            try {
                children = (await this.fileService.resolve(dir, { resolveMetadata: true })).children ?? [];
            } catch {
                return;
            }
            for (const child of children) {
                if (++visited > QAAP_PREVIEW_CHANGE_WALK_MAX_ENTRIES) {
                    return;
                }
                const childRelative = relative ? `${relative}/${child.name}` : child.name;
                if (isQaapPreviewIgnoredPath(childRelative)) {
                    continue;
                }
                if (child.isDirectory) {
                    await walk(child.resource, childRelative, depth + 1);
                } else if (child.isFile && (child.mtime ?? 0) > since) {
                    changed.push(childRelative);
                }
            }
        };
        await walk(root, '', 0);
        return changed;
    }
}

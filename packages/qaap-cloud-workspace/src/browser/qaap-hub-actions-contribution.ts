// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MobileProjectEntry } from '@theia/qaap-mobile-shell/lib/browser/mobile-projects-types';
import { MobileProjectsService } from '@theia/qaap-mobile-shell/lib/browser/mobile-projects-service';
import { QaapProjectBootstrapService } from '@theia/qaap-mobile-shell/lib/browser/qaap-project-bootstrap-service';
import { ensureTranscriptDevPreview, extractDevPreviewPortFromUrl } from '@theia/qaap-mobile-shell/lib/browser/qaap-transcript-preview-bootstrap';
import { probeQaapDevPreviewPort } from '@theia/qaap-mobile-shell/lib/browser/qaap-dev-preview-client';
import { QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND } from '@theia/qaap-mobile-shell/lib/common/qaap-work-hub-composer-prompt';
import type { QaapPreviewWidgetKey } from '@theia/qaap-adapters/lib/browser/qaap-preview-widget-uri';
import { qaapHubPreviewWidgetKeyFromProject } from './qaap-hub-resume-preview';

export const QAAP_HUB_RESUME_PREVIEW_COMMAND_ID = 'qaap.hub.resumePreview';

const QAAP_HUB_PENDING_ACTION_KEY = 'qaap.hub.pendingAction';

type QaapHubPendingActionKind = 'resumePreview' | 'openAgentOnTask';

interface QaapHubPendingAction {
    readonly kind: QaapHubPendingActionKind;
    readonly targetKey?: string;
    readonly previewUrl?: string;
    readonly workspaceId?: string;
    readonly projectId?: string;
    readonly task?: string;
}

export namespace QaapHubCommands {
    export const RESUME_PREVIEW: Command = {
        id: QAAP_HUB_RESUME_PREVIEW_COMMAND_ID,
        label: nls.localize('qaap/hub/resumePreview', 'Resume preview'),
    };
}

@injectable()
export class QaapHubActionsContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(MobileProjectsService)
    protected readonly projects: MobileProjectsService;

    @inject(QaapProjectBootstrapService)
    protected readonly bootstrap: QaapProjectBootstrapService;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(QaapHubCommands.RESUME_PREVIEW, {
            execute: (project?: MobileProjectEntry) => this.resumePreview(project),
            isEnabled: () => true,
        });
    }

    onDidInitializeLayout(): void {
        void this.resumePendingAction();
    }

    protected async resumePreview(project?: MobileProjectEntry): Promise<void> {
        if (!this.ensureProjectReady('resumePreview', project)) {
            return;
        }
        await this.doResumePreview(project?.previewUrl, qaapHubPreviewWidgetKeyFromProject(project ?? {}));
    }

    protected async doResumePreview(previewUrl?: string, key?: QaapPreviewWidgetKey): Promise<void> {
        const port = extractDevPreviewPortFromUrl(previewUrl);
        if (port !== undefined) {
            const probe = await probeQaapDevPreviewPort(port);
            if (probe.ready) {
                try {
                    await this.openResumedPreview(probe.previewUrl, key
                        ?? qaapHubPreviewWidgetKeyFromProject({
                            workspaceId: probe.workspaceId,
                            projectId: probe.projectId,
                        }));
                    return;
                } catch {
                    /* fall through to bootstrap */
                }
            }
        }
        const readyUrl = await ensureTranscriptDevPreview(this.bootstrap, { previewUrlHint: previewUrl, portHint: port });
        if (readyUrl) {
            try {
                await this.openResumedPreview(readyUrl, key);
                return;
            } catch {
                /* fall through */
            }
        }
        await this.bootstrap.focusPreview();
    }

    /**
     * Opens the resumed URL in the **project** preview tab. Never use bare `mini-browser.openUrl`:
     * that command still maps to the legacy singleton widget and two projects would share one iframe.
     */
    protected async openResumedPreview(url: string, key?: QaapPreviewWidgetKey): Promise<void> {
        if (key) {
            await this.commands.executeCommand('mini-browser.openUrl', url, key);
            return;
        }
        await this.bootstrap.openPreview(url);
    }

    protected ensureProjectReady(kind: QaapHubPendingActionKind, project?: MobileProjectEntry): boolean {
        if (!project || this.projects.projectMatchesCurrentWorkspace(project)) {
            return true;
        }
        const targetKey = this.projects.getProjectWorkspaceMatchKey(project);
        if (targetKey) {
            this.writePendingAction({
                kind,
                targetKey,
                previewUrl: project.previewUrl,
                workspaceId: project.uri?.toString(),
                projectId: project.uri?.toString() ?? project.id,
                task: project.task?.trim(),
            });
            this.projects.openInCurrentWindow(project);
            return false;
        }
        return true;
    }

    protected async resumePendingAction(): Promise<void> {
        const pending = this.readPendingAction();
        if (!pending) {
            return;
        }
        const currentKey = this.projects.getCurrentWorkspaceMatchKey();
        if (pending.targetKey && pending.targetKey !== currentKey) {
            this.clearPendingAction();
            return;
        }
        this.clearPendingAction();
        if (pending.kind === 'resumePreview') {
            await this.doResumePreview(
                pending.previewUrl,
                qaapHubPreviewWidgetKeyFromProject(pending),
            );
            return;
        }
        await this.doOpenAgentOnTask(pending.task);
    }

    protected readPendingAction(): QaapHubPendingAction | undefined {
        if (typeof sessionStorage === 'undefined') {
            return undefined;
        }
        try {
            const raw = sessionStorage.getItem(QAAP_HUB_PENDING_ACTION_KEY);
            if (!raw) {
                return undefined;
            }
            const parsed = JSON.parse(raw) as Partial<QaapHubPendingAction>;
            if (parsed.kind !== 'resumePreview' && parsed.kind !== 'openAgentOnTask') {
                return undefined;
            }
            return parsed as QaapHubPendingAction;
        } catch {
            return undefined;
        }
    }

    protected writePendingAction(action: QaapHubPendingAction): void {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        sessionStorage.setItem(QAAP_HUB_PENDING_ACTION_KEY, JSON.stringify(action));
    }

    protected clearPendingAction(): void {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.removeItem(QAAP_HUB_PENDING_ACTION_KEY);
        }
    }

    /**
     * Continue a project task with the sticky-composer / Work Hub agent of turn —
     * never the legacy Theia Chat `@coder` path.
     */
    protected async doOpenAgentOnTask(task: string | undefined): Promise<void> {
        const prompt = task && task !== '—'
            ? nls.localize(
                'qaap/hub/continueTaskPrompt',
                'Continue this task for the current workspace:\n\n{0}',
                task,
            )
            : nls.localize(
                'qaap/hub/continueProjectPrompt',
                'Help me continue work on this project.',
            );
        if (this.commands.getCommand(QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND)) {
            await this.commands.executeCommand(QAAP_WORK_HUB_SUBMIT_COMPOSER_PROMPT_COMMAND, prompt);
        }
        void this.projects.recordProjectSession({
            lastTask: task,
            agentState: 'working',
        });
    }
}

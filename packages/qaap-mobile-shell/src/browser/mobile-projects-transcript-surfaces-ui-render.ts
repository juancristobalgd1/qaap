import type { ConversationPreviewRuntimeState, TranscriptTab } from './mobile-projects-transcript-surfaces-ui';
import type { MobileProjectsTranscriptSurfacesUiContext } from './mobile-projects-transcript-surfaces-ui-context';
// Extracted from mobile-projects-transcript-surfaces-ui.ts

import { nls } from '@theia/core/lib/common/nls';
import { resolveWorkspaceHostFsPath } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-shell';
import { normalizePreviewUrlForSameOrigin } from '@theia/qaap-adapters/lib/browser/qaap-preview-url-utils';
import { resolveTranscriptPreviewOpenUrl } from '@theia/qaap-transcript/lib/browser/qaap-transcript-preview-effective-url';
import { type QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { isAgentsHubIdleConversationSummary } from '@theia/qaap-shared-core/lib/common/qaap-agents-hub-landing';
import type { QaapMonorepoAppCandidate } from '@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-types';
import {
    qaapPreviewFileUriMatchesProjectName,
} from '@theia/qaap-shared-core/lib/common/qaap-preview-identity';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';
import {
    writePendingTranscriptFilesViewMode,
} from '@theia/qaap-transcript/lib/browser/qaap-transcript-files-view';
import {
    transcriptConversationMeta as transcriptConversationMetaHelper,
} from '@theia/qaap-transcript/lib/browser/mobile-projects-transcript-surfaces-helpers';

export function pickTranscriptPreviewAppExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, apps: readonly QaapMonorepoAppCandidate[],): Promise<QaapMonorepoAppCandidate | undefined> {
    ctx.closeTranscriptPreviewAppPicker();
    return new Promise(resolve => {
        let settled = false;
        const picker = document.createElement('div');
        const finish = (app: QaapMonorepoAppCandidate | undefined): void => {
            if (settled) {
                return;
            }
            settled = true;
            ctx.transcriptPreviewAppPickerCancel = undefined;
            document.removeEventListener('keydown', onKeyDown, true);
            picker.remove();
            if (ctx.transcriptPreviewAppPicker === picker) {
                ctx.transcriptPreviewAppPicker = undefined;
            }
            resolve(app);
        };
        const onKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                finish(undefined);
            }
        };

        picker.className = 'theia-mobile-transcript-app-picker';
        picker.setAttribute('role', 'dialog');
        picker.setAttribute('aria-modal', 'true');
        const backdrop = document.createElement('button');
        backdrop.type = 'button';
        backdrop.className = 'theia-mobile-transcript-app-picker-backdrop';
        backdrop.tabIndex = -1;
        backdrop.setAttribute('aria-label', nls.localize('qaap/mobileProjects/cancelAppPicker', 'Cancel app selection'));
        backdrop.addEventListener('click', () => finish(undefined));

        const sheet = document.createElement('section');
        sheet.className = 'theia-mobile-transcript-app-picker-sheet';
        const heading = document.createElement('h2');
        heading.id = `qaap-preview-app-picker-${Date.now().toString(36)}`;
        heading.textContent = nls.localize('qaap/mobileProjects/pickPreviewApp', 'Choose app to preview');
        picker.setAttribute('aria-labelledby', heading.id);
        const hint = document.createElement('p');
        hint.textContent = nls.localize(
            'qaap/mobileProjects/pickPreviewAppHint',
            'Qaap will run the selected app in its own managed preview with hot reload.',
        );
        const list = document.createElement('div');
        list.className = 'theia-mobile-transcript-app-picker-list';
        for (const app of apps) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'theia-mobile-transcript-app-picker-item';
            const name = document.createElement('span');
            name.className = 'theia-mobile-transcript-app-picker-name';
            name.textContent = app.name;
            const path = document.createElement('span');
            path.className = 'theia-mobile-transcript-app-picker-path';
            path.textContent = app.relativePath;
            item.append(name, path);
            item.addEventListener('click', () => finish(app));
            list.append(item);
        }
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'theia-mobile-transcript-app-picker-cancel';
        cancel.textContent = nls.localize('qaap/mobileProjects/cancel', 'Cancel');
        cancel.addEventListener('click', () => finish(undefined));
        sheet.append(heading, hint, list, cancel);
        picker.append(backdrop, sheet);
        document.body.append(picker);
        ctx.transcriptPreviewAppPicker = picker;
        ctx.transcriptPreviewAppPickerCancel = () => finish(undefined);
        document.addEventListener('keydown', onKeyDown, true);
        window.setTimeout(() => list.querySelector<HTMLButtonElement>('button')?.focus(), 0);
    });
}

export function closeTranscriptPreviewAppPickerExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): void {
    ctx.transcriptPreviewAppPickerCancel?.();
    ctx.transcriptPreviewAppPickerCancel = undefined;
    ctx.transcriptPreviewAppPicker?.remove();
    ctx.transcriptPreviewAppPicker = undefined;
}

export function previewRuntimeForExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, conversationScopeId: string): ConversationPreviewRuntimeState {
    let state = ctx.previewRuntimeByConversationId.get(conversationScopeId);
    if (!state) {
        state = {};
        ctx.previewRuntimeByConversationId.set(conversationScopeId, state);
    }
    return state;
}

export function setMountedPreviewUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, conversationScopeId: string, url: string | undefined): void {
    const state = ctx.previewRuntimeFor(conversationScopeId);
    if (url === undefined) {
        delete state.mountedUrl;
    } else {
        state.mountedUrl = url;
    }
}

export function setProbeReadyPreviewUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, conversationScopeId: string, url: string | undefined): void {
    const state = ctx.previewRuntimeFor(conversationScopeId);
    if (url === undefined) {
        delete state.probeReadyUrl;
    } else {
        state.probeReadyUrl = normalizePreviewUrlForSameOrigin(url);
    }
}

export function setLastSyncedPreviewUrlExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, conversationScopeId: string, url: string | undefined): void {
    const state = ctx.previewRuntimeFor(conversationScopeId);
    if (url === undefined) {
        delete state.lastSyncedUrl;
    } else {
        state.lastSyncedUrl = url;
    }
}

export function matchesActivePreviewSummaryExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, summary: QaapAgentConversationSummaryDTO): boolean {
    if (ctx.host.transcriptOpenSummaryId === summary.id) {
        return true;
    }
    return ctx.host.agentsHubShellActive
        && !ctx.host.transcriptOpenSummaryId
        && isAgentsHubIdleConversationSummary(summary);
}

export function bootstrapAppliesToProjectExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry): boolean {
    const bootstrap = ctx.host.projectBootstrap;
    if (!bootstrap?.descriptor) {
        return project.isCurrent === true;
    }
    const projectCwd = ctx.host.projectsService.getProjectCwd(project)
        ?? ctx.host.preparedCwdByProjectId.get(project.id);
    const bootstrapRoot = resolveWorkspaceHostFsPath(bootstrap.descriptor.rootUri);
    if (projectCwd) {
        return ctx.pathsEqual(projectCwd, bootstrapRoot);
    }
    // Hub cards for skip-auth clones often lack `uri`/`isCurrent` while Theia still has another
    // workspace open. Match the pinned bootstrap root by folder name so Preview can adopt it.
    if (qaapPreviewFileUriMatchesProjectName(bootstrap.descriptor.rootUri.toString(), project.name)) {
        return true;
    }
    return project.isCurrent === true;
}

export function bootstrapPreviewUrlForProjectExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry): string | undefined {
    const bootstrap = ctx.host.projectBootstrap;
    const previewUrl = bootstrap?.previewUrl ?? bootstrap?.previewClaimUrl;
    if (!bootstrap || bootstrap.phase !== 'running' || !previewUrl) {
        return undefined;
    }
    if (!ctx.bootstrapAppliesToProject(project)) {
        return undefined;
    }
    return resolveTranscriptPreviewOpenUrl({
        candidateUrl: previewUrl,
        project,
        bootstrap,
        appliesToProject: true,
    });
}

export function ensurePreviewProjectContextExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry): void {
    if (ctx.transcriptPreviewProjectId === project.id) {
        return;
    }
    ctx.stopTranscriptPreviewTabProbe();
    ctx.suspendTranscriptPreviewIframe();
    ctx.transcriptPreviewProjectId = project.id;
}

export function mountProjectDetailSurfaceTabExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,
    tab: TranscriptTab,): void {
    switch (tab) {
        case 'review':
            // 'review' (Changes) is merged into the 'files' tab — set pending
            // view-mode flag and mount the files tab instead.
            writePendingTranscriptFilesViewMode('changes');
            ctx.ensureTranscriptFilesTab(project, summary);
            break;
        case 'preview':
            ctx.renderPreviewTab(project, summary);
            break;
        case 'files':
            // Explicit Files selection must restore the file explorer, not a
            // previously persisted Changes mode.
            ctx.ensureTranscriptFilesTab(project, summary, 'files');
            break;
        case 'terminal':
            void ctx.ensureTranscriptTerminalTab(project, summary);
            break;
        default:
            break;
    }
}

export function executionSurfaceHostExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, transcriptHost: HTMLElement | undefined,
    projectDetailHost: HTMLElement | undefined,): HTMLElement | undefined {
    if ((ctx.host.transcriptSheet || ctx.host.agentsHubShellActive) && transcriptHost) {
        return transcriptHost;
    }
    return projectDetailHost ?? transcriptHost;
}

export function executionPreviewHostExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): HTMLElement | undefined {
    return ctx.executionSurfaceHost(
        ctx.host.transcriptPreviewHost,
        ctx.host.projectDetailSurfaceTargets?.previewHost,
    );
}

export function executionFilesHostExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): HTMLElement | undefined {
    return ctx.executionSurfaceHost(
        ctx.host.transcriptFilesHost,
        ctx.host.projectDetailSurfaceTargets?.filesHost,
    );
}

export function executionTerminalHostExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext): HTMLElement | undefined {
    return ctx.executionSurfaceHost(
        ctx.host.transcriptTerminalHost,
        ctx.host.projectDetailSurfaceTargets?.terminalHost,
    );
}

export function transcriptConversationMetaExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO,): string {
    return transcriptConversationMetaHelper(project, summary);
}

export function updateTranscriptHeaderExtracted(ctx: MobileProjectsTranscriptSurfacesUiContext, project: MobileProjectEntry,
    summary: QaapAgentConversationSummaryDTO | undefined,): void {
    const titleEl = ctx.host.transcriptSheet?.querySelector('.theia-mobile-agent-log-header h2');
    const subtitle = ctx.host.transcriptHeaderSubtitle;
    if (!titleEl || !subtitle) {
        return;
    }
    titleEl.textContent = summary
        ? ctx.host.transcriptHeaderUi.resolveTranscriptHeaderTitle(project, summary)
        : project.name;
    subtitle.hidden = true;
    subtitle.className = 'theia-mobile-projects-subtitle';
    subtitle.replaceChildren();
}

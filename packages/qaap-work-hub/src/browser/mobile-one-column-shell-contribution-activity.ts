import type { MobileOneColumnShellContributionContext } from './mobile-one-column-shell-contribution-context';
// Extracted from mobile-one-column-shell-contribution.ts

import { toArray } from '@lumino/algorithm';
import {
    clearMobileWorkHubBootGuard,
    markPreferDesktopIde,
    peekPreferDesktopIde,
    setMobileActiveTranscriptChrome,
    setMobileWorkHubComposerHeaderChrome,
    setMobileWorkHubHideBottomChrome,
} from '@theia/qaap-shared-core/lib/browser/mobile-projects-open';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { GETTING_STARTED_WIDGET_COMMAND } from './mobile-one-column-shell-contribution';

export function ensureMobilePreviewEditorVisibleExtracted(ctx: MobileOneColumnShellContributionContext): void {
        if (!ctx.mobileActive) {
            return;
        }
        setMobileWorkHubHideBottomChrome(false);
        setMobileWorkHubComposerHeaderChrome(false);
        setMobileActiveTranscriptChrome(false);
        document.body.classList.remove('theia-mobile-mod-landing');
        if (!peekPreferDesktopIde()) {
            markPreferDesktopIde();
        }
}

export async function activateMainPreviewWidgetExtracted(ctx: MobileOneColumnShellContributionContext): Promise<boolean> {
        const preview = ctx.getMainPreviewWidget();
        if (!preview || !ctx.isMainPreviewWidgetLive(preview)) {
            return false;
        }
        await ctx.shell.activateWidget(preview.id);
        ctx.relayoutMainPreviewWidgets();
        return true;
}

export async function relocatePreviewToMainIfNeededExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
        const preview = ctx.findPreviewWidget();
        if (!preview?.isAttached) {
            return;
        }
        if (ctx.shell.getAreaFor(preview) === 'main') {
            return;
        }
        await ctx.shell.closeWidget(preview.id, { save: false });
}

export async function toggleMobilePreviewExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
        ctx.hideProjectsPanel();
        ctx.hidePullRequestPanel();
        ctx.ensureMobilePreviewEditorVisible();
        const activePreview = ctx.getActivePreviewWidget();
        if (activePreview) {
            activePreview.close();
            ctx.scheduleSnapAndUiRefresh();
            return;
        }
        if (await ctx.activateMainPreviewWidget()) {
            ctx.scheduleSnapAndUiRefresh();
            return;
        }
        await ctx.relocatePreviewToMainIfNeeded();
        await ctx.closeStaleMainPreviewWidget();
        if (ctx.shouldDismissSheetsForButton('preview')) {
            await ctx.dismissSheetsAsync();
        }
        // Always mount mini-browser chrome first — never block the UI on install/dev-server bootstrap.
        await ctx.openMobilePreviewInMain();
        void ctx.bootstrapMobilePreviewInBackground();
}

export async function bootstrapMobilePreviewInBackgroundExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
        try {
            if (ctx.projectBootstrap.previewUrl) {
                await ctx.projectBootstrap.focusPreview();
                await ctx.activateMainPreviewWidget();
                return;
            }
            const phase = ctx.projectBootstrap.phase;
            const descriptor = ctx.projectBootstrap.descriptor;
            if (phase === 'run-failed' && ctx.projectBootstrap.needsInstall && descriptor?.installCommand) {
                await ctx.projectBootstrap.runInstall();
                return;
            }
            if (ctx.projectBootstrap.hasRunnableDevPlan()
                && (phase === 'ready-to-run' || phase === 'starting' || phase === 'run-failed')) {
                await ctx.projectBootstrap.runDevServer();
                return;
            }
            if (phase === 'detected' && descriptor?.installCommand) {
                await ctx.projectBootstrap.runInstall();
            }
        } catch (e) {
            console.error('[qaap-mobile-shell] bootstrapMobilePreviewInBackground failed', e);
        } finally {
            ctx.relayoutMainPreviewWidgets();
            ctx.scheduleSnapAndUiRefresh();
        }
}

export async function openMobilePreviewInMainExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
        try {
            await ctx.miniBrowserOpenHandler.openEmptyPreviewTab();
        } catch (e) {
            console.error('[qaap-mobile-shell] openEmptyPreviewTab failed', e);
            return;
        }
        if (!await ctx.activateMainPreviewWidget()) {
            const preview = await ctx.miniBrowserOpenHandler.getByUri(MiniBrowserOpenHandler.PREVIEW_URI);
            if (preview) {
                await ctx.shell.activateWidget(preview.id);
            }
        }
        ctx.relayoutMainPreviewWidgets();
        ctx.requestFullShellRelayout();
        ctx.scheduleSnapAndUiRefresh();
}

export async function ensureWelcomeInMainAreaExtracted(ctx: MobileOneColumnShellContributionContext): Promise<void> {
        // The classic IDE / Welcome is taking the main area — make sure the boot guard is lifted.
        clearMobileWorkHubBootGuard();
        if (toArray(ctx.shell.mainPanel.widgets()).length > 0) {
            return;
        }
        if (!ctx.commands.getCommand(GETTING_STARTED_WIDGET_COMMAND)
            || !ctx.commands.isEnabled(GETTING_STARTED_WIDGET_COMMAND)) {
            return;
        }
        try {
            await ctx.commands.executeCommand(GETTING_STARTED_WIDGET_COMMAND);
        } catch (e) {
            console.error('[qaap-mobile-shell] failed to open Welcome', e);
        }
}


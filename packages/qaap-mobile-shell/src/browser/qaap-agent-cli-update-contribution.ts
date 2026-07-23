// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { nls } from '@theia/core/lib/common/nls';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';
import {
    fetchAgentCliUpdates,
    pickNextAgentUpdateToShow,
    readAgentCliUpdateDismissMap,
    rememberAgentCliUpdateDismiss,
    requestAgentCliUpdate,
    type QaapAgentCliUpdateInfo,
} from '../common/qaap-agent-cli-update';
import { OPEN_AI_CONFIGURATION_COMMAND } from './mobile-shell-bottom-bar-widget';
import { MobileSnackbar } from './mobile-snackbar';
import {
    showAgentCliUpdateToast,
    type QaapAgentCliUpdateToastController,
} from './qaap-agent-cli-update-toast';

/** Defer slightly so Work Hub / splash finish painting before the toast competes for attention. */
const BOOT_DELAY_MS = 2_500;

/**
 * On app start, ask the backend which agent CLIs are outdated and surface a T3-like toast
 * (Cancel / Update / dismiss). Non-blocking: failures are swallowed; dismiss is session-scoped.
 */
@injectable()
export class QaapAgentCliUpdateContribution implements FrontendApplicationContribution {

    @inject(FrontendApplicationStateService)
    protected readonly stateService: FrontendApplicationStateService;

    @inject(CommandRegistry) @optional()
    protected readonly commands: CommandRegistry | undefined;

    @inject(MessageService) @optional()
    protected readonly messages: MessageService | undefined;

    protected toast: QaapAgentCliUpdateToastController | undefined;
    protected shownAgentId: string | undefined;
    protected disposed = false;

    onStart(): void {
        void this.stateService.reachedState('ready').then(() => {
            if (this.disposed) {
                return;
            }
            window.setTimeout(() => {
                if (!this.disposed) {
                    void this.checkAndShow();
                }
            }, BOOT_DELAY_MS);
        });
    }

    onStop(): void {
        this.disposed = true;
        this.toast?.dispose();
        this.toast = undefined;
    }

    protected async checkAndShow(): Promise<void> {
        let updates: readonly QaapAgentCliUpdateInfo[] = [];
        try {
            updates = (await fetchAgentCliUpdates()).updates;
        } catch {
            // Offline / unauthenticated / API missing — never block boot.
            return;
        }
        if (this.disposed) {
            return;
        }
        const next = pickNextAgentUpdateToShow(updates, readAgentCliUpdateDismissMap());
        if (!next) {
            return;
        }
        this.present(next);
    }

    protected present(info: QaapAgentCliUpdateInfo): void {
        this.toast?.dispose();
        this.shownAgentId = info.id;
        this.toast = showAgentCliUpdateToast(info, {
            onDismiss: () => this.dismiss(info),
            onCancel: () => this.dismiss(info),
            onUpdate: () => void this.runUpdate(info),
        });
    }

    protected dismiss(info: QaapAgentCliUpdateInfo): void {
        rememberAgentCliUpdateDismiss(info.id, info.latestVersion);
        this.toast?.dispose();
        this.toast = undefined;
        // Offer the next outdated agent in the same session (if any).
        void this.checkAndShow();
    }

    protected openSettings(): void {
        if (this.commands?.getCommand(OPEN_AI_CONFIGURATION_COMMAND)) {
            void this.commands.executeCommand(OPEN_AI_CONFIGURATION_COMMAND);
            return;
        }
        // Fallback when AI Configuration is not registered (headless / partial shells).
        void this.messages?.info(
            nls.localize(
                'qaap/agentCliUpdate/settingsFallback',
                'Open Settings → AI Features to review provider configuration.',
            ),
        );
    }

    protected async runUpdate(info: QaapAgentCliUpdateInfo): Promise<void> {
        if (!info.updateSupported) {
            // QAIQ (and similar) ship via Docker layers — no in-place npm update.
            rememberAgentCliUpdateDismiss(info.id, info.latestVersion);
            this.toast?.dispose();
            this.toast = undefined;
            void this.messages?.info(
                nls.localize(
                    'qaap/agentCliUpdate/rebuildRequired',
                    '{0} cannot be updated in-place. Rebuild the Qaap image (or bump the CLI pin) to install v{1}.',
                    info.label,
                    info.latestVersion,
                ),
            );
            this.openSettings();
            return;
        }

        this.toast?.setUpdating(true);
        const result = await requestAgentCliUpdate(info.id).catch((error: unknown) => ({
            ok: false as const,
            id: info.id,
            message: error instanceof Error ? error.message : String(error),
        }));
        if (this.disposed) {
            return;
        }
        this.toast?.setUpdating(false);

        if (result.ok) {
            rememberAgentCliUpdateDismiss(info.id, info.latestVersion);
            this.toast?.dispose();
            this.toast = undefined;
            MobileSnackbar.show(
                result.message
                    ?? nls.localize(
                        'qaap/agentCliUpdate/updated',
                        '{0} updated to v{1}.',
                        info.label,
                        result.installedVersion ?? info.latestVersion,
                    ),
                { kind: 'success', duration: 3200 },
            );
            void this.checkAndShow();
            return;
        }

        MobileSnackbar.show(
            result.message
                ?? nls.localize('qaap/agentCliUpdate/updateFailed', 'Could not update {0}.', info.label),
            {
                kind: 'warning',
                duration: 5000,
                actionLabel: nls.localize('qaap/agentCliUpdate/settings', 'Settings'),
                onAction: () => this.openSettings(),
            },
        );
        // Keep the toast so the user can retry, cancel, or dismiss.
        this.toast?.setUpdating(false);
    }
}

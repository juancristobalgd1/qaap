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
    isAgentCliUpdateInDailyCooldown,
    isAgentCliUpdateSnoozed,
    pickNextAgentUpdateToShow,
    countAgentUpdatesToShow,
    readAgentCliUpdateDismissMap,
    rememberAgentCliUpdateDismiss,
    rememberAgentCliUpdateShown,
    snoozeAgentCliUpdates,
    type QaapAgentCliUpdateInfo,
} from '../common/qaap-agent-cli-update';
import { OPEN_AI_CONFIGURATION_COMMAND } from '@theia/qaap-mobile-shell/lib/browser/mobile-shell-bottom-bar-widget';
import {
    showAgentCliUpdateToast,
    type QaapAgentCliUpdateToastController,
} from './qaap-agent-cli-update-toast';
import { QaapAgentCliUpdateTracker } from './qaap-agent-cli-update-tracker';

export { presentableAgentCliUpdateFailure } from '../common/qaap-agent-cli-update';

/** Defer so Work Hub / initial paint settle before the non-critical update notice competes for attention. */
const BOOT_DELAY_MS = 8_000;

/**
 * On app start, ask the backend which agent CLIs are outdated and surface a T3-like toast
 * (Cancel / Update / dismiss). Non-blocking: failures are swallowed; dismiss persists per
 * agentId + latestVersion in localStorage, so a newer release still re-prompts. "Later" dismisses
 * every pending update, stays quiet for the rest of the page session and snoozes the notice for a week.
 *
 * "Update" closes the notice at once: the install runs in {@link QaapAgentCliUpdateTracker} and
 * its progress, success or failure is shown by the compact status chip instead.
 */
@injectable()
export class QaapAgentCliUpdateContribution implements FrontendApplicationContribution {

    @inject(FrontendApplicationStateService)
    protected readonly stateService: FrontendApplicationStateService;

    @inject(CommandRegistry) @optional()
    protected readonly commands: CommandRegistry | undefined;

    @inject(MessageService) @optional()
    protected readonly messages: MessageService | undefined;

    @inject(QaapAgentCliUpdateTracker)
    protected readonly tracker: QaapAgentCliUpdateTracker;

    protected toast: QaapAgentCliUpdateToastController | undefined;
    protected shownAgentId: string | undefined;
    protected disposed = false;
    /** Outdated CLIs from the last successful check; "Later" dismisses all of them. */
    protected pendingUpdates: readonly QaapAgentCliUpdateInfo[] = [];
    /** Set by "Later": no further update toast until the page is reloaded. */
    protected laterChosenThisSession = false;

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

    protected async checkAndShow(trigger: 'boot' | 'afterUpdate' = 'boot'): Promise<void> {
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
        this.pendingUpdates = updates;
        const now = Date.now();
        if (
            this.laterChosenThisSession
            || isAgentCliUpdateSnoozed(now)
            || (trigger === 'boot' && isAgentCliUpdateInDailyCooldown(now))
        ) {
            return;
        }
        // At most one notice on screen: a visible toast keeps the queue.
        if (this.toast) {
            return;
        }
        const dismissed = readAgentCliUpdateDismissMap();
        const next = pickNextAgentUpdateToShow(updates, dismissed);
        if (!next) {
            return;
        }
        if (trigger === 'boot') {
            rememberAgentCliUpdateShown(now);
        }
        this.present(next, countAgentUpdatesToShow(updates, dismissed));
    }

    protected present(info: QaapAgentCliUpdateInfo, pendingCount: number): void {
        this.toast?.dispose();
        this.shownAgentId = info.id;
        this.toast = showAgentCliUpdateToast(info, {
            onDismiss: () => this.dismiss(info),
            onCancel: () => this.dismiss(info),
            onUpdate: () => this.runUpdate(info),
        }, { pendingCount });
    }

    /** "Later": dismiss every pending CLI update and stay quiet (session + 7-day snooze). */
    protected dismiss(info: QaapAgentCliUpdateInfo): void {
        snoozeAgentCliUpdates([...this.pendingUpdates, info], Date.now());
        this.laterChosenThisSession = true;
        this.toast?.dispose();
        this.toast = undefined;
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
                'Open Settings → Harness to review harness connections.',
            ),
        );
    }

    protected runUpdate(info: QaapAgentCliUpdateInfo): void {
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

        // Close the large notice immediately; progress and outcome move to the status chip.
        this.toast?.dispose();
        this.toast = undefined;
        void this.tracker.start(info).then(job => {
            if (!this.disposed && job.status === 'succeeded') {
                void this.checkAndShow('afterUpdate');
            }
        });
    }
}

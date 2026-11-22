// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandHandler, CommandRegistry } from '@theia/core/lib/common/command';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { quickCommand } from '@theia/core/lib/browser/quick-input/quick-command-service';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { peekPreferDesktopIde } from '@theia/qaap-shared-core/lib/common/qaap-mobile-work-surface-preference';
import type { QaapTenantBackendUpdate } from '@theia/qaap-shared-core/lib/browser/qaap-tenant-update-client';
import { QAAP_WORK_HUB_OPEN_COMMAND_SEARCH_COMMAND, QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND } from '../common/qaap-work-hub-command-palette';
import {
    WORK_HUB_CHECK_FOR_UPDATES_COMMAND_ID,
    WORK_HUB_SETTINGS_COMMAND_REDIRECTS,
    workHubSettingsSectionQuery,
} from '../common/qaap-work-hub-surface-redirects';
import { QaapTenantUpdateService } from './qaap-tenant-update-service';

/**
 * While the Work Hub is the active surface, the upstream Settings, Keyboard Shortcuts, Color Theme and
 * Check for Updates commands run their Work Hub equivalent. The classic IDE keeps the upstream handlers:
 * every redirect is enabled only while the Work Hub is active.
 *
 * Handlers are registered in `onStart`. Command contributions register in binding order and the most recent
 * handler wins, so a handler registered from `registerCommands` could be shadowed by an upstream one.
 * `onStart` runs after every `registerCommands`, so these handlers always take precedence.
 */
@injectable()
export class QaapWorkHubSurfaceRedirectContribution implements FrontendApplicationContribution {

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(MessageService)
    protected readonly messageService: MessageService;

    /** Same flow as the sidebar footer update button (confirmation, apply, reload), without its chip state. */
    protected readonly tenantUpdate = new QaapTenantUpdateService();

    protected readonly toDispose = new DisposableCollection();

    onStart(): void {
        for (const redirect of WORK_HUB_SETTINGS_COMMAND_REDIRECTS) {
            this.toDispose.push(this.commands.registerHandler(redirect.commandId, this.workHubHandler(
                (query?: unknown) => this.commands.executeCommand(
                    QAAP_WORK_HUB_OPEN_SETTINGS_COMMAND,
                    // Keep caller queries (for example `ai-features` from the AI config view); otherwise open the section.
                    typeof query === 'string' && query ? query : workHubSettingsSectionQuery(redirect.sectionId),
                ),
            )));
        }
        // F1 / Cmd+Shift+P / the Command Palette command: the Work Hub search dialog (Commands tab) replaces
        // the IDE quick-command list while the hub is active. Enabled only when that dialog can open, so the
        // IDE palette stays the fallback otherwise.
        this.toDispose.push(this.commands.registerHandler(quickCommand.id, {
            execute: () => this.commands.executeCommand(QAAP_WORK_HUB_OPEN_COMMAND_SEARCH_COMMAND),
            isEnabled: () => !peekPreferDesktopIde() && this.commands.isEnabled(QAAP_WORK_HUB_OPEN_COMMAND_SEARCH_COMMAND),
            isVisible: () => !peekPreferDesktopIde(),
        }));
        this.toDispose.push(this.commands.registerHandler(
            WORK_HUB_CHECK_FOR_UPDATES_COMMAND_ID,
            this.workHubHandler(() => this.checkForUpdates()),
        ));
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    protected workHubHandler(execute: (...args: unknown[]) => unknown): CommandHandler {
        return {
            execute,
            isEnabled: () => !peekPreferDesktopIde(),
            isVisible: () => !peekPreferDesktopIde(),
        };
    }

    /**
     * Reports a pending Qaap update with an «Update now» action, or says there is none. Nothing is applied
     * unless the user picks «Update now»; that action runs the sidebar footer flow (confirmation when agent
     * turns are running, apply, reload).
     */
    protected async checkForUpdates(): Promise<void> {
        let update: QaapTenantBackendUpdate | undefined;
        try {
            update = await this.tenantUpdate.readBackendUpdate();
        } catch {
            this.messageService.warn(nls.localize('qaap/workHubUpdate/checkFailed',
                'Could not check for Qaap updates. Check your connection and try again.'));
            return;
        }
        if (!update?.updatePending) {
            this.messageService.info(nls.localize('qaap/workHubUpdate/upToDate', 'Qaap is up to date.'));
            return;
        }
        const runningTasks = update.runningTasks;
        const updateNowLabel = nls.localize('qaap/workHubUpdate/updateNow', 'Update now');
        // Not awaited: the command returns at once, and the notification stays until the user answers it.
        this.messageService.info(nls.localize('qaap/workHubUpdate/available', 'Update available'), updateNowLabel)
            .then(answer => {
                if (answer === updateNowLabel) {
                    return this.applyUpdate(runningTasks);
                }
                return undefined;
            });
    }

    protected async applyUpdate(runningTasks: number): Promise<void> {
        const outcome = await this.tenantUpdate.updateNow(runningTasks);
        if (outcome === 'failed') {
            this.messageService.error(nls.localize('qaap/sessionsSidebar/backendUpdateFailed',
                'Could not update Qaap. Check your connection and try again.'));
        } else if (outcome === 'nothing') {
            this.messageService.info(nls.localize('qaap/workHubUpdate/upToDate', 'Qaap is up to date.'));
        }
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { nls } from '@theia/core/lib/common/nls';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import type { QuickInputService, QuickPickItem } from '@theia/core/lib/common/quick-pick-service';
import type { QaapAgentConversationSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-agent-conversation-client';
import { QaapExternalSessionClient } from '@theia/qaap-shared-core/lib/common/qaap-external-session-client';
import type { QaapExternalSessionSource, QaapExternalSessionSummaryDTO } from '@theia/qaap-shared-core/lib/common/qaap-external-session-protocol';
import { QaapUserFacingErrors } from '@theia/qaap-adapters/lib/common/qaap-user-facing-error';
import { MobileSnackbar } from '@theia/qaap-mobile-shell/lib/browser/mobile-snackbar';
import type { MobileProjectEntry } from '@theia/qaap-shared-core/lib/browser/mobile-projects-types';

/** What the import picker needs from the Work Hub panel. */
export interface MobileProjectsExternalSessionImportHost {
    readonly quickInputService?: QuickInputService;
    getProjectCwd(project: MobileProjectEntry): string | undefined;
    findSummaryById(id: string): QaapAgentConversationSummaryDTO | undefined;
    openConversationSummary(project: MobileProjectEntry, summary: QaapAgentConversationSummaryDTO): Promise<void>;
}

interface ExternalSessionPickItem extends QuickPickItem {
    readonly session: QaapExternalSessionSummaryDTO;
}

/** How long the picker waits for the live feed to deliver the imported conversation before opening it from the reply. */
const SUMMARY_WAIT_MS = 3_000;

/**
 * "Import from other CLIs": lists the project's conversations in Claude Code, Codex, OpenCode and Pi and
 * imports the picked one as a Work Hub task (doc/qaap-external-session-import.md).
 */
export class MobileProjectsExternalSessionImportUi {

    protected readonly client = new QaapExternalSessionClient();

    constructor(protected readonly services: MobileProjectsExternalSessionImportHost) { }

    async open(project: MobileProjectEntry): Promise<void> {
        const cwd = this.services.getProjectCwd(project);
        const quickInput = this.services.quickInputService;
        if (!cwd || !quickInput) {
            return;
        }
        const quickPick = quickInput.createQuickPick<ExternalSessionPickItem>();
        quickPick.title = nls.localize('qaap/externalSessions/title', 'Import a conversation from another CLI');
        quickPick.placeholder = nls.localize('qaap/externalSessions/placeholder', 'Claude Code, Codex, OpenCode and Pi sessions of {0}', project.name);
        quickPick.matchOnDescription = true;
        quickPick.matchOnDetail = true;
        quickPick.ignoreFocusOut = true;
        quickPick.busy = true;
        const cleanup = new DisposableCollection();
        cleanup.push(quickPick.onDidAccept(() => {
            const picked = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
            if (picked) {
                quickPick.hide();
                void this.importSession(project, cwd, picked.session);
            }
        }));
        cleanup.push(quickPick.onDidHide(() => {
            cleanup.dispose();
            quickPick.dispose();
        }));
        quickPick.show();
        try {
            const sessions = await this.client.list(cwd);
            quickPick.items = sessions.map(session => this.toPickItem(session));
            if (sessions.length === 0) {
                quickPick.placeholder = nls.localize('qaap/externalSessions/none', 'No conversations of this project were found in other CLIs on this machine.');
            }
        } catch (error) {
            quickPick.hide();
            MobileSnackbar.show(nls.localize('qaap/externalSessions/listFailed', 'Could not list the sessions: {0}',
                QaapUserFacingErrors.toMessage(error)), { kind: 'warning', duration: 4000 });
        } finally {
            quickPick.busy = false;
        }
    }

    protected toPickItem(session: QaapExternalSessionSummaryDTO): ExternalSessionPickItem {
        const when = new Date(session.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
        const via = session.originator && session.originator !== 'codex_cli_rs' && session.originator !== 'codex_exec'
            ? nls.localize('qaap/externalSessions/via', ' via {0}', session.originator)
            : '';
        return {
            label: session.title || session.firstUserMessage,
            description: `${this.sourceLabel(session.source)}${via} · ${when}`,
            detail: session.importedConversationId
                ? nls.localize('qaap/externalSessions/alreadyImported', 'Already imported — opens the existing task')
                : session.title ? session.firstUserMessage : undefined,
            session,
        };
    }

    protected sourceLabel(source: QaapExternalSessionSource): string {
        switch (source) {
            case 'claude': return 'Claude Code';
            case 'codex': return 'Codex';
            case 'opencode': return 'OpenCode';
            case 'pi': return 'Pi';
        }
    }

    protected async importSession(project: MobileProjectEntry, cwd: string, session: QaapExternalSessionSummaryDTO): Promise<void> {
        try {
            const conversation = session.importedConversationId
                ? undefined
                : await this.client.import({ cwd, source: session.source, sessionId: session.sessionId });
            const id = session.importedConversationId ?? conversation!.id;
            const summary = await this.waitForSummary(id) ?? (conversation ? {
                id: conversation.id,
                cwd: conversation.cwd,
                agentId: conversation.agentId,
                title: conversation.title,
                status: conversation.status,
                createdAt: conversation.createdAt,
                updatedAt: conversation.updatedAt,
                messageCount: conversation.messages.length,
                externalSession: conversation.externalSession,
            } : undefined);
            if (summary) {
                await this.services.openConversationSummary(project, summary);
            }
            if (conversation) {
                MobileSnackbar.show(nls.localize('qaap/externalSessions/imported', 'Imported from {0}. Your next message continues the thread.',
                    this.sourceLabel(session.source)), { kind: 'success', duration: 2600 });
            }
        } catch (error) {
            MobileSnackbar.show(nls.localize('qaap/externalSessions/importFailed', 'Could not import the session: {0}',
                QaapUserFacingErrors.toMessage(error)), { kind: 'warning', duration: 4000 });
        }
    }

    protected async waitForSummary(id: string): Promise<QaapAgentConversationSummaryDTO | undefined> {
        const deadline = Date.now() + SUMMARY_WAIT_MS;
        for (;;) {
            const summary = this.services.findSummaryById(id);
            if (summary || Date.now() >= deadline) {
                return summary;
            }
            await new Promise(resolve => setTimeout(resolve, 150));
        }
    }
}

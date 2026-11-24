// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { nls } from '@theia/core/lib/common/nls';
import { Disposable } from '@theia/core/lib/common/disposable';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { fetchQaapTerminalSessions, upsertQaapTerminalSessions } from './qaap-cloud-workspace-client';
import { QaapDeferredStartup, QaapVisibleInterval } from './qaap-deferred-startup';
import { persistableQaapTerminals } from './qaap-terminal-persistence-filter';

const PERSIST_INTERVAL_MS = 15_000;

@injectable()
export class QaapTerminalPersistenceContribution implements FrontendApplicationContribution {

    @inject(TerminalService)
    protected readonly terminals: TerminalService;

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(QaapDeferredStartup)
    protected readonly deferredStartup: QaapDeferredStartup;

    protected persistTimer: QaapVisibleInterval | undefined;
    protected deferredStart: Disposable | undefined;

    onStart(): void {
        // The restore hint is informational: fetch it after ready + idle, not during boot.
        // The persist tick is a no-op without terminals and is skipped while the tab is hidden.
        this.deferredStart = this.deferredStartup.whenReadyAndIdle(() => {
            void this.restoreHint();
            this.persistTimer = new QaapVisibleInterval(() => { void this.persist(); }, PERSIST_INTERVAL_MS);
        });
    }

    onStop(): void {
        this.deferredStart?.dispose();
        this.persistTimer?.dispose();
        this.persistTimer = undefined;
    }

    protected workspaceKey(): string {
        const uri = this.workspace.workspace?.resource?.toString();
        return uri ? `ws:${uri}` : 'default';
    }

    /** What the last successful persist wrote, so an unchanged list is not sent again. */
    protected lastPersisted: string | undefined;

    protected async persist(): Promise<void> {
        // Work Hub terminals (chat panels, the hidden sign-in terminal of the Connect dialog) are transient: they keep
        // their own state, and listing them here made the IDE announce "Previous terminal session restored (π)" for
        // a Pi sign-in that had long finished (staging, 24 Nov 2026).
        const terminals = persistableQaapTerminals(this.terminals.all);
        const workspaceKey = this.workspaceKey();
        const snapshot = JSON.stringify({ workspaceKey, terminals });
        // An empty list is written too (once), so a closed terminal stops being announced after the next start.
        if (snapshot === this.lastPersisted || (terminals.length === 0 && this.lastPersisted === undefined && !this.hadSavedTerminals)) {
            return;
        }
        await upsertQaapTerminalSessions({ workspaceKey, terminals });
        this.lastPersisted = snapshot;
    }

    /** Whether the server had terminals saved for this workspace when the app started (an empty list must clear them). */
    protected hadSavedTerminals = false;

    protected async restoreHint(): Promise<void> {
        const saved = await fetchQaapTerminalSessions(this.workspaceKey());
        this.hadSavedTerminals = saved.terminals.length > 0;
        if (saved.terminals.length === 0) {
            return;
        }
        const names = saved.terminals.map(t => t.title).join(', ');
        this.messages.info(nls.localize(
            'qaap/terminal/restoredHint',
            'Previous terminal session restored ({0}). Open Terminal to continue.',
            names
        ));
    }
}

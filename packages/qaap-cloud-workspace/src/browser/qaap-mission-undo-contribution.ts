// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { nls } from '@theia/core/lib/common/nls';
import { MessageService } from '@theia/core/lib/common/message-service';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { ChatService } from '@theia/ai-chat/lib/common';
import { ChangeSetElement } from '@theia/ai-chat/lib/common/change-set';

const QAAP_LAST_MISSION_STORAGE_KEY = 'qaap.ai.lastMissionSnapshot';

export const QAAP_CAPTURE_MISSION_SNAPSHOT_COMMAND_ID = 'qaap.ai.captureMissionSnapshot';

export namespace QaapMissionUndoCommands {
    export const CAPTURE: Command = {
        id: QAAP_CAPTURE_MISSION_SNAPSHOT_COMMAND_ID,
        category: 'AI',
        label: nls.localize('qaap/missionUndo/capture', 'Capture mission snapshot'),
    };
}

interface QaapMissionSnapshot {
    readonly sessionLabel: string;
    readonly capturedAt: string;
    readonly sessionId?: string;
    readonly fileUris: string[];
}

/** Captures agent mission snapshots so chat change-sets can be reverted later. */
@injectable()
export class QaapMissionUndoContribution implements CommandContribution {

    @inject(StorageService)
    protected readonly storage: StorageService;

    @inject(MessageService)
    protected readonly messages: MessageService;

    @inject(ChatService)
    protected readonly chatService: ChatService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(QaapMissionUndoCommands.CAPTURE, {
            execute: (label?: string, elements?: ChangeSetElement[]) => this.captureMissionSnapshot(label, elements),
        });
    }

    async captureMissionSnapshot(
        sessionLabel = 'Agent session',
        elements?: ChangeSetElement[],
    ): Promise<void> {
        const active = this.chatService.getActiveSession();
        const changeElements = elements ?? active?.model.changeSet.getElements() ?? [];
        const snapshot: QaapMissionSnapshot = {
            sessionLabel,
            capturedAt: new Date().toISOString(),
            sessionId: active?.id,
            fileUris: changeElements.map(e => e.uri.toString()),
        };
        await this.storage.setData(QAAP_LAST_MISSION_STORAGE_KEY, snapshot);
    }
}

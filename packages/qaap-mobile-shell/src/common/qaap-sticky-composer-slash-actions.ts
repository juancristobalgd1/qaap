// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_WORK_HUB_AI_CONFIGURATION_MCP_TAB } from './mobile-work-hub-catalog';
import type { StickyComposerSlashActionId } from './qaap-sticky-composer-slash-menu';

export interface StickyComposerSlashActionHandlers {
    readonly forkConversation?: () => void | Promise<void>;
    readonly startNewAgentWithPrompt?: (prompt: string) => void;
    readonly openMcpConfiguration?: () => void | Promise<void>;
}

export async function executeStickyComposerSlashAction(
    actionId: StickyComposerSlashActionId,
    prompt: string,
    handlers: StickyComposerSlashActionHandlers,
): Promise<void> {
    if (actionId === 'fork') {
        await handlers.forkConversation?.();
        return;
    }
    if (actionId === 'new') {
        handlers.startNewAgentWithPrompt?.(prompt);
        return;
    }
}

export function openComposerMcpConfigurationSheet(
    openAiConfigurationSheet?: (tabId?: string) => Promise<void>,
): Promise<void> | undefined {
    return openAiConfigurationSheet?.(QAAP_WORK_HUB_AI_CONFIGURATION_MCP_TAB);
}

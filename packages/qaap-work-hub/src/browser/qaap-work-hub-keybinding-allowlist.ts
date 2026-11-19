// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { QAAP_MAXIMIZE_CHAT_COMMAND_ID } from './qaap-watermark-entries';

/** `QAAP_COMPOSER_ADD_EDITOR_SELECTION_COMMAND` (qaap-composer); kept literal so this module stays DOM-free. */
export const QAAP_WORK_HUB_ADD_EDITOR_SELECTION_COMMAND_ID = 'qaap.composer.addEditorSelection';

/**
 * Registry commands the Work Hub settings › Keybindings page lists. An explicit allowlist rather than an id
 * prefix or a `when` heuristic: the page is about the Work Hub's own shortcuts, not the IDE keymap (the IDE
 * keeps its full Keyboard Shortcuts editor). Every entry is a command with a registered keybinding that has
 * a working handler on desktop; add a command here only together with its keybinding.
 */
export const QAAP_WORK_HUB_KEYBINDING_COMMANDS: readonly string[] = [
    // Chat: Maximize Chat (ctrlcmd+alt+e), QaapWatermarkCommandsContribution.
    QAAP_MAXIMIZE_CHAT_COMMAND_ID,
    // Qaap: Add selection to agent (ctrlcmd+shift+. in a focused editor), QaapComposerEditorContextContribution.
    QAAP_WORK_HUB_ADD_EDITOR_SELECTION_COMMAND_ID,
];

/** Whether the Work Hub keybindings page lists `commandId`. */
export function isQaapWorkHubKeybindingCommand(commandId: string): boolean {
    return QAAP_WORK_HUB_KEYBINDING_COMMANDS.includes(commandId);
}

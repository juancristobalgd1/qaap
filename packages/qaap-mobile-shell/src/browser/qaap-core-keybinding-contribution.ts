// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CommonCommands } from '@theia/core/lib/browser/common-commands';
import { injectable } from '@theia/core/shared/inversify';

export const QAAP_CORE_COPY_KEYBINDING = 'ctrlcmd+c';

const QAAP_CORE_FALLBACK_KEYBINDINGS: ReadonlyArray<{ command: string; keybinding: string }> = [
    { command: CommonCommands.COPY.id, keybinding: QAAP_CORE_COPY_KEYBINDING },
    { command: CommonCommands.FIND.id, keybinding: 'ctrlcmd+f' },
    { command: CommonCommands.REPLACE.id, keybinding: 'ctrlcmd+alt+f' },
];

/**
 * Theia omits core.copy when queryCommandSupported('copy') is false. Headless Chromium can
 * report that capability as unavailable even though the keybinding registry remains usable.
 * Restore only the missing declaration; a browser-provided declaration always wins.
 */
export function ensureQaapCoreCopyKeybinding(keybindings: KeybindingRegistry): boolean {
    let registered = false;
    for (const binding of QAAP_CORE_FALLBACK_KEYBINDINGS) {
        if (keybindings.getKeybindingsForCommand(binding.command).length > 0) {
            continue;
        }
        keybindings.registerKeybinding(binding);
        registered = true;
    }
    return registered;
}

/** Keeps the classic IDE keybinding contract available in browser environments with restricted clipboard APIs. */
@injectable()
export class QaapCoreKeybindingContribution implements KeybindingContribution {

    registerKeybindings(keybindings: KeybindingRegistry): void {
        ensureQaapCoreCopyKeybinding(keybindings);
    }
}

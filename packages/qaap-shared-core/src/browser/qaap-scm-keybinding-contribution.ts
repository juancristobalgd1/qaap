// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { injectable } from '@theia/core/shared/inversify';

export const QAAP_SCM_ACCEPT_INPUT_COMMAND = 'scm.acceptInput';
export const QAAP_SCM_ACCEPT_INPUT_KEYBINDING = 'ctrlcmd+enter';

/**
 * Keep the SCM commit widget usable when the Qaap SCM contribution is deferred
 * during Work Hub startup and the upstream SCM keybinding has not been added
 * yet. The fallback is a no-op when upstream already registered the command.
 */
export function ensureQaapScmAcceptInputKeybinding(keybindings: KeybindingRegistry): boolean {
    if (keybindings.getKeybindingsForCommand(QAAP_SCM_ACCEPT_INPUT_COMMAND).length > 0) {
        return false;
    }
    keybindings.registerKeybinding({
        command: QAAP_SCM_ACCEPT_INPUT_COMMAND,
        keybinding: QAAP_SCM_ACCEPT_INPUT_KEYBINDING,
        when: 'scmFocus',
    });
    return true;
}

/** Qaap seam for the SCM commit-input accelerator used by ScmCommitWidget. */
@injectable()
export class QaapScmKeybindingContribution implements KeybindingContribution {

    registerKeybindings(keybindings: KeybindingRegistry): void {
        ensureQaapScmAcceptInputKeybinding(keybindings);
    }
}

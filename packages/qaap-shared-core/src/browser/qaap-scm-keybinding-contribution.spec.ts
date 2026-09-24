// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import {
    ensureQaapScmAcceptInputKeybinding,
    QAAP_SCM_ACCEPT_INPUT_COMMAND,
    QAAP_SCM_ACCEPT_INPUT_KEYBINDING,
    QaapScmKeybindingContribution,
} from './qaap-scm-keybinding-contribution';

describe('QaapScmKeybindingContribution', () => {

    function createRegistry(existing: Array<{ command: string; keybinding: string }> = []): {
        registry: KeybindingRegistry;
        registered: Array<{ command: string; keybinding: string; when?: string }>;
    } {
        const registered: Array<{ command: string; keybinding: string; when?: string }> = [];
        const registry = {
            getKeybindingsForCommand: (command: string) => existing.filter(binding => binding.command === command),
            registerKeybinding: (binding: { command: string; keybinding: string; when?: string }) => {
                registered.push(binding);
            },
        } as unknown as KeybindingRegistry;
        return { registry, registered };
    }

    it('registers the SCM accept-input fallback when upstream has no binding', () => {
        const { registry, registered } = createRegistry();

        expect(ensureQaapScmAcceptInputKeybinding(registry)).to.equal(true);
        expect(registered).to.deep.equal([{
            command: QAAP_SCM_ACCEPT_INPUT_COMMAND,
            keybinding: QAAP_SCM_ACCEPT_INPUT_KEYBINDING,
            when: 'scmFocus',
        }]);
    });

    it('does not duplicate an upstream SCM accept-input binding', () => {
        const { registry, registered } = createRegistry([{
            command: QAAP_SCM_ACCEPT_INPUT_COMMAND,
            keybinding: QAAP_SCM_ACCEPT_INPUT_KEYBINDING,
        }]);

        expect(new QaapScmKeybindingContribution().registerKeybindings(registry)).to.equal(undefined);
        expect(registered).to.deep.equal([]);
    });
});

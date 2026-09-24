// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { CommonCommands } from '@theia/core/lib/browser/common-commands';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import {
    ensureQaapCoreCopyKeybinding,
    QAAP_CORE_COPY_KEYBINDING,
    QaapCoreKeybindingContribution,
} from './qaap-core-keybinding-contribution';

describe('QaapCoreKeybindingContribution', () => {

    function createRegistry(existing: Array<{ command: string; keybinding: string }> = []): {
        registry: KeybindingRegistry;
        registered: Array<{ command: string; keybinding: string }>;
    } {
        const registered: Array<{ command: string; keybinding: string }> = [];
        const registry = {
            getKeybindingsForCommand: (command: string) => existing.filter(binding => binding.command === command),
            registerKeybinding: (binding: { command: string; keybinding: string }) => {
                registered.push(binding);
            },
        } as unknown as KeybindingRegistry;
        return { registry, registered };
    }

    it('restores the core copy binding when the browser capability probe omitted it', () => {
        const { registry, registered } = createRegistry();

        expect(ensureQaapCoreCopyKeybinding(registry)).to.equal(true);
        expect(registered).to.deep.equal([
            {
                command: CommonCommands.COPY.id,
                keybinding: QAAP_CORE_COPY_KEYBINDING,
            },
            {
                command: CommonCommands.FIND.id,
                keybinding: 'ctrlcmd+f',
            },
            {
                command: CommonCommands.REPLACE.id,
                keybinding: 'ctrlcmd+alt+f',
            },
        ]);
    });

    it('does not duplicate the binding when Theia already registered it', () => {
        const { registry, registered } = createRegistry([
            {
                command: CommonCommands.COPY.id,
                keybinding: QAAP_CORE_COPY_KEYBINDING,
            },
            {
                command: CommonCommands.FIND.id,
                keybinding: 'ctrlcmd+f',
            },
            {
                command: CommonCommands.REPLACE.id,
                keybinding: 'ctrlcmd+alt+f',
            },
        ]);

        expect(new QaapCoreKeybindingContribution().registerKeybindings(registry)).to.equal(undefined);
        expect(registered).to.deep.equal([]);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { KeybindingRegistry } from '@theia/core/lib/browser';

// Browser services import Lumino modules that touch document at module load time. This package's
// default test command is Node-only, so initialize the lightweight DOM before requiring them.
const { enableJSDOM } = require('@theia/core/lib/browser/test/jsdom') as typeof import('@theia/core/lib/browser/test/jsdom');
enableJSDOM();
const { KeybindingScope } = require('@theia/core/lib/browser') as typeof import('@theia/core/lib/browser');
const { QuickFileOpenService, quickFileOpen } = require('./quick-file-open') as typeof import('./quick-file-open');

class TestQuickFileOpenService extends QuickFileOpenService {

    resolveKeyCommand(): string | undefined {
        return this.getKeyCommand();
    }

    setKeybindingRegistry(registry: Pick<KeybindingRegistry, 'getKeybindingsForCommand' | 'acceleratorFor'>): void {
        (this as unknown as { keybindingRegistry: Pick<KeybindingRegistry, 'getKeybindingsForCommand' | 'acceleratorFor'> }).keybindingRegistry = registry;
    }
}

describe('QuickFileOpenService', () => {

    it('does not resolve an undefined binding during bootstrap', () => {
        const service = new TestQuickFileOpenService();
        let acceleratorCalls = 0;
        service.setKeybindingRegistry({
            getKeybindingsForCommand: () => [],
            acceleratorFor: () => {
                acceleratorCalls++;
                return [];
            },
        });

        expect(service.resolveKeyCommand()).to.equal(undefined);
        expect(acceleratorCalls).to.equal(0);
    });

    it('formats the first registered binding', () => {
        const service = new TestQuickFileOpenService();
        service.setKeybindingRegistry({
            getKeybindingsForCommand: command => command === quickFileOpen.id
                ? [{ command, keybinding: 'ctrlcmd+p', scope: KeybindingScope.DEFAULT }]
                : [],
            acceleratorFor: () => ['⌘P'],
        });

        expect(service.resolveKeyCommand()).to.equal('⌘P');
    });
});

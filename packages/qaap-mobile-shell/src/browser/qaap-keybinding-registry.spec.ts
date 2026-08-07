// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapKeybindingRegistry } from './qaap-keybinding-registry';

describe('QaapKeybindingRegistry', () => {
    it('does not throw when a widget asks for an optional missing binding', () => {
        const registry = Object.create(QaapKeybindingRegistry.prototype) as QaapKeybindingRegistry;
        expect(registry.resolveKeybinding(undefined)).to.deep.equal([]);
    });
});

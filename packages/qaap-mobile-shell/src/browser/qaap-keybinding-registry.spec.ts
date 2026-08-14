// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { QaapKeybindingRegistry } from './qaap-keybinding-registry';

describe('QaapKeybindingRegistry', () => {

    before(() => {
        enableJSDOM();
    });
    it('does not throw when a widget asks for an optional missing binding', () => {
        const registry = Object.create(QaapKeybindingRegistry.prototype) as QaapKeybindingRegistry;
        expect(registry.resolveKeybinding(undefined)).to.deep.equal([]);
    });

    it('lets Cmd/Ctrl+Enter reach the sticky composer textarea', () => {
        const registry = Object.create(QaapKeybindingRegistry.prototype) as QaapKeybindingRegistry;
        const input = document.createElement('textarea');
        input.className = 'theia-mobile-projects-sticky-composer-input';
        const event = {
            key: 'Enter',
            altKey: false,
            shiftKey: false,
            metaKey: true,
            ctrlKey: false,
            target: input,
        } as unknown as KeyboardEvent;
        expect((registry as unknown as {
            shouldPassthroughComposerDeliveryShortcut: (ev: KeyboardEvent) => boolean;
        }).shouldPassthroughComposerDeliveryShortcut(event)).to.equal(true);
        expect((registry as unknown as {
            shouldPassthroughComposerDeliveryShortcut: (ev: KeyboardEvent) => boolean;
        }).shouldPassthroughComposerDeliveryShortcut({
            ...event,
            target: document.createElement('div'),
        } as unknown as KeyboardEvent)).to.equal(false);
    });
});

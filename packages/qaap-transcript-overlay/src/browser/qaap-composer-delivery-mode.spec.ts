// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    resolveBusyFollowUpDeliveryMode,
    resolveComposerEnterDeliveryOverride,
    shouldBypassLocalFollowUpQueue,
} from './qaap-composer-delivery-mode';

describe('qaap-composer-delivery-mode', () => {

    it('maps Enter modifiers to one-shot delivery overrides', () => {
        expect(resolveComposerEnterDeliveryOverride({
            key: 'Enter', shiftKey: false, altKey: false, metaKey: false, ctrlKey: false,
        })).to.equal(undefined);
        // Shift+Enter is newline — not parallel.
        expect(resolveComposerEnterDeliveryOverride({
            key: 'Enter', shiftKey: true, altKey: false, metaKey: false, ctrlKey: false,
        })).to.equal(undefined);
        expect(resolveComposerEnterDeliveryOverride({
            key: 'Enter', shiftKey: false, altKey: true, metaKey: false, ctrlKey: false,
        })).to.equal('parallel');
        expect(resolveComposerEnterDeliveryOverride({
            key: 'Enter', shiftKey: false, altKey: false, metaKey: true, ctrlKey: false,
        })).to.equal('interrupt');
        expect(resolveComposerEnterDeliveryOverride({
            key: 'Enter', shiftKey: false, altKey: false, metaKey: false, ctrlKey: true,
        })).to.equal('interrupt');
        expect(resolveComposerEnterDeliveryOverride({
            key: 'a', shiftKey: true, altKey: false, metaKey: false, ctrlKey: false,
        })).to.equal(undefined);
    });

    it('always posts to the server queue (local queue is fallback only)', () => {
        expect(shouldBypassLocalFollowUpQueue('queue')).to.equal(true);
        expect(shouldBypassLocalFollowUpQueue('parallel')).to.equal(true);
        expect(shouldBypassLocalFollowUpQueue('interrupt')).to.equal(true);
        expect(resolveBusyFollowUpDeliveryMode({})).to.equal('queue');
        expect(resolveBusyFollowUpDeliveryMode({ forceDeliveryMode: 'interrupt' })).to.equal('interrupt');
        expect(resolveBusyFollowUpDeliveryMode({ forceDeliveryMode: 'parallel' })).to.equal('parallel');
    });
});

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
    });

    it('keeps queue on the local popover; bypasses only parallel and interrupt', () => {
        expect(shouldBypassLocalFollowUpQueue('queue')).to.equal(false);
        expect(shouldBypassLocalFollowUpQueue('parallel')).to.equal(true);
        expect(shouldBypassLocalFollowUpQueue('interrupt')).to.equal(true);
        expect(resolveBusyFollowUpDeliveryMode({})).to.equal('queue');
    });
});

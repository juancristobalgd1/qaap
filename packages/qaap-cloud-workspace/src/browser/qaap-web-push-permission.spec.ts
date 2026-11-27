// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { canAttemptWebPushSubscription } from './qaap-web-push-permission';

describe('canAttemptWebPushSubscription', () => {
    it('blocks automatic boot subscription when permission is denied or default', () => {
        expect(canAttemptWebPushSubscription('denied')).to.equal(false);
        expect(canAttemptWebPushSubscription('default')).to.equal(false);
    });

    it('allows automatic boot subscription when permission is already granted', () => {
        expect(canAttemptWebPushSubscription('granted')).to.equal(true);
    });

    it('allows subscription on an explicit user gesture when default, but still blocks denied', () => {
        expect(canAttemptWebPushSubscription('default', { userGesture: true })).to.equal(true);
        expect(canAttemptWebPushSubscription('granted', { userGesture: true })).to.equal(true);
        expect(canAttemptWebPushSubscription('denied', { userGesture: true })).to.equal(false);
    });
});

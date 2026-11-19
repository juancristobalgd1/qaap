// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_COMPOSER_STOP_CLICK_GUARD_MS, QaapComposerStopClickGuard, resolveQaapComposerSendControl } from './qaap-composer-send-stop';

describe('qaap-composer-send-stop', () => {

    it('sends while idle, queues while a turn runs with content, and stops only an empty composer', () => {
        expect(resolveQaapComposerSendControl({ working: false, hasContent: false })).to.equal('send');
        expect(resolveQaapComposerSendControl({ working: true, hasContent: true })).to.equal('send');
        expect(resolveQaapComposerSendControl({ working: true, hasContent: false })).to.equal('stop');
    });

    it('does not offer Stop again while an earlier Stop is unacknowledged, unless it became retryable', () => {
        expect(resolveQaapComposerSendControl({ working: true, hasContent: false, submitBlocked: true })).to.equal('send');
        expect(resolveQaapComposerSendControl({ working: true, hasContent: false, submitBlocked: true, stopRetryable: true })).to.equal('stop');
    });

    it('ignores a Stop click right after a send or right after the button turned into Stop', () => {
        const guard = new QaapComposerStopClickGuard();
        guard.noteSend(1000);
        guard.noteControl('stop', 1100);
        expect(guard.allowsStop(1200)).to.equal(false);
        expect(guard.allowsStop(1100 + QAAP_COMPOSER_STOP_CLICK_GUARD_MS - 1)).to.equal(false);
        expect(guard.allowsStop(1100 + QAAP_COMPOSER_STOP_CLICK_GUARD_MS)).to.equal(true);
    });

    it('starts the window only when the button turns into Stop, not on every repaint', () => {
        const guard = new QaapComposerStopClickGuard();
        guard.noteControl('stop', 0);
        guard.noteControl('stop', 5000);
        expect(guard.allowsStop(5001)).to.equal(true);
    });
});

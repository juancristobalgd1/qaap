// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveComposerStopTarget } from './qaap-composer-stop-target';

describe('resolveComposerStopTarget', () => {

    const stale = { id: 'conv-old', title: 'Mount-time closure' };
    const open = { id: 'conv-open', title: 'Open transcript' };

    it('keeps the closure summary when it is the open conversation', () => {
        expect(resolveComposerStopTarget(open, 'conv-open', open)).to.equal(open);
    });

    it('keeps the closure summary when no transcript is open', () => {
        expect(resolveComposerStopTarget(stale, undefined, undefined)).to.equal(stale);
    });

    it('redirects a stale closure to the open conversation, never to the older one', () => {
        expect(resolveComposerStopTarget(stale, 'conv-open', open)).to.equal(open);
    });

    it('has no target when the open conversation cannot be resolved', () => {
        expect(resolveComposerStopTarget(stale, 'conv-open', undefined)).to.equal(undefined);
        expect(resolveComposerStopTarget(stale, 'conv-open', stale)).to.equal(undefined);
    });
});

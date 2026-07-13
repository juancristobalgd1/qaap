// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { shouldCaptureSettledVisualTurn } from './qaap-visual-settlement';

describe('shouldCaptureSettledVisualTurn', () => {
    it('waits through visual settlement and captures once at idle', () => {
        const pending = new Set<string>();
        expect(shouldCaptureSettledVisualTurn(pending, { id: 'turn-1', status: 'streaming' })).to.equal(false);
        expect(shouldCaptureSettledVisualTurn(pending, { id: 'turn-1', status: 'settled' })).to.equal(false);
        expect(shouldCaptureSettledVisualTurn(pending, { id: 'turn-1', status: 'idle' })).to.equal(true);
        expect(shouldCaptureSettledVisualTurn(pending, { id: 'turn-1', status: 'idle' })).to.equal(false);
    });

    it('drops failed turns without capturing them', () => {
        const pending = new Set<string>();
        shouldCaptureSettledVisualTurn(pending, { id: 'turn-1', status: 'streaming' });
        expect(shouldCaptureSettledVisualTurn(pending, { id: 'turn-1', status: 'failed' })).to.equal(false);
        expect(pending.size).to.equal(0);
    });
});

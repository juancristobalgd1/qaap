// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapTurnStopPreviewRequestAction } from './qaap-transcript-turn-status';

describe('resolveQaapTurnStopPreviewRequestAction', () => {
    it('does nothing when no preview request is pending or running', () => {
        expect(resolveQaapTurnStopPreviewRequestAction({ requestPending: false, requestRunning: false, bootstrapPhase: 'starting' }))
            .to.equal('none');
    });

    it('clears a request that only waits on the agent (no bootstrap yet, no URL)', () => {
        expect(resolveQaapTurnStopPreviewRequestAction({ requestPending: true, requestRunning: false, bootstrapPhase: 'ready-to-run' }))
            .to.equal('clear');
        expect(resolveQaapTurnStopPreviewRequestAction({ requestPending: true, requestRunning: false }))
            .to.equal('clear');
    });

    it('keeps a real bootstrap that is installing, starting or serving the app', () => {
        for (const bootstrapPhase of ['installing', 'starting', 'running']) {
            expect(resolveQaapTurnStopPreviewRequestAction({ requestPending: true, requestRunning: true, bootstrapPhase }))
                .to.equal('keep');
        }
    });

    it('clears once a preview URL already answers, even while the bootstrap is running', () => {
        expect(resolveQaapTurnStopPreviewRequestAction({
            requestPending: true,
            requestRunning: false,
            bootstrapPhase: 'running',
            previewUrl: 'http://127.0.0.1:5173/',
        })).to.equal('clear');
    });
});

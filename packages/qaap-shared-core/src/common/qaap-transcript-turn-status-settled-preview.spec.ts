// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapSettledPreviewRequestAction, type QaapSettledPreviewRequestInput } from './qaap-transcript-turn-status';

function input(overrides: Partial<QaapSettledPreviewRequestInput> = {}): QaapSettledPreviewRequestInput {
    return {
        requestPending: true,
        requestRunning: false,
        bootstrapPhase: undefined,
        previewUrl: undefined,
        conversationStatus: 'idle',
        turnEndedBadly: false,
        suppressedByUser: false,
        canRelaunch: true,
        ...overrides,
    };
}

describe('resolveQaapSettledPreviewRequestAction', () => {
    it('does nothing without a preview request', () => {
        expect(resolveQaapSettledPreviewRequestAction(input({ requestPending: false }))).to.equal('none');
    });

    it('keeps waiting while the backend turn is still streaming (visual settle)', () => {
        expect(resolveQaapSettledPreviewRequestAction(input({ conversationStatus: 'streaming' }))).to.equal('keep');
    });

    it('hands a chat request to the Qaap launch once the turn completed', () => {
        expect(resolveQaapSettledPreviewRequestAction(input())).to.equal('relaunch');
    });

    it('clears a chat request when no launcher can run it', () => {
        expect(resolveQaapSettledPreviewRequestAction(input({ canRelaunch: false }))).to.equal('clear');
    });

    it('clears a request after a failed or cancelled turn (no endless spinner)', () => {
        expect(resolveQaapSettledPreviewRequestAction(input({ turnEndedBadly: true, conversationStatus: 'failed' }))).to.equal('clear');
        expect(resolveQaapSettledPreviewRequestAction(input({
            turnEndedBadly: true, requestRunning: true, bootstrapPhase: 'run-failed',
        }))).to.equal('clear');
    });

    it('keeps the chip after a failed turn only while the bootstrap is actively starting the app', () => {
        expect(resolveQaapSettledPreviewRequestAction(input({
            turnEndedBadly: true, requestRunning: true, bootstrapPhase: 'installing',
        }))).to.equal('keep');
    });

    it('never relaunches after the user stopped the preview', () => {
        expect(resolveQaapSettledPreviewRequestAction(input({ suppressedByUser: true }))).to.equal('clear');
    });

    it('leaves a request owned by a running Qaap launch alone after a completed turn', () => {
        expect(resolveQaapSettledPreviewRequestAction(input({ requestRunning: true }))).to.equal('keep');
    });
});

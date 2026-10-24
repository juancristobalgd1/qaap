// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    APPROVAL_POLL_BASE_MS,
    APPROVAL_POLL_ERROR_MAX_MS,
    APPROVAL_POLL_HIDDEN_CHECK_MS,
    APPROVAL_POLL_IDLE_MAX_MS,
    INITIAL_APPROVAL_POLL_STATE,
    approvalListKey,
    nextApprovalPollDelayMs,
    recordApprovalPollOutcome,
} from './qaap-approval-poll-backoff';

describe('approval poll backoff', () => {
    it('starts at the base cadence and grows while the list is unchanged, up to the idle cap', () => {
        let state = INITIAL_APPROVAL_POLL_STATE;
        expect(nextApprovalPollDelayMs(state)).to.equal(APPROVAL_POLL_BASE_MS);
        state = recordApprovalPollOutcome(state, 'unchanged');
        expect(nextApprovalPollDelayMs(state)).to.equal(APPROVAL_POLL_BASE_MS * 2);
        state = recordApprovalPollOutcome(state, 'unchanged');
        state = recordApprovalPollOutcome(state, 'unchanged');
        expect(nextApprovalPollDelayMs(state)).to.equal(APPROVAL_POLL_IDLE_MAX_MS);
    });

    it('resets to the base cadence when the pending list changes', () => {
        let state = INITIAL_APPROVAL_POLL_STATE;
        for (let i = 0; i < 5; i++) {
            state = recordApprovalPollOutcome(state, 'unchanged');
        }
        state = recordApprovalPollOutcome(state, 'changed');
        expect(nextApprovalPollDelayMs(state)).to.equal(APPROVAL_POLL_BASE_MS);
    });

    it('doubles the delay on consecutive errors and never exceeds the error cap', () => {
        let state = INITIAL_APPROVAL_POLL_STATE;
        const delays: number[] = [];
        for (let i = 0; i < 8; i++) {
            state = recordApprovalPollOutcome(state, 'error');
            delays.push(nextApprovalPollDelayMs(state));
        }
        expect(delays[0]).to.equal(APPROVAL_POLL_BASE_MS * 2);
        expect(delays[1]).to.equal(APPROVAL_POLL_BASE_MS * 4);
        expect(Math.max(...delays)).to.equal(APPROVAL_POLL_ERROR_MAX_MS);
    });

    it('returns to the idle cadence after an error once a poll succeeds', () => {
        let state = recordApprovalPollOutcome(INITIAL_APPROVAL_POLL_STATE, 'error');
        state = recordApprovalPollOutcome(state, 'unchanged');
        expect(state.failures).to.equal(0);
        expect(nextApprovalPollDelayMs(state)).to.equal(APPROVAL_POLL_BASE_MS * 2);
    });

    it('uses only the hidden re-check interval while the document is hidden', () => {
        let state = INITIAL_APPROVAL_POLL_STATE;
        for (let i = 0; i < 5; i++) {
            state = recordApprovalPollOutcome(state, 'error');
        }
        expect(nextApprovalPollDelayMs(state, false)).to.equal(APPROVAL_POLL_HIDDEN_CHECK_MS);
        expect(nextApprovalPollDelayMs(state, true)).to.equal(APPROVAL_POLL_ERROR_MAX_MS);
    });

    it('keys approval lists by id so identical lists compare equal', () => {
        const a = [{ id: 'x' }, { id: 'y' }];
        expect(approvalListKey(a)).to.equal(approvalListKey([{ id: 'x' }, { id: 'y' }]));
        expect(approvalListKey(a)).to.not.equal(approvalListKey([{ id: 'y' }]));
        expect(approvalListKey([])).to.equal('');
    });
});

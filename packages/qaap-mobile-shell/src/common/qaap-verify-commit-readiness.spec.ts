// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    evaluateVerifyCommitReadiness,
    invalidateVerifyWorkspaceSnapshots,
    type VerifyCommitCheckSnapshot,
} from './qaap-verify-commit-readiness';

function check(state: VerifyCommitCheckSnapshot['state'], workspaceSnapshot?: VerifyCommitCheckSnapshot['workspaceSnapshot']): VerifyCommitCheckSnapshot {
    return { state, workspaceSnapshot };
}

describe('evaluateVerifyCommitReadiness', () => {

    it('blocks while checks are loading or running', () => {
        expect(evaluateVerifyCommitReadiness({
            checksLoading: true,
            running: false,
            results: [check('idle')],
        })).to.deep.equal({ level: 'loading', requiresConfirmation: false, blocksCommit: true });
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: true,
            results: [check('idle')],
        }).level).to.equal('running');
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results: [check('checking')],
        }).blocksCommit).to.equal(true);
    });

    it('does not warn when no checks are configured', () => {
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results: [],
        })).to.deep.equal({ level: 'not_configured', requiresConfirmation: false, blocksCommit: false });
    });

    it('asks for confirmation when checks failed, were never run, or no longer match files', () => {
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results: [check('fail', 'current')],
        }).level).to.equal('failing');
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results: [check('idle')],
        }).level).to.equal('missing');
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results: [check('ok', 'changed')],
        }).level).to.equal('stale');
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results: [check('ok', 'unknown')],
        }).level).to.equal('stale');
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results: [check('ok')],
        }).level).to.equal('stale');
    });

    it('is ready only when every check passed against the current files', () => {
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results: [check('ok', 'current'), check('ok', 'current')],
        })).to.deep.equal({ level: 'ready', requiresConfirmation: false, blocksCommit: false });
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results: [check('ok', 'current'), check('ok', 'changed')],
        }).level).to.equal('stale');
    });

    it('invalidates snapshots so a later commit cannot reuse stale green evidence', () => {
        const results = [check('ok', 'current')];
        invalidateVerifyWorkspaceSnapshots(results);
        expect(results[0].workspaceSnapshot).to.equal('unknown');
        expect(evaluateVerifyCommitReadiness({
            checksLoading: false,
            running: false,
            results,
        }).level).to.equal('stale');
    });
});

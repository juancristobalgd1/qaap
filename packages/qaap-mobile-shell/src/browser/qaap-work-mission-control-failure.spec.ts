// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveMissionControlFailure } from './qaap-work-mission-control-failure';

describe('resolveMissionControlFailure', () => {

    it('returns undefined for non-failed conversations', () => {
        expect(resolveMissionControlFailure({
            id: 'c1',
            status: 'idle',
            title: 'Done',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
            agentId: 'qaiq',
            cwd: '/repo',
        })).to.equal(undefined);
    });

    it('classifies quota failures and localizes the preview', () => {
        const result = resolveMissionControlFailure({
            id: 'c-quota',
            status: 'failed',
            title: 'Refactor sidebar',
            lastMessagePreview: 'Error: insufficient_quota for model gpt-4',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 2,
            agentId: 'qaiq',
            cwd: '/repo',
        });
        expect(result?.kind).to.equal('quota');
        expect(result?.preview).to.include('credit');
    });

    it('localizes legacy agent failure previews', () => {
        const result = resolveMissionControlFailure({
            id: 'c-generic',
            status: 'failed',
            title: 'Task',
            lastMessagePreview: 'Agent failed (exit 1).',
            createdAt: 1,
            updatedAt: 2,
            messageCount: 1,
            agentId: 'codex',
            cwd: '/repo',
        });
        expect(result?.kind).to.equal(undefined);
        expect(result?.preview).to.include('task');
    });
});

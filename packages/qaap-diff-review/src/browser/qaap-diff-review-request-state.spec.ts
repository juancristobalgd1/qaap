// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { AgentDiffRequestIdentity, isCurrentAgentDiffRequest } from './qaap-diff-review-request-state';

describe('qaap diff review request state', () => {
    const current: AgentDiffRequestIdentity = {
        disposed: false,
        requestPath: 'src/current.ts',
        requestRoot: '/workspace/one',
        requestGeneration: 4,
        requestSerial: 9,
        currentRoot: '/workspace/one',
        currentGeneration: 4,
        latestSerial: 9,
        currentPaths: ['src/current.ts'],
    };

    it('accepts only the latest response for the active file and project', () => {
        expect(isCurrentAgentDiffRequest(current)).to.equal(true);
        expect(isCurrentAgentDiffRequest({ ...current, latestSerial: 10 })).to.equal(false);
        expect(isCurrentAgentDiffRequest({ ...current, currentGeneration: 5 })).to.equal(false);
        expect(isCurrentAgentDiffRequest({ ...current, currentRoot: '/workspace/two' })).to.equal(false);
        expect(isCurrentAgentDiffRequest({ ...current, currentPaths: [] })).to.equal(false);
    });

    it('rejects responses after the widget is disposed', () => {
        expect(isCurrentAgentDiffRequest({ ...current, disposed: true })).to.equal(false);
    });
});

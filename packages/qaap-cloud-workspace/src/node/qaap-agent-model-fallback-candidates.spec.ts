// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { discoveredFallbackModels } from './qaap-agent-model-fallback-candidates';

describe('qaap-agent-model-fallback-candidates', () => {
    it('offers no discovered candidates for agents other than Pi', () => {
        expect(discoveredFallbackModels('qaiq', 'octocat')).to.deep.equal([]);
        expect(discoveredFallbackModels('codex', 'octocat')).to.deep.equal([]);
    });

    it('offers Pi candidates as provider, vendor and model id only', () => {
        const candidates = discoveredFallbackModels('pi', 'octocat');
        expect(candidates.length).to.be.greaterThan(0);
        for (const candidate of candidates) {
            expect(Object.keys(candidate).sort()).to.deep.equal(['modelId', 'provider', 'vendor']);
        }
    });
});

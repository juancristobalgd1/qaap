// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    getQaapAgentLoadingPhrases,
    resolveQaapAgentLoadingPhraseIndex,
    shouldCycleQaapAgentLoadingPhrases,
} from './qaap-agent-loading-phrases';

describe('qaap-agent-loading-phrases', () => {
    it('returns five localized loading phrases', () => {
        expect(getQaapAgentLoadingPhrases()).to.have.length(5);
    });

    it('wraps phrase index modulo phrase count', () => {
        expect(resolveQaapAgentLoadingPhraseIndex(6, 5)).to.equal(1);
        expect(resolveQaapAgentLoadingPhraseIndex(-1, 5)).to.equal(4);
    });

    it('cycles only for indeterminate agent activity kinds', () => {
        expect(shouldCycleQaapAgentLoadingPhrases('thinking')).to.equal(true);
        expect(shouldCycleQaapAgentLoadingPhrases('starting')).to.equal(true);
        expect(shouldCycleQaapAgentLoadingPhrases('writing')).to.equal(true);
        expect(shouldCycleQaapAgentLoadingPhrases('read')).to.equal(false);
        expect(shouldCycleQaapAgentLoadingPhrases('bash')).to.equal(false);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { computePrReadiness } from './qaap-git-review';

describe('computePrReadiness', () => {
    it('offers a PR on a feature branch ahead of default', () => {
        expect(computePrReadiness('feature/x', 'main', 2)).to.deep.equal({
            canCreatePr: true, aheadCount: 2, defaultBranch: 'main',
        });
    });

    it('does not offer a PR on the default branch', () => {
        expect(computePrReadiness('main', 'main', 3).canCreatePr).to.equal(false);
    });

    it('does not offer a PR when the branch is not ahead', () => {
        expect(computePrReadiness('feature/x', 'main', 0).canCreatePr).to.equal(false);
    });

    it('does not offer a PR when the branch is unknown (detached HEAD)', () => {
        expect(computePrReadiness(undefined, 'main', 5).canCreatePr).to.equal(false);
    });

    it('does not offer a PR when the default branch cannot be resolved', () => {
        expect(computePrReadiness('feature/x', undefined, 2).canCreatePr).to.equal(false);
    });
});

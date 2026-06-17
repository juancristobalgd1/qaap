// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { hasQaapLeftRightSplitPanel } from './qaap-shell-layout';

describe('hasQaapLeftRightSplitPanel', () => {
    it('returns false when leftRightSplitPanel is missing', () => {
        expect(hasQaapLeftRightSplitPanel({} as never)).to.equal(false);
    });

    it('returns false when leftRightSplitPanel is falsy', () => {
        expect(hasQaapLeftRightSplitPanel({ leftRightSplitPanel: undefined } as never)).to.equal(false);
    });

    it('returns true when leftRightSplitPanel is present', () => {
        const panel = {} as never;
        expect(hasQaapLeftRightSplitPanel({ leftRightSplitPanel: panel } as never)).to.equal(true);
    });
});

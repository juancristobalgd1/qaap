// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { hasQaapLeftRightSplitPanel } from './qaap-shell-layout';

describe('qaap-shell-layout', () => {

    it('hasQaapLeftRightSplitPanel is false without leftRightSplitPanel', () => {
        expect(hasQaapLeftRightSplitPanel({} as ApplicationShell)).to.be.false;
    });

    it('hasQaapLeftRightSplitPanel is true when leftRightSplitPanel is present', () => {
        const shell = { leftRightSplitPanel: {} } as unknown as ApplicationShell;
        expect(hasQaapLeftRightSplitPanel(shell)).to.be.true;
    });

});

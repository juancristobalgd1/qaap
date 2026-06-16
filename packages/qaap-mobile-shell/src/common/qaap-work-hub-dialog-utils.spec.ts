// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
import { isWorkHubTheiaDialogOpen } from './qaap-work-hub-dialog-utils';

describe('qaap-work-hub-dialog-utils', () => {

    let disableJSDOM: (() => void) | undefined;

    beforeEach(() => {
        disableJSDOM = enableJSDOM();
    });

    afterEach(() => {
        disableJSDOM?.();
        disableJSDOM = undefined;
    });

    it('isWorkHubTheiaDialogOpen returns false when no overlay is mounted', () => {
        expect(isWorkHubTheiaDialogOpen()).to.equal(false);
    });

    it('isWorkHubTheiaDialogOpen returns true for a visible dialog overlay', () => {
        document.body.innerHTML = `
            <div class="lm-Widget dialogOverlay" id="theia-dialog-shell">
                <div class="dialogBlock"><div class="dialogContent"></div></div>
            </div>
        `;
        expect(isWorkHubTheiaDialogOpen()).to.equal(true);
    });

    it('isWorkHubTheiaDialogOpen ignores hidden overlays', () => {
        document.body.innerHTML = `
            <div class="lm-Widget dialogOverlay hidden">
                <div class="dialogBlock"></div>
            </div>
        `;
        expect(isWorkHubTheiaDialogOpen()).to.equal(false);
    });
});

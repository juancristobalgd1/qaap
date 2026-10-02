// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { useSuiteJSDOM } from '@theia/qaap-mobile-shell/lib/browser/test/qaap-jsdom-suite';
import { syncStickyComposerRunPermissions } from './mobile-projects-sticky-composer-column-ui';

describe('sticky composer running-turn permissions', () => {

    useSuiteJSDOM();

    it('shows the running turn configuration read-only and hides it when idle', () => {
        const status = document.createElement('div');
        const text = document.createElement('span');
        status.setAttribute('role', 'status');
        status.append(text);

        syncStickyComposerRunPermissions(status, text, false, () => 'Build · Request approval');
        expect(status.hidden).to.equal(true);

        syncStickyComposerRunPermissions(status, text, true, () => 'Build · Request approval');
        expect(status.hidden).to.equal(false);
        expect(status.getAttribute('role')).to.equal('status');
        expect(text.textContent).to.equal('Build · Request approval');
        expect(status.title).to.contain('Build · Request approval');

        syncStickyComposerRunPermissions(status, text, false, () => 'Build · Request approval');
        expect(status.hidden).to.equal(true);
    });
});

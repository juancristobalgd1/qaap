// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createMobileStoppedTurnLineElement, MOBILE_STOPPED_TURN_LINE_CLASS } from './mobile-stopped-turn-line';

describe('createMobileStoppedTurnLineElement', () => {
    it('renders a status line with the cancelled tone and a visible label', () => {
        const line = createMobileStoppedTurnLineElement();
        expect(line.classList.contains(MOBILE_STOPPED_TURN_LINE_CLASS)).to.equal(true);
        expect(line.classList.contains('theia-mod-cancelled')).to.equal(true);
        expect(line.getAttribute('role')).to.equal('status');
        expect(line.textContent).to.equal('Turn stopped');
    });

    it('keeps the icon decorative', () => {
        const icon = createMobileStoppedTurnLineElement().querySelector('.codicon-circle-slash');
        expect(icon?.getAttribute('aria-hidden')).to.equal('true');
    });
});

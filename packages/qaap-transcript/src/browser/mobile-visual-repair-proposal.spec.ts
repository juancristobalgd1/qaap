// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { createMobileVisualRepairProposalElement, MOBILE_VISUAL_REPAIR_PROPOSAL_CLASS } from './mobile-visual-repair-proposal';

describe('createMobileVisualRepairProposalElement', () => {
    it('offers "Fix with agent" and "Dismiss" under the evidence message', () => {
        const element = createMobileVisualRepairProposalElement({ id: 'c-proposal-1' }, { id: 'a-proposal-1' });
        expect(element?.classList.contains(MOBILE_VISUAL_REPAIR_PROPOSAL_CLASS)).to.equal(true);
        const labels = Array.from(element?.querySelectorAll('button') ?? []).map(button => button.textContent);
        expect(labels).to.deep.equal(['Fix with agent', 'Dismiss']);
    });

    it('does not offer a proposal the user dismissed in this session', () => {
        const element = createMobileVisualRepairProposalElement({ id: 'c-proposal-2' }, { id: 'a-proposal-2' });
        element?.querySelectorAll('button')[1].click();
        expect(element?.isConnected ?? false).to.equal(false);
        expect(createMobileVisualRepairProposalElement({ id: 'c-proposal-2' }, { id: 'a-proposal-2' })).to.equal(undefined);
    });
});

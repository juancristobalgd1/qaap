// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { normalizeWorkHubViewId } from '@theia/qaap-shared-core/lib/common/qaap-work-hub-surfaces';

describe('qaap-work-hub-surfaces', () => {
    it('maps removed landing hub ids to the unified Agents Work Hub', () => {
        expect(normalizeWorkHubViewId('chats')).to.equal('tasks');
        expect(normalizeWorkHubViewId('team')).to.equal('tasks');
        expect(normalizeWorkHubViewId('work')).to.equal('tasks');
        expect(normalizeWorkHubViewId('repos')).to.equal('tasks');
        expect(normalizeWorkHubViewId('home')).to.equal('tasks');
    });

});

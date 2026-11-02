// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { readBackendDefaultAgentId } from './qaap-default-agent-id';

describe('qaap-default-agent-id (backend)', () => {
    it('reads QAAP_DEFAULT_AGENT_ID and falls back to qaiq', () => {
        expect(readBackendDefaultAgentId({})).to.equal('qaiq');
        expect(readBackendDefaultAgentId({ QAAP_DEFAULT_AGENT_ID: 'pi' })).to.equal('pi');
        expect(readBackendDefaultAgentId({ QAAP_DEFAULT_AGENT_ID: 'nope' })).to.equal('qaiq');
    });
});

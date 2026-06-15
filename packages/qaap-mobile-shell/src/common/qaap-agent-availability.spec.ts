// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    isVpsAgentBackendConfigured,
    localizeNoVpsAgentConfiguredBanner,
    localizeNoVpsAgentConfiguredMessage,
    qaapDefaultAgentProductId,
} from './qaap-agent-availability';
import { QAIQ_AGENT_ID } from './qaap-agent-task-client';

describe('qaap-agent-availability', () => {

    it('isVpsAgentBackendConfigured requires explicit true', () => {
        expect(isVpsAgentBackendConfigured(true)).to.equal(true);
        expect(isVpsAgentBackendConfigured(false)).to.equal(false);
        expect(isVpsAgentBackendConfigured(undefined)).to.equal(false);
    });

    it('localize helpers return non-empty strings', () => {
        expect(localizeNoVpsAgentConfiguredMessage().length).to.be.greaterThan(10);
        expect(localizeNoVpsAgentConfiguredBanner().length).to.be.greaterThan(10);
    });

    it('qaapDefaultAgentProductId is qaiq', () => {
        expect(qaapDefaultAgentProductId()).to.equal(QAIQ_AGENT_ID);
    });
});

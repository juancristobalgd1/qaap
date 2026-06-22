// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    buildSubagentDeniedMessage,
    extractRequestedSubagentType,
    isKnownUnavailableSubagentType,
} from './qaap-agent-subagent-policy';
import { buildQaiqAutoDeniedToolMessage } from './qaap-qaiq-control-auto-response';

describe('qaap-agent-subagent-policy', () => {

    it('extractRequestedSubagentType reads subagent_type from tool input', () => {
        expect(extractRequestedSubagentType({ subagent_type: 'web-dev' })).to.equal('web-dev');
        expect(extractRequestedSubagentType({ agentType: 'explore' })).to.equal('explore');
    });

    it('isKnownUnavailableSubagentType flags common hallucinated types', () => {
        expect(isKnownUnavailableSubagentType('web-dev')).to.equal(true);
        expect(isKnownUnavailableSubagentType('react-debug')).to.equal(true);
        expect(isKnownUnavailableSubagentType('explore')).to.equal(false);
    });

    it('buildSubagentDeniedMessage names unavailable subagent types explicitly', () => {
        const message = buildSubagentDeniedMessage('Agent', { subagent_type: 'web-dev' });
        expect(message).to.include('web-dev');
        expect(message).to.include('Read/Write/Edit');
        expect(message).to.not.include('retry the call unchanged');
    });

    it('buildQaiqAutoDeniedToolMessage delegates to subagent policy', () => {
        expect(buildQaiqAutoDeniedToolMessage('Task', { subagent_type: 'react-debug' }))
            .to.include('react-debug');
    });

});

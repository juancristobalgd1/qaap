// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentLoginFlow, type QaapAgentLoginFlowState } from './qaap-agent-login-flow';

const GOOGLE_URL = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x&response_type=code&scope=openid';
const LINK_OUTPUT = `Open this link in your browser:\n${GOOGLE_URL}\n`;

function createFlow(alwaysAcceptsCode?: boolean): { readonly flow: QaapAgentLoginFlow; readonly states: QaapAgentLoginFlowState[] } {
    const states: QaapAgentLoginFlowState[] = [];
    const flow = new QaapAgentLoginFlow({
        agentId: 'antigravity',
        onDidChange: state => states.push(state),
        get alwaysAcceptsCode(): boolean | undefined {
            return alwaysAcceptsCode;
        },
    });
    flow.commandStarted(0);
    return { flow, states };
}

describe('QaapAgentLoginFlow paste-back code option', () => {

    it('publishes a link as a code-entry challenge when the option is set', () => {
        const { flow } = createFlow(true);
        flow.appendOutput(LINK_OUTPUT, 1);
        expect(flow.state.phase).to.equal('challenge');
        expect(flow.state.phase === 'challenge' && flow.state.challenge.codeEntry).to.equal(true);
    });

    it('keeps a link without a code-entry prompt when the option is not set', () => {
        const { flow } = createFlow(false);
        flow.appendOutput(LINK_OUTPUT, 1);
        expect(flow.state.phase).to.equal('challenge');
        expect(flow.state.phase === 'challenge' && !!flow.state.challenge.codeEntry).to.equal(false);
    });

    it('reads the option lazily, so a flag set after construction applies to the next link', () => {
        let enabled = false;
        const states: QaapAgentLoginFlowState[] = [];
        const flow = new QaapAgentLoginFlow({
            agentId: 'antigravity',
            onDidChange: state => states.push(state),
            get alwaysAcceptsCode(): boolean {
                return enabled;
            },
        });
        flow.commandStarted(0);
        enabled = true;
        flow.appendOutput(LINK_OUTPUT, 1);
        expect(flow.state.phase === 'challenge' && flow.state.challenge.codeEntry).to.equal(true);
    });

    it('does not re-publish the same link on every output chunk (the typed code would be wiped)', () => {
        const { flow, states } = createFlow(true);
        flow.appendOutput(LINK_OUTPUT, 1);
        flow.appendOutput('\r\n', 2);
        flow.appendOutput(LINK_OUTPUT, 3);
        expect(states.filter(state => state.phase === 'challenge')).to.have.length(1);
    });
});

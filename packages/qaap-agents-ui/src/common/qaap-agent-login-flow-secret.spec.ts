// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_PI_API_KEY_SAVED_PATTERN, QAAP_PI_SECRET_PROMPT_PATTERN } from '@theia/qaap-shared-core/lib/common/qaap-pi-login-providers';
import { QAAP_AGENT_LOGIN_CODE_TIMEOUT_MS, QaapAgentLoginFlow, type QaapAgentLoginFlowState } from './qaap-agent-login-flow';

const KEY = 'gsk-test-not-a-real-key-123';

function createPiFlow(): { readonly flow: QaapAgentLoginFlow; readonly states: QaapAgentLoginFlowState[] } {
    const states: QaapAgentLoginFlowState[] = [];
    const flow = new QaapAgentLoginFlow({
        agentId: 'pi',
        onDidChange: state => states.push(state),
        secretPromptPattern: QAAP_PI_SECRET_PROMPT_PATTERN,
        extraSuccessPatterns: [QAAP_PI_API_KEY_SAVED_PATTERN],
    });
    flow.commandStarted(0);
    return { flow, states };
}

/** Pi 1.5.2's API-key screen, as drawn in the hidden terminal after `/login groq`. */
const PI_KEY_PROMPT = [
    '─'.repeat(40),
    'Enter Groq API key',
    '>',
    ' (escape/ctrl+c to cancel, enter to submit)',
    '─'.repeat(40),
    '/workspace/repo',
].join('\n');

describe('QaapAgentLoginFlow secret prompt (Pi API keys)', () => {

    it('switches to the masked secret field when Pi asks for a key, naming what it asks for', () => {
        const { flow } = createPiFlow();
        flow.appendOutput(PI_KEY_PROMPT, 1);
        expect(flow.state).to.deep.equal({ phase: 'secret-input', label: 'Groq API key' });
    });

    it('connects on Pi\'s "Saved API key" line after the key was typed', () => {
        const { flow } = createPiFlow();
        flow.appendOutput(PI_KEY_PROMPT, 1);
        flow.secretSubmitted(KEY, 2);
        expect(flow.state.phase).to.equal('secret-submitted');
        flow.appendOutput('\nSaved API key for Groq. Credentials saved to ~/.pi/agent/auth.json\n', 3);
        expect(flow.state.phase).to.equal('connected');
    });

    it('never keeps the echoed key: a later failure tail shows a mask instead', () => {
        const { flow } = createPiFlow();
        flow.appendOutput(PI_KEY_PROMPT, 1);
        flow.secretSubmitted(KEY, 2);
        // The TUI echoes the typed key, split across two chunks.
        flow.appendOutput(`\n> ${KEY.slice(0, 10)}`, 3);
        flow.appendOutput(`${KEY.slice(10)}\n`, 4);
        flow.tick(4 + QAAP_AGENT_LOGIN_CODE_TIMEOUT_MS);
        const state = flow.state;
        expect(state.phase).to.equal('failed');
        const tail = state.phase === 'failed' ? state.tail.join('\n') : '';
        expect(tail).not.to.contain(KEY);
        expect(tail).to.contain('••••');
    });

    it('marks a timeout after the key was sent, so the dialog does not speak of a missing sign-in link', () => {
        const { flow } = createPiFlow();
        flow.appendOutput(PI_KEY_PROMPT, 1);
        flow.secretSubmitted(KEY, 2);
        flow.appendOutput('\nWorking …\n', 3);
        flow.tick(2 + QAAP_AGENT_LOGIN_CODE_TIMEOUT_MS);
        const state = flow.state;
        expect(state.phase === 'failed' && state.reason).to.equal('timeout');
        expect(state.phase === 'failed' && state.afterSecret).to.equal(true);
        expect(state.phase === 'failed' && state.timeoutMs).to.equal(QAAP_AGENT_LOGIN_CODE_TIMEOUT_MS);
    });

    it('ignores the prompt for a harness without a secret pattern', () => {
        const states: QaapAgentLoginFlowState[] = [];
        const flow = new QaapAgentLoginFlow({ agentId: 'codex', onDidChange: state => states.push(state) });
        flow.commandStarted(0);
        flow.appendOutput(PI_KEY_PROMPT, 1);
        expect(flow.state.phase).to.equal('waiting');
    });

    it('accepts a secret only while the field is shown', () => {
        const { flow } = createPiFlow();
        flow.secretSubmitted(KEY, 1);
        expect(flow.state.phase).to.equal('waiting');
    });
});

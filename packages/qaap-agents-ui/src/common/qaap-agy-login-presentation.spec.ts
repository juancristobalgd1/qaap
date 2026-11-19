// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapAgentLoginFlow, type QaapAgentLoginFlowState } from './qaap-agent-login-flow';
import { presentAgyLoginFailure, QAAP_AGY_LOGIN_CHALLENGE_TIMEOUT_MS } from './qaap-agy-login-presentation';

/** Redacted agy 1.5.12 output: the picker, then the URL as OSC-8 links on rows the 80-column TUI wrapped. */
const AGY_URL = 'https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=REDACTED.apps.googleusercontent.com'
    + '&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&response_type=code&state=REDACTED_STATE';
const PICKER = ' Select login method:\r\n \x1b[36m> 1. Google OAuth\x1b[39m\r\n   2. Use a Google Cloud project\r\n';
const link = (text: string): string => `\x1b]8;;${AGY_URL}\x07${text}\x1b]8;;\x07`;
const LOGIN = [' Your browser should open automatically. If not:', ...AGY_URL.match(/.{1,60}/g)!.map(row => ` ${link(row)}`), ''].join('\r\n');

describe('agy sign-in link capture', () => {

    const create = (states: QaapAgentLoginFlowState[]): QaapAgentLoginFlow => new QaapAgentLoginFlow({
        agentId: 'antigravity',
        challengeTimeoutMs: QAAP_AGY_LOGIN_CHALLENGE_TIMEOUT_MS,
        answersPrompts: true,
        onDidChange: state => states.push(state),
    });

    it('captures the whole Google URL from OSC-8 hyperlinks although the rows were wrapped', () => {
        const flow = create([]);
        flow.commandStarted(0);
        flow.appendRawOutput(PICKER, 100);
        flow.appendRawOutput(LOGIN, 1_000);
        const state = flow.state;
        expect(state.phase).to.equal('challenge');
        expect(state.phase === 'challenge' && state.challenge.url).to.equal(AGY_URL);
        expect(state.phase === 'challenge' && state.challenge.codeEntry, 'agy takes no pasted code').to.not.equal(true);
    });

    it('captures a URL printed as plain text with ANSI colours around it', () => {
        const flow = create([]);
        flow.commandStarted(0);
        flow.appendRawOutput(`\x1b[1mYour browser should open automatically. If not:\x1b[0m\r\n \x1b[34m${AGY_URL}\x1b[0m\r\n`, 500);
        expect(flow.state.phase === 'challenge' && flow.state.challenge.url).to.equal(AGY_URL);
    });

    it('does not mistake the answered login picker for a stall, but does for a silent CLI after the deadline', () => {
        const flow = create([]);
        flow.commandStarted(0);
        flow.appendRawOutput(PICKER, 100);
        flow.tick(10_000);
        expect(flow.state.phase).to.equal('waiting');
        flow.tick(QAAP_AGY_LOGIN_CHALLENGE_TIMEOUT_MS + 1);
        expect(flow.state.phase === 'failed' && flow.state.reason).to.equal('timeout');
    });

    it('without the driver, the picker question still fails fast (other CLIs keep their check)', () => {
        const flow = new QaapAgentLoginFlow({ agentId: 'antigravity', onDidChange: () => undefined });
        flow.commandStarted(0);
        flow.appendRawOutput(PICKER, 100);
        flow.tick(2_200);
        expect(flow.state.phase === 'failed' && flow.state.reason).to.equal('waiting-for-input');
    });
});

describe('presentAgyLoginFailure', () => {

    type FailedState = Extract<QaapAgentLoginFlowState, { phase: 'failed' }>;
    const failed = (reason: FailedState['reason']): FailedState => ({ phase: 'failed', reason, tail: [AGY_URL, 'Select login method:'] });

    it('points to Qaap Desktop, with no CLI output, when the link never appeared', () => {
        for (const reason of ['timeout', 'waiting-for-input', 'exited', 'rejected'] as const) {
            const shown = presentAgyLoginFailure(failed(reason), 'Antigravity');
            expect(shown.message, reason).to.match(/Qaap desktop app/);
            expect(shown.tail, reason).to.deep.equal([]);
        }
    });

    it('says the sign-in timed out when the link was shown but never completed, without echoing the URL', () => {
        const shown = presentAgyLoginFailure(failed('sign-in-expired'), 'Antigravity');
        expect(shown.message).to.equal('Sign-in timed out. Try again.');
        expect(JSON.stringify(shown)).to.not.contain('accounts.google.com');
    });

    it('keeps the copy of failures that are not about the sign-in, but drops the output', () => {
        const shown = presentAgyLoginFailure(failed('terminal-unavailable'), 'Antigravity');
        expect(shown.reason).to.equal('terminal-unavailable');
        expect(shown.message).to.equal(undefined);
        expect(shown.tail).to.deep.equal([]);
    });
});

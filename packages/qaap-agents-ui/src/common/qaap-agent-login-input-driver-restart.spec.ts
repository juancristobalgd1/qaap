// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolvePiTuiLoginInput } from '@theia/qaap-shared-core/lib/common/qaap-agent-tui-command';
import { QaapAgentLoginFlow, stripAgentLoginTerminalControlSequences, type QaapAgentLoginFlowState } from './qaap-agent-login-flow';
import { QaapAgentLoginInputDriver } from './qaap-agent-login-input-driver';

const SHELL_ECHO = 'stty cols 500 rows 50 2>/dev/null; export PI_HYPERLINKS=\'1\'; pi --tui-mode regular --no-session --no-approve; echo "QAAP_LOGIN_EXIT:$?"\n';
const RULE_ROWS = '\x1b[38;5;240m' + '─'.repeat(44) + '\x1b[39m\n';
const EDITOR_FRAME = RULE_ROWS + ' > \n' + RULE_ROWS;
const NO_MODELS = ' Warning: No models available. Use /login to log into a provider via OAuth or API key.\n';

interface Chunk {
    readonly atMs: number;
    readonly text: string;
}

interface Sent {
    readonly at: number;
    readonly text: string;
}

/**
 * Replays output through the driver with the product's timings: a tick every 250 ms, output fed at
 * its time. `redrawEveryMs` repeats the editor frame after the last chunk (the TUI keeps redrawing).
 */
function replay(chunks: readonly Chunk[], endMs: number, redrawEveryMs?: number): { readonly sent: Sent[]; readonly restarts: number[]; readonly driver: QaapAgentLoginInputDriver } {
    const sent: Sent[] = [];
    const restarts: number[] = [];
    let clock = 0;
    const driver = new QaapAgentLoginInputDriver({
        steps: resolvePiTuiLoginInput('openrouter'),
        now: 0,
        send: text => sent.push({ at: clock, text }),
        onRestart: now => restarts.push(now),
    });
    const timeline = chunks.slice().sort((left, right) => left.atMs - right.atMs);
    if (redrawEveryMs !== undefined) {
        const lastAt = timeline.length ? timeline[timeline.length - 1].atMs : 0;
        for (let at = lastAt + redrawEveryMs; at <= endMs; at += redrawEveryMs) {
            timeline.push({ atMs: at, text: EDITOR_FRAME });
        }
    }
    let next = 0;
    for (clock = 0; clock <= endMs; clock += 250) {
        while (next < timeline.length && timeline[next].atMs <= clock) {
            driver.feed(stripAgentLoginTerminalControlSequences(timeline[next].text), timeline[next].atMs);
            next++;
        }
        driver.tick(clock);
    }
    return { sent, restarts, driver };
}

function loginTypings(sent: readonly Sent[]): number[] {
    return sent.filter(entry => entry.text === '/login openrouter').map(entry => entry.at);
}

describe('QaapAgentLoginInputDriver restart after a fallback send', () => {

    it('treats the shell echo of the login command as not ready', () => {
        const { sent, restarts } = replay([{ atMs: 100, text: SHELL_ECHO }], 2_000);
        expect(sent).to.deep.equal([]);
        expect(restarts).to.deep.equal([]);
    });

    it('case C: no header, rule rows at 0.3 s: step 1 follows the rules without waiting for the fallback', () => {
        const { sent, restarts } = replay([{ atMs: 300, text: NO_MODELS + EDITOR_FRAME }], 12_000, 100);
        const typed = loginTypings(sent);
        expect(typed).to.have.length(1);
        // Redraws every 100 ms keep the output from settling: the 1.5 s match grace applies, not the 8 s fallback.
        expect(typed[0]).to.be.lessThan(2_500);
        expect(restarts).to.deep.equal([]);
    });

    it('case D: Pi draws its UI only at 9 s after the 8 s fallback: step 1 is typed again once, after the rules', () => {
        const { sent, restarts } = replay([{ atMs: 9_000, text: NO_MODELS + EDITOR_FRAME }], 14_000);
        const typed = loginTypings(sent);
        expect(typed).to.have.length(2);
        expect(typed[0]).to.equal(8_000);
        expect(typed[1]).to.be.greaterThan(9_000).and.lessThan(10_000);
        expect(restarts).to.have.length(1);
        expect(restarts[0]).to.equal(9_000);
        // The reset (one Ctrl-C) goes out once, at the restart, before the sequence is typed again.
        const resets = sent.filter(entry => entry.text === '\x03');
        expect(resets).to.have.length(1);
        expect(resets[0].at).to.equal(9_000);
    });

    it('case E: same cold start while the TUI keeps redrawing every 100 ms: still one restart', () => {
        const { sent, restarts } = replay([{ atMs: 9_000, text: NO_MODELS + EDITOR_FRAME }], 14_000, 100);
        expect(loginTypings(sent)).to.have.length(2);
        expect(restarts).to.have.length(1);
    });

    it('quiet forever: the fallback sends step 1 once at 8 s and never restarts', () => {
        const { sent, restarts } = replay([], 20_000);
        expect(loginTypings(sent)).to.deep.equal([8_000]);
        expect(restarts).to.deep.equal([]);
    });

    it('restarts at most once: a later ready signal does not type the sequence a third time', () => {
        const { sent, restarts } = replay([
            { atMs: 9_000, text: NO_MODELS + EDITOR_FRAME },
            { atMs: 15_000, text: NO_MODELS + EDITOR_FRAME },
            { atMs: 20_000, text: NO_MODELS + EDITOR_FRAME },
        ], 24_000, 100);
        expect(loginTypings(sent)).to.have.length(2);
        expect(restarts).to.have.length(1);
    });
});

describe('QaapAgentLoginFlow restartWaitingDeadline', () => {

    function createFlow(): { readonly flow: QaapAgentLoginFlow; readonly states: QaapAgentLoginFlowState[] } {
        const states: QaapAgentLoginFlowState[] = [];
        const flow = new QaapAgentLoginFlow({ agentId: 'pi', challengeTimeoutMs: 30_000, onDidChange: state => states.push(state) });
        return { flow, states };
    }

    it('counts the link deadline from the restart, so a slow cold start plus restart does not expire early', () => {
        const { flow } = createFlow();
        flow.restart(0);
        flow.commandStarted(0);
        flow.restartWaitingDeadline(20_000);
        flow.tick(45_000);
        expect(flow.state.phase).to.equal('waiting');
        flow.tick(50_000);
        const state = flow.state;
        expect(state.phase === 'failed' && state.reason).to.equal('timeout');
    });

    it('ignores a restart outside the waiting phase', () => {
        const { flow, states } = createFlow();
        flow.restart(0);
        const before = states.length;
        flow.restartWaitingDeadline(5_000);
        expect(states.length).to.equal(before);
        expect(flow.state.phase).to.equal('preparing');
    });
});

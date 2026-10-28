// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolvePiTuiLoginInput } from '@theia/qaap-shared-core/lib/common/qaap-agent-tui-command';
import {
    QAAP_AGENT_LOGIN_INPUT_SETTLE_MS,
    QAAP_AGENT_LOGIN_INPUT_STEP_FALLBACK_MS,
    QaapAgentLoginInputDriver,
} from './qaap-agent-login-input-driver';

const SHELL_ECHO = 'stty cols 500 rows 50 2>/dev/null; pi --tui-mode regular --no-session --no-approve; echo "QAAP_LOGIN_EXIT:$?"\n';
const PI_HEADER = ' π  v1.4.0\n ctrl+c interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more\n';

function createDriver(now = 0): { readonly driver: QaapAgentLoginInputDriver; readonly sent: string[] } {
    const sent: string[] = [];
    const driver = new QaapAgentLoginInputDriver({ steps: resolvePiTuiLoginInput('openrouter'), send: text => sent.push(text), now });
    return { driver, sent };
}

describe('QaapAgentLoginInputDriver (Pi /login)', () => {

    it('types nothing while only the shell echo is visible, then `/login openrouter` once Pi drew its header', () => {
        const { driver, sent } = createDriver();
        driver.feed(SHELL_ECHO, 10);
        driver.tick(1_000);
        expect(sent, 'the shell echo is not Pi being ready').to.deep.equal([]);
        driver.feed(PI_HEADER, 1_200);
        driver.tick(1_300);
        expect(sent, 'waits for Pi to finish drawing').to.deep.equal([]);
        driver.tick(1_200 + QAAP_AGENT_LOGIN_INPUT_SETTLE_MS);
        expect(sent).to.deep.equal(['/login openrouter']);
    });

    it('presses Enter through the autocomplete and the method picker, one step per redraw', () => {
        const { driver, sent } = createDriver();
        driver.feed(PI_HEADER, 100);
        driver.tick(1_000);
        expect(sent).to.deep.equal(['/login openrouter']);

        driver.feed(' /login openrouter\n   openrouter  OpenRouter\n', 1_050);
        driver.tick(1_100);
        expect(sent).to.have.length(1);
        driver.tick(1_500);
        expect(sent, 'Enter on the autocomplete row').to.deep.equal(['/login openrouter', '\r']);

        driver.feed(' /login openrouter \n', 1_550);
        driver.tick(2_000);
        expect(sent, 'second Enter opens the method picker').to.deep.equal(['/login openrouter', '\r', '\r']);

        driver.tick(5_000);
        expect(sent, 'the last Enter waits for the picker, however long').to.have.length(3);
        driver.feed(' Select authentication method for OpenRouter:\n → Sign in with OpenRouter\n   Sign in with an API key\n', 5_100);
        driver.tick(5_100 + QAAP_AGENT_LOGIN_INPUT_SETTLE_MS);
        expect(sent).to.deep.equal(['/login openrouter', '\r', '\r', '\r']);
        expect(driver.done).to.equal(true);
    });

    it('skips the extra Enter when the picker already opened, so the default method is chosen exactly once', () => {
        const { driver, sent } = createDriver();
        driver.feed(PI_HEADER, 0);
        driver.tick(500);
        driver.feed(' /login openrouter\n', 550);
        driver.tick(1_000);
        expect(sent).to.deep.equal(['/login openrouter', '\r']);
        driver.feed(' Select authentication method for OpenRouter:\n → Sign in with OpenRouter\n', 1_050);
        driver.tick(1_500);
        expect(sent).to.deep.equal(['/login openrouter', '\r', '\r']);
        driver.tick(2_000);
        expect(sent, 'no Enter is left over for the paste prompt').to.have.length(3);
        expect(driver.done).to.equal(true);
    });

    it('types a step without a marker after the fallback delay even if the CLI keeps redrawing', () => {
        const { driver, sent } = createDriver();
        driver.feed(PI_HEADER, 0);
        driver.tick(500);
        for (let now = 600; now < 500 + QAAP_AGENT_LOGIN_INPUT_STEP_FALLBACK_MS; now += 200) {
            driver.feed('⠋', now);
            driver.tick(now);
        }
        expect(sent).to.have.length(1);
        driver.tick(500 + QAAP_AGENT_LOGIN_INPUT_STEP_FALLBACK_MS);
        expect(sent).to.have.length(2);
    });

    it('starts typing after the readiness fallback when Pi prints no header (quiet startup)', () => {
        const { driver, sent } = createDriver();
        driver.feed(SHELL_ECHO, 10);
        driver.tick(7_900);
        expect(sent).to.deep.equal([]);
        driver.tick(8_000);
        expect(sent).to.deep.equal(['/login openrouter']);
    });

    it('types nothing once stopped', () => {
        const { driver, sent } = createDriver();
        driver.stop();
        driver.feed(PI_HEADER, 0);
        driver.tick(10_000);
        expect(sent).to.deep.equal([]);
        expect(driver.done).to.equal(true);
    });
});

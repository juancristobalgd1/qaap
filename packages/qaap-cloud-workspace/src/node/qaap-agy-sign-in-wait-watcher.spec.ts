// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { detectAgentFailureKind } from '@theia/qaap-shared-core/lib/common/qaap-agent-failure-message';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { QaapHarnessModelAvailability } from '@theia/qaap-shared-core/lib/common/qaap-harness-model-availability';
import { createAgySignInWaitWatcher } from './qaap-agy-sign-in-wait-watcher';

// Real agy 1.5.9 output without a session (`agy -p 'hola' </dev/null`); it then waits 60 s.
const AGY_UNSIGNED = [
    'Authentication required. Please visit the URL to log in:',
    '  https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=x',
    '',
    'Waiting for authentication (timeout 60s)...',
    'Or, paste the authorization code here and press Enter:',
].join('\n');

describe('agy sign-in wait watcher', () => {

    it('fires once on agy\'s sign-in wait, even when the line is split across chunks', () => {
        const watcher = createAgySignInWaitWatcher();
        expect(watcher.push('Authentication requ')).to.equal(false);
        expect(watcher.push('ired. Please visit the URL to log in:\n')).to.equal(true);
        expect(watcher.push(AGY_UNSIGNED)).to.equal(false);
    });

    it('fires on the wait line alone and ignores a normal answer', () => {
        expect(createAgySignInWaitWatcher().push('Waiting for authentication (timeout 60s)...')).to.equal(true);
        const answer = createAgySignInWaitWatcher();
        expect(answer.push('I updated the login page so authentication is required before checkout.\n')).to.equal(false);
    });

    it('leaves a log the classifier reads as a sign-in failure', () => {
        expect(detectAgentFailureKind(`${AGY_UNSIGNED}\n[qaap] Antigravity is waiting for a sign-in; stopping the run.`)).to.equal('auth');
    });

    // Was: the guard needed a session for every model (signed-out and checking both refused). Fail-open now:
    // only a positive sign-out refuses agy; a pending or inconclusive probe lets it run, and this watcher stops
    // it at its sign-in wait so the turn ends as an auth failure with the Sign in action.
    it('antigravity has no Free model: a positive sign-out refuses every model, an unknown session lets agy run', () => {
        expect(QAAP_BUILTIN_AGENT_DEFINITIONS.find(definition => definition.id === 'antigravity')?.sessionCheck).to.equal('probe');
        for (const modelId of ['', 'auto', 'gemini-3.8-flash-medium', 'gemini-3.8-pro-high', 'gemini-free', 'x:free']) {
            const tier = QaapHarnessModelAvailability.tier('antigravity', { modelId });
            expect(tier, modelId).to.equal('pro');
            expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session: 'signed-out', tier }).selectable, `${modelId}/signed-out`)
                .to.equal(false);
            for (const session of ['checking', 'unknown'] as const) {
                expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session, tier }).selectable, `${modelId}/${session}`).to.equal(true);
            }
        }
    });
});

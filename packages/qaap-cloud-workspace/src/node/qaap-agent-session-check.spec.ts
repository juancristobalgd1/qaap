// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { isQaapSessionAttestationAgent, QAAP_SESSION_ATTESTATION_AGENT_IDS } from '@theia/qaap-shared-core/lib/common/qaap-agent-session-attestation';
import { QaapHarnessModelAvailability } from '@theia/qaap-shared-core/lib/common/qaap-harness-model-availability';
import { resolveAgentAccess } from './qaap-agent-access';
import { resolveAgentConnectionProbe } from './qaap-agent-task-runner-utils3';

/**
 * Every harness must say how its session is checked (`sessionCheck`, a required field of
 * `QaapBuiltinAgentDefinition`), and the declaration must have an implementation here. Without one a
 * harness would stay `unknown` forever: never locked (fail-open), but never shown as signed in either.
 */
describe('harness session check declarations', () => {

    for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
        it(`${definition.id} declares a session check that the backend implements`, () => {
            const probe = resolveAgentConnectionProbe(definition.id, definition.bin);
            switch (definition.sessionCheck) {
                case 'probe':
                    expect(probe, `${definition.id} declares a probe but resolveAgentConnectionProbe has none for ${definition.bin}`).to.not.equal(undefined);
                    expect(isQaapSessionAttestationAgent(definition.id), `${definition.id} has a probe and must not accept attestations`).to.equal(false);
                    break;
                case 'attestation':
                    expect(isQaapSessionAttestationAgent(definition.id), `${definition.id} must be listed in QAAP_SESSION_ATTESTATION_AGENT_IDS`).to.equal(true);
                    expect(probe, `${definition.id} accepts attestations, so it must not also have a probe`).to.equal(undefined);
                    break;
                default:
                    expect.fail(`${definition.id} has no sessionCheck`);
            }
        });
    }

    it('accepts attestations only from declared attestation harnesses', () => {
        const declared = QAAP_BUILTIN_AGENT_DEFINITIONS.filter(definition => definition.sessionCheck === 'attestation').map(definition => definition.id).sort();
        expect([...QAAP_SESSION_ATTESTATION_AGENT_IDS].sort()).to.deep.equal(declared);
    });

    // Fail-closed: a harness that cannot answer stays unknown once nothing is pending, and its Pro models are locked
    // with the sign-in reason until a sign-in (or attestation) confirms the session.
    it('fails closed: a harness that cannot answer stays unknown once nothing is pending, so its Pro models are locked', () => {
        const accessState = resolveAgentAccess({ agentId: 'future-harness', connectionState: 'unknown', probeSettled: true });
        const session = QaapHarnessModelAvailability.session({ connectionState: 'unknown', accessState, probeSettled: true });
        expect(session).to.equal('unknown');
        expect(QaapHarnessModelAvailability.availability({
            harnessEnabled: true,
            session,
            tier: QaapHarnessModelAvailability.tier('future-harness', { modelId: 'future/model-pro' }),
        })).to.deep.equal({ visible: true, selectable: false, reason: 'sign-in-required' });
    });

    it('keeps a free model of an unknown harness selectable', () => {
        expect(QaapHarnessModelAvailability.availability({
            harnessEnabled: true,
            session: 'unknown',
            tier: QaapHarnessModelAvailability.tier('opencode', { vendor: 'opencode', modelId: 'opencode/beam-free' }),
        })).to.deep.equal({ visible: true, selectable: true });
    });

    it('still locks a positive sign-out', () => {
        const accessState = resolveAgentAccess({ agentId: 'future-harness', connectionState: 'disconnected', probeSettled: true });
        const session = QaapHarnessModelAvailability.session({ connectionState: 'disconnected', accessState, probeSettled: true });
        expect(session).to.equal('signed-out');
        expect(QaapHarnessModelAvailability.availability({ harnessEnabled: true, session, tier: 'pro' }))
            .to.deep.equal({ visible: true, selectable: false, reason: 'sign-in-required' });
    });
});

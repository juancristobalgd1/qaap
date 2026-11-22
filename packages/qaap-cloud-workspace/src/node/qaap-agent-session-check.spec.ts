// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QAAP_BUILTIN_AGENT_DEFINITIONS } from '@theia/qaap-shared-core/lib/common/qaap-builtin-agents';
import { isQaapSessionAttestationAgent, QAAP_SESSION_ATTESTATION_AGENT_IDS } from '@theia/qaap-shared-core/lib/common/qaap-agent-session-attestation';
import { QaapHarnessModelAvailability } from '@theia/qaap-shared-core/lib/common/qaap-harness-model-availability';
import { resolveAgentAccess } from './qaap-agent-access';
import {
    classifyAgentConnectionProbe,
    GROK_CONNECTION_PROBE_POWERSHELL,
    GROK_CONNECTION_PROBE_SCRIPT,
    resolveAgentConnectionProbe,
    resolveWindowsPowerShellPath,
} from './qaap-agent-task-runner-utils3';

type BuiltinAgentDefinition = typeof QAAP_BUILTIN_AGENT_DEFINITIONS[number];

/**
 * Asserts one harness declaration against its implementation on the current `process.platform`.
 */
function expectSessionCheckImplemented(definition: BuiltinAgentDefinition): void {
    const probe = resolveAgentConnectionProbe(definition.id, definition.bin);
    switch (definition.sessionCheck) {
        case 'probe':
            expect(probe, `${definition.id} declares a probe but resolveAgentConnectionProbe has none for ${definition.bin}`).to.not.equal(undefined);
            expect(isQaapSessionAttestationAgent(definition.id), `${definition.id} has a probe and must not accept attestations`).to.equal(false);
            break;
        case 'attestation':
            expect(isQaapSessionAttestationAgent(definition.id), `${definition.id} must be listed in QAAP_SESSION_ATTESTATION_AGENT_IDS`).to.equal(true);
            // An attestation harness may also have a probe, but only a confirming one: it can report a recorded
            // session (`connected`) and never a sign-out, because the session can live where the probe cannot see
            // it (Copilot on `GH_TOKEN`). Its unknown answer then falls back to the attestation.
            if (probe) {
                const probeText = probe.args.join(' ').toLowerCase();
                expect(probeText, `${definition.id}'s probe must never print a signed-out phrase`).to.not.match(/not logged in|logged out|not authenticated/);
            }
            break;
        default:
            expect.fail(`${definition.id} has no sessionCheck`);
    }
}

/**
 * Every harness must say how its session is checked (`sessionCheck`, a required field of
 * `QaapBuiltinAgentDefinition`), and the declaration must have an implementation here. Without one a
 * harness would stay `unknown` forever: never locked (fail-open), but never shown as signed in either.
 */
describe('harness session check declarations', () => {

    for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
        it(`${definition.id} declares a session check that the backend implements`, () => {
            expectSessionCheckImplemented(definition);
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

/**
 * Grok's session probe is a shell script on POSIX and a PowerShell script on Windows (no `sh` there). Both must
 * declare the same check and print the same output phrases, so the shared classifier reads them alike.
 */
describe('grok session probe per platform', () => {

    let originalPlatform: PropertyDescriptor | undefined;

    const stubPlatform = (platform: string): void => {
        Object.defineProperty(process, 'platform', { value: platform });
    };

    beforeEach(() => {
        originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    });

    afterEach(() => {
        if (originalPlatform) {
            Object.defineProperty(process, 'platform', originalPlatform);
        }
    });

    describe('win32', () => {

        beforeEach(() => stubPlatform('win32'));

        it('probes grok with PowerShell, which every Windows install ships, by absolute path (never a cwd lookup)', () => {
            expect(resolveAgentConnectionProbe('grok', 'grok')).to.deep.equal({
                file: resolveWindowsPowerShellPath(),
                args: ['-NoProfile', '-NonInteractive', '-Command', GROK_CONNECTION_PROBE_POWERSHELL],
            });
            expect(resolveWindowsPowerShellPath({ SystemRoot: 'D:\\Win' })).to.equal('D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
            expect(resolveWindowsPowerShellPath({})).to.equal('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
        });

        it('passes the script as one argv element with no double quotes of its own', () => {
            expect(GROK_CONNECTION_PROBE_POWERSHELL).to.not.include('"');
            expect(GROK_CONNECTION_PROBE_POWERSHELL).to.include('.grok\\auth.json');
            expect(GROK_CONNECTION_PROBE_POWERSHELL).to.include('USERPROFILE');
        });

        it('prints the same phrases as the sh probe', () => {
            expect(GROK_CONNECTION_PROBE_POWERSHELL).to.include('\'logged in\'');
            expect(GROK_CONNECTION_PROBE_POWERSHELL).to.include('\'not logged in\'');
            expect(GROK_CONNECTION_PROBE_SCRIPT).to.include('"logged in"');
            expect(GROK_CONNECTION_PROBE_SCRIPT).to.include('"not logged in"');
        });

        it('classifies the PowerShell output like the sh output', () => {
            expect(classifyAgentConnectionProbe('grok', 0, 'logged in\r\n', false)).to.equal('connected');
            expect(classifyAgentConnectionProbe('grok', 0, 'not logged in\r\n', false)).to.equal('disconnected');
            expect(classifyAgentConnectionProbe('grok', 1, '', true)).to.equal('unknown');
        });

        for (const definition of QAAP_BUILTIN_AGENT_DEFINITIONS) {
            it(`${definition.id} declares a session check that the backend implements on win32`, () => {
                expectSessionCheckImplemented(definition);
            });
        }
    });

    for (const platform of ['darwin', 'linux']) {
        describe(platform, () => {

            beforeEach(() => stubPlatform(platform));

            it('keeps the sh probe for grok', () => {
                expect(resolveAgentConnectionProbe('grok', 'grok')).to.deep.equal({
                    file: 'sh',
                    args: ['-c', GROK_CONNECTION_PROBE_SCRIPT],
                });
            });

            it('keeps the sh probe script unchanged', () => {
                expect(GROK_CONNECTION_PROBE_SCRIPT).to.include('"$HOME/.grok/auth.json"');
            });
        });
    }
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveQaapHarnessCapabilities } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import type { QaapAgentTask } from '../../../common/qaap-agent-task';
import { QaapAgentTaskRunner } from '../../qaap-agent-task-runner';
import { QAAP_HARNESS_ADAPTER_REGISTRY } from '../qaap-harness-adapter-registry';
import { QaapToolGateTokenService } from '../../qaap-tool-gate-token-service';
import { QAAP_ACP_ASK_TTL_SEC, qaapAcpFlavorPrintsStreamJson, resolveQaapRuntimeHarnessCapabilities } from './qaap-acp-bridge-launch';

/** Capabilities as data (each resolve creates a new `mapToolKind` closure). */
const data = (capabilities: ReturnType<typeof resolveQaapHarnessCapabilities>): Record<string, unknown> => {
    const { mapToolKind, ...rest } = capabilities;
    return rest;
};

const task = (agentId: string): QaapAgentTask => ({ id: 'task-1', cwd: '/w', ownerLogin: 'alice', command: 'x', agentId }) as unknown as QaapAgentTask;

function fakeRunner(): QaapAgentTaskRunner {
    return {
        toolGateTokens: new QaapToolGateTokenService(),
        helperApiUrl: 'http://127.0.0.1:3000/qaap/api/helper',
        resolveTaskAgentId: (t: QaapAgentTask) => t.agentId ?? 'qaiq',
        isProjectFolderTrusted: () => true,
        resolveAgentReachableOrigin: () => 'http://127.0.0.1:3000',
    } as unknown as QaapAgentTaskRunner;
}

describe('ACP flavors in the gate wiring', () => {

    const saved = { copilot: process.env.QAAP_HARNESS_ACP_COPILOT, opencode: process.env.QAAP_HARNESS_ACP_OPENCODE };
    afterEach(() => {
        for (const [key, value] of [['QAAP_HARNESS_ACP_COPILOT', saved.copilot], ['QAAP_HARNESS_ACP_OPENCODE', saved.opencode]] as const) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('turns Copilot from runs-unchecked into a gate that can ask, only with its flag', () => {
        expect(data(resolveQaapRuntimeHarnessCapabilities('copilot', {}))).to.deep.equal(data(resolveQaapHarnessCapabilities('copilot')));
        const acp = resolveQaapRuntimeHarnessCapabilities('copilot', { QAAP_HARNESS_ACP_COPILOT: '1' });
        expect(acp).to.deep.include({
            transport: 'acp', gate: 'acp', canAsk: true, askTtlSec: QAAP_ACP_ASK_TTL_SEC, whenAskUnsupported: 'refuses', enforcement: 'client-boundary',
        });
        // Tool kinds are still computed server-side by the same mapper.
        expect(acp.mapToolKind('Bash', {})).to.equal('shell');
        expect(acp.mapToolKind('Edit', {})).to.equal('edit');
    });

    it('gives Grok and Copilot the bridge gate plus delegation over ACP', () => {
        const grok = resolveQaapRuntimeHarnessCapabilities('grok', { QAAP_HARNESS_ACP_GROK: '1' });
        expect(grok).to.deep.include({ transport: 'acp', gate: 'acp', canAsk: true, enforcement: 'client-boundary', delegateMcp: 'acp-stdio' });
        expect(resolveQaapRuntimeHarnessCapabilities('copilot', { QAAP_HARNESS_ACP_COPILOT: '1' }).delegateMcp).to.equal('acp-stdio');
        expect(resolveQaapHarnessCapabilities('copilot').delegateMcp ?? 'none').to.equal('none');
        expect(resolveQaapRuntimeHarnessCapabilities('antigravity', { QAAP_HARNESS_ACP_ANTIGRAVITY: '1' }))
            .to.deep.include({ transport: 'acp', gate: 'acp', canAsk: true, delegateMcp: 'acp-stdio' });
        expect(data(resolveQaapRuntimeHarnessCapabilities('grok', {}))).to.deep.equal(data(resolveQaapHarnessCapabilities('grok')));
    });

    it('leaves OpenCode and every other harness unchanged (OpenCode keeps its pre-execution plugin)', () => {
        const env = { QAAP_HARNESS_ACP_COPILOT: '1', QAAP_HARNESS_ACP_OPENCODE: '1', QAAP_HARNESS_ACP_GROK: '1', QAAP_HARNESS_ACP_ANTIGRAVITY: '1' };
        for (const id of ['opencode', 'claude', 'codex', 'pi', 'cursor', undefined]) {
            expect(data(resolveQaapRuntimeHarnessCapabilities(id, env)), String(id)).to.deep.equal(data(resolveQaapHarnessCapabilities(id)));
        }
    });

    it('issues the gate token and the ask TTL only to a Copilot turn that runs through the bridge with its flag on', () => {
        const off: NodeJS.ProcessEnv = {};
        QaapAgentTaskRunner.prototype.applyToolGateEnv.call(fakeRunner(), off, task('copilot'));
        expect(off.QAAP_GATE_TOKEN).to.equal(undefined);

        process.env.QAAP_HARNESS_ACP_COPILOT = '1';
        // A native spawn of Copilot (verification fix turn, one-shots) never gets it, even with the flag on.
        const native: NodeJS.ProcessEnv = {};
        QaapAgentTaskRunner.prototype.applyToolGateEnv.call(fakeRunner(), native, task('copilot'));
        expect(native.QAAP_GATE_TOKEN).to.equal(undefined);
        const oneShot: NodeJS.ProcessEnv = {};
        QaapAgentTaskRunner.prototype.applyOneShotToolGateEnv.call(fakeRunner(), oneShot, task('copilot'));
        expect(oneShot.QAAP_GATE_TOKEN).to.equal(undefined);

        const on: NodeJS.ProcessEnv = {};
        QaapAgentTaskRunner.prototype.applyToolGateEnv.call(fakeRunner(), on, task('copilot'), { acpBridge: true });
        expect(on.QAAP_GATE_TOKEN).to.be.a('string');
        expect(on.QAAP_GATE_URL).to.equal('http://127.0.0.1:3000/qaap/api/tool-gate');
        expect(on.QAAP_GATE_ASK_TTL_SEC).to.equal(String(QAAP_ACP_ASK_TTL_SEC));
        // No OpenCode plugin wiring for another harness.
        expect(on.OPENCODE_CONFIG_CONTENT).to.equal(undefined);
    });

    it('sends an Antigravity prompt on stdin only in ACP mode (natively agy takes it in argv)', () => {
        const saved = process.env.QAAP_HARNESS_ACP_ANTIGRAVITY;
        try {
            delete process.env.QAAP_HARNESS_ACP_ANTIGRAVITY;
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.resolvePromptTransport('antigravity', { bin: 'agy' })).to.deep.equal({ kind: 'argv-prompt' });
            process.env.QAAP_HARNESS_ACP_ANTIGRAVITY = '1';
            expect(QAAP_HARNESS_ADAPTER_REGISTRY.resolvePromptTransport('antigravity', { bin: 'agy' })).to.deep.equal({ kind: 'plain-stdin', placeholder: 'omit' });
        } finally {
            if (saved === undefined) {
                delete process.env.QAAP_HARNESS_ACP_ANTIGRAVITY;
            } else {
                process.env.QAAP_HARNESS_ACP_ANTIGRAVITY = saved;
            }
        }
    });

    it('reads a result line only from the flavors that print stream-json', () => {
        expect(qaapAcpFlavorPrintsStreamJson('opencode')).to.equal(true);
        expect(qaapAcpFlavorPrintsStreamJson('copilot')).to.equal(false);
        expect(qaapAcpFlavorPrintsStreamJson('antigravity')).to.equal(true);
        expect(qaapAcpFlavorPrintsStreamJson('grok')).to.equal(false);
        expect(qaapAcpFlavorPrintsStreamJson(undefined)).to.equal(false);
    });
});

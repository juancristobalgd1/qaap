// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { buildChildEnvExtracted } from './qaap-agent-task-runner-tool-pills2';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

const task = { id: 'task-1', cwd: '/w', ownerLogin: 'alice', command: 'npm test', agentId: undefined } as unknown as QaapAgentTask;

/** Context with only what buildChildEnv reads; gate env is seeded the way the real runner does. */
function contextWith(tokens: QaapToolGateTokenService): QaapAgentTaskRunnerContext {
    const stub: Record<string, unknown> = {
        resolveAgentSpawnIdentity: () => ({ uid: undefined }),
        resolveAgentCliPrefix: () => '/prefix',
        isTenantPrivilegeDropActive: () => false,
        stripSharedProviderEnv: () => undefined,
        applyProviderPreferenceEnv: () => undefined,
        resolveAgentBindingForTask: () => undefined,
        applyQaiqProviderEnv: () => undefined,
        isQaiqRunner: () => false,
        applyHelperEnv: () => false,
        applyToolGateEnv: (env: NodeJS.ProcessEnv) => {
            env.QAAP_GATE_TOKEN = tokens.issue('task-1', 'alice', '/w');
        },
        preferenceReaderForOwner: () => () => undefined,
        applyOpenRouterOpenAiCompatEnv: () => undefined,
        resolveAgentHome: () => '/h',
    };
    return new Proxy(stub, { get: (target, key) => key in target ? target[key as string] : () => undefined }) as unknown as QaapAgentTaskRunnerContext;
}

describe('buildChildEnv and the tool gate credentials', () => {

    const saved = { token: process.env.QAAP_GATE_TOKEN, url: process.env.QAAP_GATE_URL };
    afterEach(() => {
        for (const [key, value] of [['QAAP_GATE_TOKEN', saved.token], ['QAAP_GATE_URL', saved.url]] as const) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('never gives a verification / git child a gate token or URL, even if the backend env carries one', () => {
        process.env.QAAP_GATE_TOKEN = 'inherited';
        process.env.QAAP_GATE_URL = 'http://127.0.0.1:1/qaap/api/tool-gate';
        const env = buildChildEnvExtracted(contextWith(new QaapToolGateTokenService()), task);
        expect(env.QAAP_GATE_TOKEN).to.equal(undefined);
        expect(env.QAAP_GATE_URL).to.equal(undefined);
        expect(Object.keys(env).filter(key => key.startsWith('QAAP_GATE_'))).to.deep.equal([]);
    });

    it('building child envs for non-harness processes does not revoke the live harness token', () => {
        const tokens = new QaapToolGateTokenService();
        const ctx = contextWith(tokens);
        const harnessEnv = buildChildEnvExtracted(ctx, task);
        ctx.applyToolGateEnv(harnessEnv, task);
        const live = harnessEnv.QAAP_GATE_TOKEN!;
        expect(tokens.resolve(live)).to.not.equal(undefined);
        buildChildEnvExtracted(ctx, task);
        buildChildEnvExtracted(ctx, task);
        expect(tokens.resolve(live)).to.not.equal(undefined);
    });
});

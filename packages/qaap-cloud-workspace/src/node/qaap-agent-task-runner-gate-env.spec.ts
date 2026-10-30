// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { addAgentReachableNoProxy, agentReachableOriginFor, buildChildEnvExtracted } from './qaap-agent-task-runner-tool-pills2';
import type { QaapTaskSandbox } from './qaap-task-sandbox';
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

describe('tool gate origin from a task sandbox', () => {
    const helperApiUrl = 'http://127.0.0.1:4873/qaap/api/agent-tasks';
    const harnessTask = { id: 'task-1', cwd: '/w', ownerLogin: 'alice', command: 'codex exec', agentId: 'codex' } as unknown as QaapAgentTask;
    const sandbox = (backendHost: string | undefined): QaapTaskSandbox => ({ name: 's', root: '/w', image: 'i', imageKind: 'base', startupMs: 0, created: true, forwardPorts: [], remoteEnv: {}, backendHost } as QaapTaskSandbox);

    /** A runner with only the fields the gate paths read; `sandboxFor` answers the spawn service's lookup. */
    function runnerIn(found: QaapTaskSandbox | undefined): QaapAgentTaskRunner {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            helperApiUrl,
            toolGateTokens: new QaapToolGateTokenService(),
            tenantSpawn: { agentSandboxFor: () => found },
        });
        return runner;
    }

    it('(a) in a sandbox the gate URL uses the backend address on the sandbox network, and that host bypasses the proxy', () => {
        const env: NodeJS.ProcessEnv = { HTTP_PROXY: 'http://squid:3128', NO_PROXY: 'localhost,127.0.0.1,::1' };
        runnerIn(sandbox('172.24.0.50')).applyToolGateEnv(env, harnessTask);
        expect(env.QAAP_GATE_URL).to.equal('http://172.24.0.50:4873/qaap/api/tool-gate');
        expect(env.QAAP_GATE_TOKEN).to.be.a('string');
        expect(env.NO_PROXY).to.equal('localhost,127.0.0.1,::1,172.24.0.50');
        expect(env.no_proxy).to.equal(env.NO_PROXY);
    });

    it('(a) the one-shot gate and the helper API use the same sandbox address', () => {
        const env: NodeJS.ProcessEnv = {};
        const release = runnerIn(sandbox('172.24.0.50')).applyOneShotToolGateEnv(env, harnessTask);
        expect(env.QAAP_GATE_URL).to.equal('http://172.24.0.50:4873/qaap/api/tool-gate');
        expect(env.NO_PROXY).to.contain('172.24.0.50');
        release();
    });

    it('(b) outside a sandbox the gate keeps the loopback origin and the NO_PROXY is untouched', () => {
        const env: NodeJS.ProcessEnv = {};
        runnerIn(undefined).applyToolGateEnv(env, harnessTask);
        expect(env.QAAP_GATE_URL).to.equal('http://127.0.0.1:4873/qaap/api/tool-gate');
        expect(env.NO_PROXY).to.equal(undefined);
        expect(env.no_proxy).to.equal(undefined);
    });

    it('(c) a sandbox without a backend address gets no gate URL and no token (fails closed)', () => {
        const env: NodeJS.ProcessEnv = {};
        runnerIn(sandbox(undefined)).applyToolGateEnv(env, harnessTask);
        expect(env.QAAP_GATE_URL).to.equal(undefined);
        expect(env.QAAP_GATE_TOKEN).to.equal(undefined);
        const oneShot: NodeJS.ProcessEnv = {};
        runnerIn(sandbox(undefined)).applyOneShotToolGateEnv(oneShot, harnessTask)();
        expect(oneShot.QAAP_GATE_URL).to.equal(undefined);
        expect(oneShot.QAAP_GATE_TOKEN).to.equal(undefined);
    });

    it('brackets an IPv6 backend address and reuses the helper port', () => {
        expect(agentReachableOriginFor(helperApiUrl, sandbox('fd00::5'))).to.equal('http://[fd00::5]:4873');
        expect(agentReachableOriginFor(helperApiUrl, undefined)).to.equal('http://127.0.0.1:4873');
        expect(agentReachableOriginFor(helperApiUrl, sandbox(undefined))).to.equal(undefined);
    });

    it('adds the sandbox host to NO_PROXY once and never adds loopback', () => {
        const env: NodeJS.ProcessEnv = {};
        addAgentReachableNoProxy(env, 'http://172.24.0.50:4873');
        addAgentReachableNoProxy(env, 'http://172.24.0.50:4873');
        expect(env.NO_PROXY).to.equal('localhost,127.0.0.1,::1,172.24.0.50');
        const loopback: NodeJS.ProcessEnv = {};
        addAgentReachableNoProxy(loopback, 'http://127.0.0.1:4873');
        expect(loopback.NO_PROXY).to.equal(undefined);
    });
});

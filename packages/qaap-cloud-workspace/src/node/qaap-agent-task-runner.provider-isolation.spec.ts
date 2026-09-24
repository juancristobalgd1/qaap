// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';

/**
 * End-to-end credential policy of a QAIQ task through the real runner pipeline: the command flags
 * (`buildTemplateVars`) and the final spawn env (`buildChildEnv`, what `spawnAgentCommand` receives).
 * Only the runner's I/O seams are stubbed: settings files, the backend PreferenceService and spawn identity.
 */
describe('QaapAgentTaskRunner provider credential isolation (QAIQ end to end)', () => {

    const OPERATOR_ENV: Record<string, string> = {
        OPENROUTER_API_KEY: 'operator-openrouter',
        ANTHROPIC_API_KEY: 'operator-anthropic',
        OPENAI_API_KEY: 'operator-openai',
        GEMINI_API_KEY: 'operator-gemini',
        GITHUB_TOKEN: 'operator-github',
    };
    const MODE_ENV = ['NODE_ENV', 'QAAP_CLOUD_MODE', 'QAAP_TENANT_BACKEND_MODE'];

    /** Alice's own per-user settings file. */
    const ALICE_SETTINGS: Record<string, unknown> = {
        'ai-features.openrouter.openrouterApiKey': 'sk-alice-openrouter',
        'ai-features.openrouter.openrouterModels': ['meta-llama/llama-3.3-70b-instruct:free'],
    };
    /** Process-wide (shared) User settings: the local user's, or legacy values on a hosted backend. */
    const SHARED_SETTINGS: Record<string, unknown> = {
        'ai-features.anthropic.AnthropicApiKey': 'sk-shared-anthropic',
        'ai-features.anthropic.AnthropicModels': ['claude-sonnet-4-6'],
    };

    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const key of [...Object.keys(OPERATOR_ENV), ...MODE_ENV]) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
        Object.assign(process.env, OPERATOR_ENV);
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    function createRunner(): QaapAgentTaskRunner {
        const runner = Object.create(QaapAgentTaskRunner.prototype) as QaapAgentTaskRunner;
        Object.assign(runner, {
            helperApiUrl: '',
            tenantHomeEnvOverlay: undefined,
            detectedAgents: new Map(),
            resolveAgentSpawnIdentity: () => ({}),
            readUserSettingsFromDisk: (login?: string) => login === 'alice' ? { ...ALICE_SETTINGS } : { ...SHARED_SETTINGS },
            preferenceService: {
                get: (key: string) => SHARED_SETTINGS[key],
                inspectInScope: (_key: string, _scope: PreferenceScope) => undefined,
            },
        });
        return runner;
    }

    function run(ownerLogin: string | undefined): { flags: string; env: NodeJS.ProcessEnv } {
        const runner = createRunner();
        const flags = runner.buildTemplateVars('qaiq', undefined, {}, ownerLogin).qaiq_flags;
        const task = {
            id: 'task-1',
            title: 'QAIQ task',
            agentId: 'qaiq',
            command: `qaiq ${flags} -p hola`,
            cwd: '/repo',
            state: 'running',
            createdAt: 0,
            ...(ownerLogin ? { ownerLogin } : {}),
        } as QaapAgentTask;
        const env = (runner as unknown as { buildChildEnv(task: QaapAgentTask): NodeJS.ProcessEnv }).buildChildEnv(task);
        return { flags, env };
    }

    const leakedValues = (env: NodeJS.ProcessEnv, forbidden: readonly string[]): string[] =>
        Object.entries(env).filter(([, value]) => typeof value === 'string' && forbidden.includes(value)).map(([key]) => key);

    it('hosted backend, signed-in tenant: flags and spawn env come only from the tenant\'s own settings', () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        const { flags, env } = run('alice');
        expect(flags).to.contain('--provider openai').and.contain('meta-llama/llama-3.3-70b-instruct:free');
        expect(env.OPENROUTER_API_KEY).to.equal('sk-alice-openrouter');
        expect(env.OPENAI_API_KEY).to.equal('sk-alice-openrouter');
        expect(env.ANTHROPIC_API_KEY).to.equal(undefined);
        expect(leakedValues(env, [...Object.values(OPERATOR_ENV), 'sk-shared-anthropic'])).to.deep.equal([]);
    });

    it('hosted backend, no login: neither operator env nor shared settings reach the agent', () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        const { flags, env } = run(undefined);
        expect(flags).not.to.contain('--provider anthropic');
        expect(leakedValues(env, [...Object.values(OPERATOR_ENV), 'sk-shared-anthropic'])).to.deep.equal([]);
    });

    it('local single user: Settings drive the model and win over env, operator env stays available', () => {
        const { flags, env } = run(undefined);
        expect(flags).to.contain('--provider anthropic').and.contain('claude-sonnet-4-6');
        expect(env.ANTHROPIC_API_KEY).to.equal('sk-shared-anthropic');
        expect(env.OPENROUTER_API_KEY).to.equal('operator-openrouter');
        expect(env.GITHUB_TOKEN).to.equal('operator-github');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { ComposerPromptImproveTimeoutError } from '@theia/qaap-composer/lib/common/qaap-composer-prompt-improve';
import type { QaapAgentTask, QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { QaapAgentCommandTimeoutError } from './qaap-agent-task-runner-utils3';

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
    const MODE_ENV = ['NODE_ENV', 'QAAP_CLOUD_MODE', 'QAAP_TENANT_BACKEND_MODE', 'QAAP_TENANT_BACKEND_SECRET'];

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
        process.env.QAAP_TENANT_BACKEND_SECRET = 'tenant-control-plane-secret';
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
            isTenantPrivilegeDropActive: () => false,
            tenantSpawn: { isContainerIsolationEnabled: () => false },
            detectedAgents: new Map([['qaiq', { id: 'qaiq', label: 'QAIQ', bin: 'qaiq', template: 'qaiq {qaiq_flags} -p {prompt}' }]]),
            resolveAgentSpawnIdentity: () => ({}),
            resolveAgentCliPrefix: () => '/home/qaap-agent/.qaap/cli',
            readUserSettingsFromDisk: (login?: string) => login === 'alice' ? { ...ALICE_SETTINGS } : { ...SHARED_SETTINGS },
            preferenceService: {
                get: (key: string) => SHARED_SETTINGS[key],
                inspectInScope: (_key: string, _scope: PreferenceScope) => undefined,
            },
        });
        return runner;
    }

    function run(ownerLogin: string | undefined, agentModel?: QaapCreateAgentTaskQaiqModel): { flags: string; env: NodeJS.ProcessEnv } {
        const runner = createRunner();
        const flags = runner.buildTemplateVars('qaiq', agentModel, {}, ownerLogin).qaiq_flags;
        const task = {
            id: 'task-1',
            title: 'QAIQ task',
            agentId: 'qaiq',
            command: `qaiq ${flags} -p hola`,
            cwd: '/repo',
            state: 'running',
            createdAt: 0,
            ...(ownerLogin ? { ownerLogin } : {}),
            ...(agentModel ? { agentModel, qaiqModel: agentModel } : {}),
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

    it('leaves a local user HOME untouched when no tenant privilege drop is active', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-browser-local-home-'));
        const previousHome = process.env.HOME;
        const previousChromium = process.env.QAAP_HEADLESS_CHROMIUM;
        process.env.HOME = home;
        process.env.QAAP_HEADLESS_CHROMIUM = '/usr/bin/chromium';
        try {
            const { env } = run('alice');
            expect(env.HOME).to.equal(home);
            expect(fs.readdirSync(home)).to.deep.equal([]);
        } finally {
            if (previousHome === undefined) {
                delete process.env.HOME;
            } else {
                process.env.HOME = previousHome;
            }
            if (previousChromium === undefined) {
                delete process.env.QAAP_HEADLESS_CHROMIUM;
            } else {
                process.env.QAAP_HEADLESS_CHROMIUM = previousChromium;
            }
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('registers the browser from a tenant-wrapped process, not from the backend process', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-agent-browser-tenant-home-'));
        const calls: { cwd: string; file: string; args: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];
        const runner = createRunner();
        Object.assign(runner, {
            tenantHomeEnvOverlay: () => ({ HOME: home }),
            isTenantPrivilegeDropActive: () => true,
            tenantSpawn: {
                isContainerIsolationEnabled: () => true,
                wrapArgvForTenant: (cwd: string, file: string, args: readonly string[], env?: NodeJS.ProcessEnv) => {
                    calls.push({ cwd, file, args, env });
                    return { file: process.execPath, args: [...args] };
                },
            },
        });
        const previousChromium = process.env.QAAP_HEADLESS_CHROMIUM;
        process.env.QAAP_HEADLESS_CHROMIUM = process.execPath;
        const task = {
            id: 'browser-bootstrap', title: 'browser bootstrap', agentId: 'qaiq', command: 'qaiq -p browse',
            cwd: home, state: 'running', createdAt: 0,
        } as QaapAgentTask;
        try {
            runner.buildChildEnv(task);

            expect(calls).to.have.length(1);
            expect(calls[0].cwd).to.equal(task.cwd);
            expect(calls[0].file).to.equal('node');
            expect(calls[0].args.join(' ')).to.contain('ensureQaapAgentBrowserMcpConfiguration');
            expect(calls[0].args.join(' ')).not.to.contain('qaap-agent-browser-mcp-config.js');
            expect(calls[0].env).to.deep.include({ HOME: home, QAAP_HEADLESS_CHROMIUM: process.execPath });
            expect(calls[0].env).not.to.have.property('QAAP_TENANT_BACKEND_SECRET');
            expect(fs.existsSync(path.join(home, '.claude.json'))).to.equal(true);
        } finally {
            if (previousChromium === undefined) {
                delete process.env.QAAP_HEADLESS_CHROMIUM;
            } else {
                process.env.QAAP_HEADLESS_CHROMIUM = previousChromium;
            }
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('never forwards the tenant backend authentication secret to the agent spawn env', () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        const { env } = run('alice');
        expect(env.QAAP_TENANT_BACKEND_SECRET).to.equal(undefined);
    });

    it('hosted backend, no login: neither operator env nor shared settings reach the agent', () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        const { flags, env } = run(undefined);
        expect(flags).not.to.contain('--provider anthropic');
        expect(leakedValues(env, [...Object.values(OPERATOR_ENV), 'sk-shared-anthropic'])).to.deep.equal([]);
    });

    it('hosted backend, explicit picker model: the pick is honoured with the tenant\'s own key only', () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        const pick = { provider: 'openai', vendor: 'openrouter', modelId: 'qwen/qwen3-coder:free', label: 'Qwen' } as QaapCreateAgentTaskQaiqModel;
        const { flags, env } = run('alice', pick);
        expect(flags).to.contain('--provider openai').and.contain('qwen/qwen3-coder:free');
        expect(env.OPENROUTER_API_KEY).to.equal('sk-alice-openrouter');
        expect(env.OPENAI_API_KEY).to.equal('sk-alice-openrouter');
        expect(leakedValues(env, [...Object.values(OPERATOR_ENV), 'sk-shared-anthropic'])).to.deep.equal([]);
    });

    it('hosted backend, explicit pick of a provider the tenant has no key for: no operator or shared key fills the gap', () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        const pick = { provider: 'anthropic', vendor: 'anthropic', modelId: 'claude-sonnet-4-6', label: 'Sonnet' } as QaapCreateAgentTaskQaiqModel;
        const { flags, env } = run('alice', pick);
        expect(flags).to.contain('--provider anthropic');
        expect(env.ANTHROPIC_API_KEY).to.equal(undefined);
        expect(leakedValues(env, [...Object.values(OPERATOR_ENV), 'sk-shared-anthropic'])).to.deep.equal([]);
    });

    it('hosted backend, Improve Prompt one-shot: runs as the requesting tenant with only their keys', async () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        const runner = createRunner();
        let spawned: { command: string; env: NodeJS.ProcessEnv } | undefined;
        Object.assign(runner, {
            runOneShotCommand: async (command: string, _cwd: string, env: NodeJS.ProcessEnv) => {
                spawned = { command, env };
                return 'better prompt';
            },
        });
        const improved = await runner.improveComposerPrompt({ prompt: 'hola', agentId: 'qaiq', cwd: '/repo', ownerLogin: 'alice' });
        expect(improved).to.equal('better prompt');
        expect(spawned?.command).to.contain('--provider openai').and.contain('meta-llama/llama-3.3-70b-instruct:free');
        expect(spawned?.env.OPENROUTER_API_KEY).to.equal('sk-alice-openrouter');
        expect(leakedValues(spawned!.env, [...Object.values(OPERATOR_ENV), 'sk-shared-anthropic'])).to.deep.equal([]);
    });

    it('converts a timed out Improve Prompt child process to the typed timeout response', async () => {
        process.env.QAAP_CLOUD_MODE = 'docker';
        const runner = createRunner();
        Object.assign(runner, {
            runOneShotCommand: async () => { throw new QaapAgentCommandTimeoutError(40_000); },
        });
        let failure: unknown;
        try {
            await runner.improveComposerPrompt({ prompt: 'hola', agentId: 'qaiq', cwd: '/repo', ownerLogin: 'alice' });
        } catch (error) {
            failure = error;
        }
        expect(failure).to.be.instanceOf(ComposerPromptImproveTimeoutError);
    });

    it('local single user: Settings drive the model and win over env, operator env stays available', () => {
        const { flags, env } = run(undefined);
        expect(flags).to.contain('--provider anthropic').and.contain('claude-sonnet-4-6');
        expect(env.ANTHROPIC_API_KEY).to.equal('sk-shared-anthropic');
        expect(env.OPENROUTER_API_KEY).to.equal('operator-openrouter');
        expect(env.GITHUB_TOKEN).to.equal('operator-github');
    });
});

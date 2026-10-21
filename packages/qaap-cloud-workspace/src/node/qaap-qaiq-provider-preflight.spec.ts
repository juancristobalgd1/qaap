// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import type { QaapCreateAgentTaskQaiqModel } from '../common/qaap-agent-task';
import { QaapAgentTaskRunner } from './qaap-agent-task-runner';
import { logDefaultAgentOverriddenOnce } from './qaap-agent-task-runner-render2';
import {
    checkQaiqProviderCredential,
    formatQaiqProviderOperatorHint,
    logQaiqProviderOperatorHintOnce,
} from './qaap-qaiq-provider-preflight';

/** The incident: QAIQ's default OpenRouter free model with no OpenRouter key anywhere. */
const NEMOTRON: QaapCreateAgentTaskQaiqModel = {
    provider: 'openai',
    vendor: 'openrouter',
    modelId: 'nvidia/nemotron-3-super-120b-a12b:free',
};
const OPENROUTER_BINDING = { vendor: 'openrouter' };
const noPrefs = (): unknown => undefined;

describe('QAIQ provider preflight', () => {

    describe('checkQaiqProviderCredential', () => {
        it('refuses an OpenRouter model when no OpenRouter key exists (the production incident)', () => {
            const failure = checkQaiqProviderCredential({ readPref: noPrefs, env: {}, selectedBinding: OPENROUTER_BINDING });
            expect(failure).to.deep.equal({
                vendor: 'openrouter',
                providerLabel: 'OpenRouter',
                credentialEnv: 'OPENROUTER_API_KEY',
                credentialPref: 'ai-features.openrouter.openrouterApiKey',
            });
        });

        it('does not let an OpenAI key stand in for the OpenRouter key', () => {
            const failure = checkQaiqProviderCredential({ readPref: noPrefs, env: { OPENAI_API_KEY: 'sk-openai' }, selectedBinding: OPENROUTER_BINDING });
            expect(failure?.vendor).to.equal('openrouter');
        });

        it('accepts the owner\'s own OpenRouter key from Settings, or a self-hosted server env key', () => {
            const fromSettings = (key: string): unknown => key === 'ai-features.openrouter.openrouterApiKey' ? 'sk-or-user' : undefined;
            expect(checkQaiqProviderCredential({ readPref: fromSettings, env: {}, selectedBinding: OPENROUTER_BINDING })).to.equal(undefined);
            expect(checkQaiqProviderCredential({ readPref: noPrefs, env: { OPENROUTER_API_KEY: 'sk-or-env' }, selectedBinding: OPENROUTER_BINDING }))
                .to.equal(undefined);
            expect(checkQaiqProviderCredential({
                readPref: noPrefs,
                env: { OPENAI_API_KEY: 'sk-or-legacy', OPENAI_BASE_URL: 'https://openrouter.ai/api/v1' },
                selectedBinding: OPENROUTER_BINDING,
            })).to.equal(undefined);
        });

        it('without a pick, follows the Settings alias even when keyless (refused, never swapped), else the env fallback', () => {
            expect(checkQaiqProviderCredential({ readPref: noPrefs, env: { GEMINI_API_KEY: 'g' }, settingsBinding: OPENROUTER_BINDING })?.vendor)
                .to.equal('openrouter');
            expect(checkQaiqProviderCredential({ readPref: noPrefs, env: { OPENAI_API_KEY: 'sk-openai' }, settingsBinding: OPENROUTER_BINDING })?.vendor)
                .to.equal('openrouter');
            expect(checkQaiqProviderCredential({ readPref: noPrefs, env: { GEMINI_API_KEY: 'g' } })).to.equal(undefined);
        });

        it('reports a missing provider when nothing at all is configured, and leaves unknown vendors to the CLI', () => {
            expect(checkQaiqProviderCredential({ readPref: noPrefs, env: {} })).to.deep.equal({});
            expect(checkQaiqProviderCredential({ readPref: noPrefs, env: { ANTHROPIC_API_KEY: 'a' } })).to.equal(undefined);
            expect(checkQaiqProviderCredential({
                readPref: noPrefs,
                env: {},
                selectedBinding: { vendor: 'someone-else' },
            })).to.equal(undefined);
        });
    });

    describe('operator hint', () => {
        const failure = { vendor: 'openrouter', providerLabel: 'OpenRouter', credentialEnv: 'OPENROUTER_API_KEY', credentialPref: 'ai-features.openrouter.openrouterApiKey' };

        it('tells a hosted operator the key is per user (BYOK), never a server env step', () => {
            const hint = formatQaiqProviderOperatorHint(failure, true);
            expect(hint).to.include('ai-features.openrouter.openrouterApiKey');
            expect(hint).to.include('withheld from tenants');
            expect(hint).to.not.match(/sk-/);
        });

        it('tells a self-hosted operator which env var to set and how to restart', () => {
            const hint = formatQaiqProviderOperatorHint(failure, false);
            expect(hint).to.include('OPENROUTER_API_KEY');
            expect(hint).to.include('docker compose up -d theia');
        });

        it('names a skipped QAAP_DEFAULT_AGENT once, without owner or secrets', () => {
            const lines: string[] = [];
            const logged = new Set<string>();
            expect(logDefaultAgentOverriddenOnce('qaiq', line => lines.push(line), logged)).to.equal(true);
            expect(logDefaultAgentOverriddenOnce('qaiq', line => lines.push(line), logged)).to.equal(false);
            expect(lines).to.have.length(1);
            expect(lines[0]).to.contain('QAAP_DEFAULT_AGENT=qaiq');
            expect(lines[0]).to.contain('Settings → BYOK');
        });

        it('logs once per provider and audience', () => {
            const lines: string[] = [];
            const logged = new Set<string>();
            expect(logQaiqProviderOperatorHintOnce(failure, true, line => lines.push(line), logged)).to.equal(true);
            expect(logQaiqProviderOperatorHintOnce(failure, true, line => lines.push(line), logged)).to.equal(false);
            expect(logQaiqProviderOperatorHintOnce(failure, false, line => lines.push(line), logged)).to.equal(true);
            expect(lines).to.have.length(2);
        });
    });

    describe('through the runner (hosted, per owner)', () => {
        const MODE_ENV = ['NODE_ENV', 'QAAP_CLOUD_MODE', 'QAAP_TENANT_BACKEND_MODE', 'QAAP_TENANT_BACKEND_SECRET', 'QAAP_DEFAULT_AGENT',
            'OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'NVIDIA_API_KEY', 'OLLAMA_HOST'];
        const saved: Record<string, string | undefined> = {};
        const SETTINGS: Record<string, Record<string, unknown>> = {
            alice: { 'ai-features.openrouter.openrouterApiKey': 'sk-or-alice' },
            bob: {},
        };

        beforeEach(() => {
            for (const key of MODE_ENV) {
                saved[key] = process.env[key];
                delete process.env[key];
            }
            process.env.QAAP_CLOUD_MODE = 'docker';
            process.env.QAAP_TENANT_BACKEND_SECRET = 'tenant-control-plane-secret';
            // An operator key, if one were set, must never make a tenant's QAIQ look ready.
            process.env.OPENROUTER_API_KEY = 'operator-openrouter';
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
                detectedAgents: new Map([
                    ['qaiq', { id: 'qaiq', label: 'QAIQ', bin: 'qaiq', template: 'qaiq {qaiq_flags} -p {prompt}' }],
                    ['opencode', { id: 'opencode', label: 'OpenCode', bin: 'opencode', template: 'opencode run {prompt}' }],
                ]),
                agentConnectionStates: new Map(),
                agentConnectionProbes: new Map(),
                readUserSettingsFromDisk: (login?: string) => ({ ...(login ? SETTINGS[login] ?? {} : {}) }),
                preferenceService: {
                    get: () => undefined,
                    inspectInScope: (_key: string, _scope: PreferenceScope) => undefined,
                },
                // No auth-probe spawns in a unit test: CLI-login harnesses stay `unknown`.
                refreshAgentConnectionState: () => undefined,
            });
            return runner;
        }

        it('refuses a keyless owner before spawn with the BYOK copy, and runs the owner who has a key', () => {
            const runner = createRunner();
            expect(() => runner.assertQaiqConfigured('qaiq', 'bob', NEMOTRON))
                .to.throw('Add your OpenRouter API key in Settings → BYOK to use QAIQ, pick a model from a provider you have a key for, '
                    + 'or pick another agent from the agent chip.');
            expect(() => runner.assertQaiqConfigured('qaiq', 'alice', NEMOTRON)).to.not.throw();
        });

        it('refuses a keyless Settings alias with that alias vendor\'s copy, even with another provider\'s key, and the flags agree', () => {
            SETTINGS.carol = {
                'ai-features.languageModelAliases': { 'default/code': { selectedModel: `openrouter/${NEMOTRON.modelId}` } },
                'ai-features.google.apiKey': 'gemini-carol',
            };
            try {
                const runner = createRunner();
                expect(() => runner.assertQaiqConfigured('qaiq', 'carol'))
                    .to.throw(/^Add your OpenRouter API key in Settings/);
                // The command builder and the spawn env resolve the same (alias) vendor as the preflight.
                expect(runner.resolveQaiqProviderFlags('carol')).to.contain(NEMOTRON.modelId);
                expect(runner.resolveQaiqProviderFlags('carol')).to.not.contain('gemini');
            } finally {
                delete SETTINGS.carol;
            }
        });

        it('logs one operator hint when QAAP_DEFAULT_AGENT=qaiq is skipped for a keyless owner', () => {
            process.env.QAAP_DEFAULT_AGENT = 'qaiq';
            const lines: string[] = [];
            const original = console.warn;
            console.warn = (message: string) => { lines.push(message); };
            try {
                const runner = createRunner();
                expect(runner.defaultAgent('bob')).to.not.equal('qaiq');
                runner.defaultAgent('bob');
                expect(runner.defaultAgent('alice')).to.equal('qaiq');
            } finally {
                console.warn = original;
            }
            const hints = lines.filter(line => line.includes('QAAP_DEFAULT_AGENT=qaiq'));
            expect(hints.length).to.be.at.most(1);
            expect(hints.join('\n')).to.not.match(/sk-|bob|alice/);
        });

        it('reports QAIQ connected per owner, so a keyless owner never gets it as default', () => {
            const runner = createRunner();
            const states = (owner: string): string | undefined => runner.listAgents(owner).find(agent => agent.id === 'qaiq')?.connectionState;
            expect(states('alice')).to.equal('connected');
            expect(states('bob')).to.equal('disconnected');
            expect(runner.defaultAgent('alice')).to.equal('qaiq');
            expect(runner.defaultAgent('bob')).to.not.equal('qaiq');
        });
    });
});

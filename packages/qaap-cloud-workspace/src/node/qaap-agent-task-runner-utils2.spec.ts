// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { AGENT_ENV_PREFS } from './qaap-agent-task-runner-constants';
import type { QaapAgentTaskRunnerContext } from './qaap-agent-task-runner-context';
import { applyProviderPreferenceEnvExtracted } from './qaap-agent-task-runner-tool-pills2';
import {
    preferenceReaderForOwner,
    readUserSettingsFromDisk,
    SHARED_PROVIDER_ONLY_ENV,
    stripSharedProviderEnv,
    writeUserSettingsToDisk,
} from './qaap-agent-task-runner-utils2';

describe('qaap-agent-task-runner-utils2', () => {

    describe('preferenceReaderForOwner (authenticated tenant)', () => {
        const schemaDefaults: Record<string, unknown> = {
            'ai-features.openAiOfficial.officialOpenAiModels': ['gpt-5.5', 'gpt-5.4'],
            'ai-features.openAiOfficial.useResponseApi': false,
            'files.autoSave': 'afterDelay',
        };
        const scopesSeen: PreferenceScope[] = [];
        const preferenceService = {
            get: (): unknown => 'shared-user-scope-leak',
            inspectInScope: (key: string, scope: PreferenceScope): unknown => {
                scopesSeen.push(scope);
                return scope === PreferenceScope.Default ? schemaDefaults[key] : 'shared-user-scope-leak';
            },
        };
        const reader = (settings: Record<string, unknown>): (key: string) => unknown => preferenceReaderForOwner({
            readUserSettingsFromDisk: () => settings,
            preferenceService,
        }, 'alice');

        it('falls back to the schema default when the user has not set an allowlisted key', () => {
            const read = reader({ 'ai-features.openAiOfficial.openAiApiKey': 'sk-alice' });
            expect(read('ai-features.openAiOfficial.officialOpenAiModels')).to.deep.equal(['gpt-5.5', 'gpt-5.4']);
            expect(read('ai-features.openAiOfficial.useResponseApi')).to.equal(false);
            expect(scopesSeen.every(scope => scope === PreferenceScope.Default)).to.equal(true);
        });

        it('prefers the user value, even a falsy one, over the default', () => {
            const read = reader({ 'ai-features.openAiOfficial.useResponseApi': true, 'ai-features.openAiOfficial.officialOpenAiModels': [] });
            expect(read('ai-features.openAiOfficial.useResponseApi')).to.equal(true);
            expect(read('ai-features.openAiOfficial.officialOpenAiModels')).to.deep.equal([]);
        });

        it('never returns shared values: no default for API keys, nothing for non-AI keys', () => {
            const read = reader({});
            expect(read('ai-features.openAiOfficial.openAiApiKey')).to.equal(undefined);
            expect(read('files.autoSave')).to.equal(undefined);
            expect(scopesSeen.every(scope => scope === PreferenceScope.Default)).to.equal(true);
        });

        it('tolerates a preference service without inspectInScope', () => {
            const read = preferenceReaderForOwner({ readUserSettingsFromDisk: () => ({}), preferenceService: { get: () => 'leak' } }, 'alice');
            expect(read('ai-features.openAiOfficial.officialOpenAiModels')).to.equal(undefined);
        });
    });

    describe('stripSharedProviderEnv', () => {
        const providerEnv = (): string[] => [...AGENT_ENV_PREFS.map(mapping => mapping.env), ...SHARED_PROVIDER_ONLY_ENV, 'OPENAI_BASE_URL'];
        const inherited = (): NodeJS.ProcessEnv => {
            const env: NodeJS.ProcessEnv = { PATH: '/usr/bin', QAAP_GITHUB_CLIENT_SECRET: 'oauth-secret' };
            for (const name of providerEnv()) {
                env[name] = 'operator';
            }
            return env;
        };

        it('authenticated tenant: removes every operator provider credential and backend secret', () => {
            const env = inherited();
            stripSharedProviderEnv(env, 'alice');
            for (const name of providerEnv()) {
                expect(env[name], name).to.equal(undefined);
            }
            expect(env.QAAP_GITHUB_CLIENT_SECRET).to.equal(undefined);
            expect(env.PATH).to.equal('/usr/bin');
        });

        it('local / anonymous single user: keeps the operator provider keys, still removes backend secrets', () => {
            for (const owner of [undefined, '_dev', '_anonymous']) {
                const env = inherited();
                stripSharedProviderEnv(env, owner);
                for (const name of providerEnv()) {
                    expect(env[name], `${owner}:${name}`).to.equal('operator');
                }
                expect(env.QAAP_GITHUB_CLIENT_SECRET).to.equal(undefined);
            }
        });

        it('covers the credentials read by the built-in agent CLIs', () => {
            for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'COPILOT_GITHUB_TOKEN', 'CURSOR_API_KEY', 'DASHSCOPE_API_KEY', 'XAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']) {
                expect(SHARED_PROVIDER_ONLY_ENV, name).to.include(name);
            }
        });
    });

    it('applyProviderPreferenceEnv prefers the user\'s Settings over inherited env keys', () => {
        const env: NodeJS.ProcessEnv = { OPENROUTER_API_KEY: 'operator', NVIDIA_API_KEY: 'operator' };
        const ctx = {
            preferenceReaderForOwner: () => (key: string) => key === 'ai-features.openrouter.openrouterApiKey' ? 'sk-user' : undefined,
            applyOpenRouterOpenAiCompatEnv: () => undefined,
        };
        applyProviderPreferenceEnvExtracted(ctx as unknown as QaapAgentTaskRunnerContext, env, undefined);
        expect(env.OPENROUTER_API_KEY).to.equal('sk-user');
        expect(env.NVIDIA_API_KEY).to.equal('operator');
    });

    it('writeUserSettingsToDisk stores every ai-features.* key but no other key', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-ai-prefix-'));
        try {
            const stored = writeUserSettingsToDisk('alice', { 'ai-features.chat.defaultChatAgent': 'Coder', 'editor.fontSize': 14 }, home);
            expect(stored).to.deep.equal({ 'ai-features.chat.defaultChatAgent': 'Coder' });
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('writeUserSettingsToDisk deletes AI keys patched with null and never other keys', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-ai-null-'));
        try {
            writeUserSettingsToDisk('alice', { 'ai-features.openAiOfficial.officialOpenAiModels': ['gpt-5.5'] }, home);
            const file = path.join(home, '.qaap', 'users', 'alice', 'settings.json');
            fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), 'editor.fontSize': 14 }));
            // eslint-disable-next-line no-null/no-null
            writeUserSettingsToDisk('alice', { 'ai-features.openAiOfficial.officialOpenAiModels': null, 'editor.fontSize': null }, home);
            expect(readUserSettingsFromDisk('alice', home)).to.deep.equal({ 'editor.fontSize': 14 });
        } finally {
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('applyProviderPreferenceEnv does not export the Ollama schema-default host', () => {
        const run = (host: string): NodeJS.ProcessEnv => {
            const env: NodeJS.ProcessEnv = {};
            const ctx = {
                preferenceReaderForOwner: () => (key: string) => key === 'ai-features.ollama.ollamaHost' ? host : undefined,
                applyOpenRouterOpenAiCompatEnv: () => undefined,
            };
            applyProviderPreferenceEnvExtracted(ctx as unknown as QaapAgentTaskRunnerContext, env, 'alice');
            return env;
        };
        expect(run('http://localhost:11434').OLLAMA_HOST).to.equal(undefined);
        expect(run('http://gpu-box:11434').OLLAMA_HOST).to.equal('http://gpu-box:11434');
    });
});

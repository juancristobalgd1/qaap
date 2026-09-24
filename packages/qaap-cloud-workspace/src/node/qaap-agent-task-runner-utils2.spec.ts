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

        it('never returns shared values: no default for API keys, nothing for keys outside the allowlist', () => {
            const read = reader({});
            expect(read('ai-features.openAiOfficial.openAiApiKey')).to.equal(undefined);
            expect(read('files.autoSave')).to.equal(undefined);
        });

        it('tolerates a preference service without inspectInScope', () => {
            const read = preferenceReaderForOwner({ readUserSettingsFromDisk: () => ({}), preferenceService: { get: () => 'leak' } }, 'alice');
            expect(read('ai-features.openAiOfficial.officialOpenAiModels')).to.equal(undefined);
        });
    });

    it('stripSharedProviderEnv removes every canonical AGENT_ENV_PREFS env var and other provider keys', () => {
        const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
        const extra = ['HF_TOKEN', 'MISTRAL_API_KEY', 'XAI_API_KEY', 'GROK_API_KEY', 'GROQ_API_KEY', 'DEEPSEEK_API_KEY', 'CODEX_API_KEY'];
        for (const name of [...AGENT_ENV_PREFS.map(mapping => mapping.env), ...extra]) {
            env[name] = 'shared';
        }
        stripSharedProviderEnv(env);
        for (const name of [...AGENT_ENV_PREFS.map(mapping => mapping.env), ...extra]) {
            expect(env[name], name).to.equal(undefined);
        }
        expect(env.PATH).to.equal('/usr/bin');
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

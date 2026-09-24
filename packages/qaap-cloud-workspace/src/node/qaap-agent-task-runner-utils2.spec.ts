// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { AGENT_ENV_PREFS } from './qaap-agent-task-runner-constants';
import { preferenceReaderForOwner, stripSharedProviderEnv } from './qaap-agent-task-runner-utils2';

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

    it('stripSharedProviderEnv removes every canonical AGENT_ENV_PREFS env var', () => {
        const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
        for (const mapping of AGENT_ENV_PREFS) {
            env[mapping.env] = 'shared';
        }
        stripSharedProviderEnv(env);
        for (const mapping of AGENT_ENV_PREFS) {
            expect(env[mapping.env], mapping.env).to.equal(undefined);
        }
        expect(env.PATH).to.equal('/usr/bin');
    });
});

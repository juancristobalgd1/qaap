// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { JSONValue } from '@theia/core/shared/@lumino/coreutils';
import { PreferenceDataProperty, PreferenceProvider, PreferenceSchemaService, PreferenceService } from '@theia/core/lib/common/preferences';
import { QaapTenantAiUserPreferenceProvider } from './qaap-tenant-ai-user-preference-provider';
import { QaapUserAiSettingsSyncContribution } from './qaap-user-ai-settings-sync';

disableJSDOM();

const MODELS = 'ai-features.openAiOfficial.officialOpenAiModels';
const API_KEY = 'ai-features.openAiOfficial.openAiApiKey';
const RESPONSE_API = 'ai-features.openAiOfficial.useResponseApi';
const CHAT_AGENT = 'ai-features.chat.defaultChatAgent';

class TestableSync extends QaapUserAiSettingsSyncContribution {
    tenant(provider: QaapTenantAiUserPreferenceProvider): Record<string, unknown> {
        return this.collectTenantSettings(provider);
    }
    local(): Record<string, unknown> {
        return this.collectLocalSettings();
    }
}

describe('QaapUserAiSettingsSyncContribution', () => {

    const defaults: Record<string, unknown> = { [MODELS]: ['gpt-5.5'], [RESPONSE_API]: false };
    const userScope: Record<string, unknown> = { [API_KEY]: 'sk-shared-file', [MODELS]: ['gpt-5.5'], [CHAT_AGENT]: 'Coder', 'editor.fontSize': 14 };

    function createSync(): TestableSync {
        const sync = new TestableSync();
        const fields = sync as unknown as { preferenceService: Partial<PreferenceService>; schemaService: Partial<PreferenceSchemaService> };
        fields.preferenceService = {
            inspect: ((key: string) => ({
                preferenceName: key,
                defaultValue: defaults[key],
                globalValue: userScope[key],
                workspaceValue: undefined,
                workspaceFolderValue: undefined,
                value: userScope[key] ?? defaults[key],
            })) as PreferenceService['inspect'],
        };
        fields.schemaService = {
            getSchemaProperties: () => new Map<string, PreferenceDataProperty>(
                [MODELS, RESPONSE_API, CHAT_AGENT, 'editor.fontSize'].map(key => [key, { type: 'string' }])),
        };
        return sync;
    }

    function tenantProvider(): QaapTenantAiUserPreferenceProvider {
        const shared = {
            onDidPreferencesChanged: () => ({ dispose: () => undefined }),
            resolve: () => ({}),
            getPreferences: () => ({}),
        } as unknown as PreferenceProvider;
        return new QaapTenantAiUserPreferenceProvider(shared, () => true);
    }

    it('authenticated tenant: persists only its own settings, deleting resets and default values', async () => {
        const provider = tenantProvider();
        await provider.setPreference(RESPONSE_API, true);
        await provider.setPreference(CHAT_AGENT, 'Architect');
        await provider.setPreference(MODELS, ['gpt-5.5']);
        await provider.setPreference(API_KEY, 'sk-alice');
        await provider.setPreference(API_KEY, undefined as unknown as JSONValue);
        // eslint-disable-next-line no-null/no-null
        expect(createSync().tenant(provider)).to.deep.equal({ [RESPONSE_API]: true, [CHAT_AGENT]: 'Architect', [MODELS]: null, [API_KEY]: null });
    });

    it('local user: persists every AI setting set in User scope, never defaults or non-AI keys', () => {
        // eslint-disable-next-line no-null/no-null
        expect(createSync().local()).to.deep.equal({ [API_KEY]: 'sk-shared-file', [MODELS]: null, [CHAT_AGENT]: 'Coder' });
    });
});

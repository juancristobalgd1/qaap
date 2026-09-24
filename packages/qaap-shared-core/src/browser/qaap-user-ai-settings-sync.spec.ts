// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { QaapUserAiSettingsSyncContribution } from './qaap-user-ai-settings-sync';

disableJSDOM();

const MODELS = 'ai-features.openAiOfficial.officialOpenAiModels';
const API_KEY = 'ai-features.openAiOfficial.openAiApiKey';
const RESPONSE_API = 'ai-features.openAiOfficial.useResponseApi';

class TestableSync extends QaapUserAiSettingsSyncContribution {
    collect(intercepting: boolean): Record<string, unknown> {
        return this.collectSettingsForPersist(intercepting);
    }
    setOverlay(key: string, value: unknown): void {
        this.overlay.set(key, value);
    }
    reset(key: string): void {
        this.resetKeys.add(key);
    }
}

describe('QaapUserAiSettingsSyncContribution.collectSettingsForPersist', () => {

    const defaults: Record<string, unknown> = { [MODELS]: ['gpt-5.5'], [RESPONSE_API]: false };
    const userScope: Record<string, unknown> = { [API_KEY]: 'sk-shared-file', [MODELS]: ['gpt-5.5'] };

    function createSync(): TestableSync {
        const sync = new TestableSync();
        (sync as unknown as { preferenceService: Partial<PreferenceService> }).preferenceService = {
            inspect: ((key: string) => ({
                preferenceName: key,
                defaultValue: defaults[key],
                globalValue: userScope[key],
                workspaceValue: undefined,
                workspaceFolderValue: undefined,
                value: userScope[key] ?? defaults[key],
            })) as PreferenceService['inspect'],
        };
        return sync;
    }

    it('authenticated tenant: persists only its own overlay, never the shared User scope', () => {
        const sync = createSync();
        sync.setOverlay(RESPONSE_API, true);
        expect(sync.collect(true)).to.deep.equal({ [RESPONSE_API]: true });
    });

    it('sends null (delete) for values equal to the schema default and for reset keys', () => {
        const sync = createSync();
        sync.setOverlay(MODELS, ['gpt-5.5']);
        sync.reset(API_KEY);
        // eslint-disable-next-line no-null/no-null
        expect(sync.collect(true)).to.deep.equal({ [MODELS]: null, [API_KEY]: null });
    });

    it('local user: persists User-scope values but not ones equal to the default', () => {
        // eslint-disable-next-line no-null/no-null
        expect(createSync().collect(false)).to.deep.equal({ [API_KEY]: 'sk-shared-file', [MODELS]: null });
    });
});

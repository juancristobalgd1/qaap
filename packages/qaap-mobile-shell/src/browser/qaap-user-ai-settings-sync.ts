// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import {
    fetchQaapUserAiSettings,
    putQaapUserAiSettings,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { listQaapAiSettingsPrefKeys } from '../common/qaap-qaiq-byok-provider-registry';
import { setAgentModelStorageUserLogin } from '../common/qaap-agent-model-selection';
import { readQaapAuthUser } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';

const PUSH_DEBOUNCE_MS = 250;

/**
 * Mirrors Settings → AI Features into `~/.qaap/users/{login}/settings.json` so each
 * authenticated tenant's API keys and model lists are the spawn source of truth.
 */
@injectable()
export class QaapUserAiSettingsSyncContribution implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    protected applyingRemote = false;
    protected pushTimer: ReturnType<typeof setTimeout> | undefined;
    protected readonly aiPrefKeys = new Set(listQaapAiSettingsPrefKeys());

    onStart(): void {
        setAgentModelStorageUserLogin(readQaapAuthUser()?.login);
        void this.hydrateFromServer();
        this.preferenceService.onPreferenceChanged(event => {
            if (this.applyingRemote || !this.aiPrefKeys.has(event.preferenceName)) {
                return;
            }
            this.schedulePush();
        });
    }

    protected async hydrateFromServer(): Promise<void> {
        try {
            const settings = await fetchQaapUserAiSettings();
            const keys = Object.keys(settings);
            if (keys.length === 0) {
                return;
            }
            this.applyingRemote = true;
            try {
                for (const key of keys) {
                    await this.preferenceService.set(key, settings[key], PreferenceScope.User);
                }
            } finally {
                this.applyingRemote = false;
            }
        } catch (error) {
            console.warn('[qaap-user-ai-settings] hydrate failed:', error instanceof Error ? error.message : String(error));
        }
    }

    protected schedulePush(): void {
        if (this.pushTimer !== undefined) {
            clearTimeout(this.pushTimer);
        }
        this.pushTimer = setTimeout(() => {
            this.pushTimer = undefined;
            void this.pushToServer();
        }, PUSH_DEBOUNCE_MS);
    }

    protected async pushToServer(): Promise<void> {
        const settings: Record<string, unknown> = {};
        for (const key of this.aiPrefKeys) {
            const value = this.preferenceService.get(key);
            if (value !== undefined) {
                settings[key] = value;
            }
        }
        try {
            await putQaapUserAiSettings(settings);
        } catch (error) {
            console.warn('[qaap-user-ai-settings] save failed:', error instanceof Error ? error.message : String(error));
        }
    }
}

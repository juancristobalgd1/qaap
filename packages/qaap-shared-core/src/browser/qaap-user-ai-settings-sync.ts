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
import {
    applyAiSettingsOverlay,
    collectAiSettingsForPersist,
    overlayPrefGet,
    shouldInterceptSharedUserAiPrefWrites,
} from '../common/qaap-user-ai-settings-overlay';

const PUSH_DEBOUNCE_MS = 250;

/**
 * Mirrors Settings → AI Features into `~/.qaap/users/{login}/settings.json` so each
 * authenticated tenant's API keys and model lists are the spawn source of truth.
 *
 * Authenticated tenants never write those keys into Theia's process-wide User
 * `settings.json` (one backend would otherwise show User A's keys in User B's UI).
 */
@injectable()
export class QaapUserAiSettingsSyncContribution implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    protected applyingRemote = false;
    protected interceptInstalled = false;
    protected pushTimer: ReturnType<typeof setTimeout> | undefined;
    protected readonly aiPrefKeys = new Set(listQaapAiSettingsPrefKeys());
    protected readonly overlay = new Map<string, unknown>();
    protected originalGet: PreferenceService['get'] | undefined;
    protected originalSet: PreferenceService['set'] | undefined;

    onStart(): void {
        setAgentModelStorageUserLogin(readQaapAuthUser()?.login);
        this.installPreferenceInterceptor();
        void this.hydrateFromServer();
        this.preferenceService.onPreferenceChanged(event => {
            if (this.applyingRemote || !this.aiPrefKeys.has(event.preferenceName)) {
                return;
            }
            if (this.shouldInterceptWrites()) {
                return;
            }
            this.schedulePush();
        });
    }

    protected shouldInterceptWrites(): boolean {
        return shouldInterceptSharedUserAiPrefWrites(readQaapAuthUser()?.login);
    }

    protected installPreferenceInterceptor(): void {
        if (this.interceptInstalled) {
            return;
        }
        this.interceptInstalled = true;
        const service = this.preferenceService;
        const originalGet = service.get.bind(service) as PreferenceService['get'];
        const originalSet = service.set.bind(service) as PreferenceService['set'];
        this.originalGet = originalGet;
        this.originalSet = originalSet;
        service.get = ((preferenceName: string, defaultValue?: unknown, resourceUri?: string) =>
            overlayPrefGet(this.overlay, preferenceName, () => originalGet(preferenceName, defaultValue, resourceUri))
        ) as PreferenceService['get'];
        service.set = async (preferenceName, value, scope, resourceUri) => {
            if (this.shouldInterceptWrites() && this.aiPrefKeys.has(preferenceName)) {
                this.overlay.set(preferenceName, value);
                this.schedulePush();
                return;
            }
            return originalSet(preferenceName, value, scope, resourceUri);
        };
    }

    protected async hydrateFromServer(): Promise<void> {
        try {
            const settings = await fetchQaapUserAiSettings();
            const keys = Object.keys(settings);
            if (keys.length === 0) {
                return;
            }
            if (this.shouldInterceptWrites()) {
                applyAiSettingsOverlay(this.overlay, settings, name => this.aiPrefKeys.has(name));
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
        const fallback = (key: string): unknown => this.originalGet
            ? this.originalGet(key)
            : this.preferenceService.get(key);
        const settings = collectAiSettingsForPersist(this.overlay, this.aiPrefKeys, fallback);
        try {
            await putQaapUserAiSettings(settings);
        } catch (error) {
            console.warn('[qaap-user-ai-settings] save failed:', error instanceof Error ? error.message : String(error));
        }
    }
}

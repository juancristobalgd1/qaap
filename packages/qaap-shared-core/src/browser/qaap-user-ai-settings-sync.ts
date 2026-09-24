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
    /** Keys reset (set to `undefined`) by an authenticated tenant, pending deletion from their settings file. */
    protected readonly resetKeys = new Set<string>();
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
            overlayPrefGet(this.overlay, preferenceName, () => this.aiPrefKeys.has(preferenceName) && this.shouldInterceptWrites()
                // Authenticated tenant without an own value: the schema default, never the shared User-scope file.
                ? service.inspect(preferenceName, resourceUri)?.defaultValue ?? defaultValue
                : originalGet(preferenceName, defaultValue, resourceUri))
        ) as PreferenceService['get'];
        service.set = async (preferenceName, value, scope, resourceUri) => {
            if (this.shouldInterceptWrites() && this.aiPrefKeys.has(preferenceName)) {
                if (value === undefined) {
                    this.overlay.delete(preferenceName);
                    this.resetKeys.add(preferenceName);
                } else {
                    this.overlay.set(preferenceName, value);
                    this.resetKeys.delete(preferenceName);
                }
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
        const settings = this.collectSettingsForPersist(this.shouldInterceptWrites());
        try {
            await putQaapUserAiSettings(settings);
        } catch (error) {
            console.warn('[qaap-user-ai-settings] save failed:', error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Patch for the per-user settings file. `null` asks the backend to delete the key (JSON drops `undefined`):
     * sent for values reset in the overlay or equal to the schema default, so the backend reader falls back to
     * the (current) default instead of a frozen copy. Keys the overlay does not hold are sent only for local /
     * anonymous users, and only when set in User scope: for authenticated tenants that scope is the
     * process-wide shared file, so it must never be copied into their own settings.
     */
    protected collectSettingsForPersist(intercepting: boolean): Record<string, unknown> {
        const settings: Record<string, unknown> = {};
        for (const key of this.aiPrefKeys) {
            let value: unknown;
            if (this.resetKeys.has(key)) {
                value = undefined;
            } else if (this.overlay.has(key)) {
                value = this.overlay.get(key);
            } else if (intercepting) {
                continue;
            } else {
                value = this.preferenceService.inspect(key)?.globalValue;
                if (value === undefined) {
                    continue;
                }
            }
            // eslint-disable-next-line no-null/no-null
            settings[key] = value === undefined || value === null || this.isSchemaDefault(key, value) ? null : value;
        }
        return settings;
    }

    protected isSchemaDefault(key: string, value: unknown): boolean {
        const defaultValue = this.preferenceService.inspect(key)?.defaultValue;
        return defaultValue !== undefined && JSON.stringify(defaultValue) === JSON.stringify(value);
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable, named } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { PreferenceProvider, PreferenceSchemaService, PreferenceService } from '@theia/core/lib/common/preferences';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import {
    fetchQaapUserAiSettings,
    putQaapUserAiSettings,
} from '@theia/qaap-adapters/lib/browser/qaap-github-auth-client';
import { isQaapAiSettingsPrefKey, listQaapAiSettingsPrefKeys } from '../common/qaap-qaiq-byok-provider-registry';
import { setAgentModelStorageUserLogin } from '../common/qaap-agent-model-selection';
import { readQaapAuthUser } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { shouldInterceptSharedUserAiPrefWrites } from '../common/qaap-user-ai-settings-overlay';
import { QaapTenantAiUserPreferenceProvider } from './qaap-tenant-ai-user-preference-provider';

const PUSH_DEBOUNCE_MS = 250;

/**
 * Mirrors Settings → AI Features (`ai-features.*`) into `~/.qaap/users/{login}/settings.json` so each
 * user's API keys, model lists and AI options are the spawn source of truth.
 *
 * Authenticated tenants keep those settings in {@link QaapTenantAiUserPreferenceProvider} (never in
 * Theia's process-wide User `settings.json`); this contribution hydrates it and pushes its changes.
 * Local / anonymous users keep the regular User scope and are mirrored as well.
 */
@injectable()
export class QaapUserAiSettingsSyncContribution implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @inject(PreferenceSchemaService)
    protected readonly schemaService: PreferenceSchemaService;

    @inject(PreferenceProvider) @named(PreferenceScope.User)
    protected readonly userProvider: PreferenceProvider;

    protected applyingRemote = false;
    protected pushTimer: ReturnType<typeof setTimeout> | undefined;

    onStart(): void {
        setAgentModelStorageUserLogin(readQaapAuthUser()?.login);
        const tenantProvider = this.tenantProvider();
        if (this.shouldInterceptWrites() && !tenantProvider) {
            console.warn('[qaap-user-ai-settings] tenant AI preference provider is not bound; AI settings are not persisted per user.');
        }
        void this.hydrateFromServer();
        tenantProvider?.onDidChangeTenantSetting(() => this.schedulePush());
        this.preferenceService.onPreferenceChanged(event => {
            if (this.applyingRemote || !isQaapAiSettingsPrefKey(event.preferenceName) || this.shouldInterceptWrites()) {
                return;
            }
            this.schedulePush();
        });
    }

    protected shouldInterceptWrites(): boolean {
        return shouldInterceptSharedUserAiPrefWrites(readQaapAuthUser()?.login);
    }

    protected tenantProvider(): QaapTenantAiUserPreferenceProvider | undefined {
        return this.userProvider instanceof QaapTenantAiUserPreferenceProvider ? this.userProvider : undefined;
    }

    protected async hydrateFromServer(): Promise<void> {
        try {
            const settings = await fetchQaapUserAiSettings();
            const keys = Object.keys(settings);
            if (keys.length === 0) {
                return;
            }
            if (this.shouldInterceptWrites()) {
                this.tenantProvider()?.applyTenantSettings(settings);
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
        const intercepting = this.shouldInterceptWrites();
        const tenantProvider = this.tenantProvider();
        if (intercepting && !tenantProvider) {
            return;
        }
        const settings = intercepting ? this.collectTenantSettings(tenantProvider!) : this.collectLocalSettings();
        try {
            await putQaapUserAiSettings(settings);
        } catch (error) {
            console.warn('[qaap-user-ai-settings] save failed:', error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Patch for an authenticated tenant: only its own overlay, never the shared User scope. `null` asks the
     * backend to delete the key (JSON drops `undefined`): sent for reset values and values equal to the schema
     * default, so the backend reader falls back to the current default instead of a frozen copy.
     */
    protected collectTenantSettings(provider: QaapTenantAiUserPreferenceProvider): Record<string, unknown> {
        const settings: Record<string, unknown> = {};
        for (const key of provider.tenantResetKeys()) {
            // eslint-disable-next-line no-null/no-null
            settings[key] = null;
        }
        for (const [key, value] of provider.tenantSettings()) {
            settings[key] = this.persistedValue(key, value);
        }
        return settings;
    }

    /** Patch for a local / anonymous user: AI settings set in User scope (never schema defaults). */
    protected collectLocalSettings(): Record<string, unknown> {
        const keys = new Set(listQaapAiSettingsPrefKeys());
        for (const key of this.schemaService.getSchemaProperties().keys()) {
            if (isQaapAiSettingsPrefKey(key)) {
                keys.add(key);
            }
        }
        const settings: Record<string, unknown> = {};
        for (const key of keys) {
            const value = this.preferenceService.inspect(key)?.globalValue;
            if (value !== undefined) {
                settings[key] = this.persistedValue(key, value);
            }
        }
        return settings;
    }

    protected persistedValue(key: string, value: unknown): unknown {
        const defaultValue = this.preferenceService.inspect(key)?.defaultValue;
        // eslint-disable-next-line no-null/no-null
        return value === undefined || value === null || (defaultValue !== undefined && JSON.stringify(defaultValue) === JSON.stringify(value)) ? null : value;
    }
}

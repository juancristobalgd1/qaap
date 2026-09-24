// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { interfaces } from '@theia/core/shared/inversify';
import { JSONObject, JSONValue } from '@theia/core/shared/@lumino/coreutils';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { URI } from '@theia/core/lib/common/uri';
import {
    PreferenceProvider,
    PreferenceProviderDataChanges,
    PreferenceResolveResult,
    PreferenceScope,
} from '@theia/core/lib/common/preferences';
import { readQaapAuthUser } from '@theia/qaap-adapters/lib/browser/qaap-auth-session';
import { isQaapAiSettingsPrefKey, isQaapIsolatedAiSettingsPrefKey } from '../common/qaap-qaiq-byok-provider-registry';
import { shouldInterceptSharedUserAiPrefWrites } from '../common/qaap-user-ai-settings-overlay';

/**
 * User-scope {@link PreferenceProvider} decorator that keeps an authenticated tenant's AI settings
 * (`ai-features.*`) out of Theia's process-wide User `settings.json` (one backend, many tenants).
 *
 * For a tenant, AI values live in an in-memory overlay mirrored to `~/.qaap/users/{login}/settings.json`
 * by `QaapUserAiSettingsSyncContribution`. Because this sits at the provider level, every consumer
 * (`get`, `inspect`, preference proxies, the Settings editor) sees the overlay, and writes surface as
 * regular `onPreferenceChanged` events through `PreferenceServiceImpl`.
 *
 * Reads without an overlay value: credential/BYOK keys fall back to the schema default only; other AI
 * settings may still inherit the shared User scope (operator policy), which tenants can no longer write.
 * Local / anonymous users bypass the decorator entirely.
 */
export class QaapTenantAiUserPreferenceProvider implements PreferenceProvider {

    protected readonly overlay = new Map<string, JSONValue>();
    /** Keys a tenant reset to `undefined`, still to be deleted from their settings file. */
    protected readonly resetKeys = new Set<string>();

    protected readonly onDidPreferencesChangedEmitter = new Emitter<PreferenceProviderDataChanges>();
    readonly onDidPreferencesChanged: Event<PreferenceProviderDataChanges> = this.onDidPreferencesChangedEmitter.event;

    protected readonly onDidChangeTenantSettingEmitter = new Emitter<string>();
    /** Fires the key of every tenant AI setting written through {@link setPreference}. */
    readonly onDidChangeTenantSetting: Event<string> = this.onDidChangeTenantSettingEmitter.event;

    protected readonly toDispose: { dispose(): void }[];

    constructor(
        protected readonly delegate: PreferenceProvider,
        protected readonly isTenant: () => boolean,
    ) {
        this.toDispose = [
            this.onDidPreferencesChangedEmitter,
            this.onDidChangeTenantSettingEmitter,
            delegate.onDidPreferencesChanged(changes => this.forwardDelegateChanges(changes)),
        ];
    }

    get ready(): Promise<void> {
        return this.delegate.ready;
    }

    canHandleScope(scope: PreferenceScope): boolean {
        return this.delegate.canHandleScope(scope);
    }

    get<T>(preferenceName: string, resourceUri?: string): T | undefined {
        return this.resolve<T>(preferenceName, resourceUri).value;
    }

    resolve<T>(preferenceName: string, resourceUri?: string): PreferenceResolveResult<T> {
        if (this.isTenantAiKey(preferenceName)) {
            if (this.overlay.has(preferenceName)) {
                return { value: this.overlay.get(preferenceName) as unknown as T };
            }
            if (isQaapIsolatedAiSettingsPrefKey(preferenceName)) {
                return {};
            }
        }
        return this.delegate.resolve<T>(preferenceName, resourceUri);
    }

    getPreferences(resourceUri?: string): JSONObject {
        const preferences = this.delegate.getPreferences(resourceUri);
        if (!this.isTenant()) {
            return preferences;
        }
        const result: JSONObject = {};
        for (const [key, value] of Object.entries(preferences)) {
            if (!isQaapIsolatedAiSettingsPrefKey(key)) {
                result[key] = value;
            }
        }
        for (const [key, value] of this.overlay) {
            result[key] = value;
        }
        return result;
    }

    async setPreference(key: string, value: JSONValue | undefined, resourceUri?: string): Promise<boolean> {
        if (!this.isTenantAiKey(key)) {
            return this.delegate.setPreference(key, value as JSONValue, resourceUri);
        }
        const oldValue = this.get<JSONValue>(key);
        if (value === undefined) {
            this.overlay.delete(key);
            this.resetKeys.add(key);
        } else {
            this.overlay.set(key, value);
            this.resetKeys.delete(key);
        }
        this.fireChange(key, oldValue);
        this.onDidChangeTenantSettingEmitter.fire(key);
        return true;
    }

    /** Loads the tenant's stored AI settings (hydration); fires change events without scheduling a push. */
    applyTenantSettings(settings: Readonly<Record<string, unknown>>): void {
        for (const [key, value] of Object.entries(settings)) {
            // eslint-disable-next-line no-null/no-null
            if (!isQaapAiSettingsPrefKey(key) || value === undefined || value === null || this.resetKeys.has(key) || this.overlay.has(key)) {
                continue; // Keep edits made before hydration finished.
            }
            const oldValue = this.get<JSONValue>(key);
            this.overlay.set(key, value as JSONValue);
            this.fireChange(key, oldValue);
        }
    }

    tenantSettings(): ReadonlyMap<string, JSONValue> {
        return this.overlay;
    }

    tenantResetKeys(): ReadonlySet<string> {
        return this.resetKeys;
    }

    getConfigUri(resourceUri?: string, sectionName?: string): URI | undefined {
        return this.delegate.getConfigUri?.(resourceUri, sectionName);
    }

    getContainingConfigUri(resourceUri?: string, sectionName?: string): URI | undefined {
        return this.delegate.getContainingConfigUri?.(resourceUri, sectionName);
    }

    dispose(): void {
        this.toDispose.forEach(disposable => disposable.dispose());
        this.delegate.dispose();
    }

    protected isTenantAiKey(preferenceName: string): boolean {
        return isQaapAiSettingsPrefKey(preferenceName) && this.isTenant();
    }

    /** Shared-file changes to keys the tenant overlays do not change what the tenant sees. */
    protected forwardDelegateChanges(changes: PreferenceProviderDataChanges): void {
        const forwarded: PreferenceProviderDataChanges = {};
        let any = false;
        for (const [key, change] of Object.entries(changes)) {
            if (this.isTenantAiKey(key) && (this.overlay.has(key) || isQaapIsolatedAiSettingsPrefKey(key))) {
                continue;
            }
            forwarded[key] = change;
            any = true;
        }
        if (any) {
            this.onDidPreferencesChangedEmitter.fire(forwarded);
        }
    }

    protected fireChange(preferenceName: string, oldValue: JSONValue | undefined): void {
        const newValue = this.get<JSONValue>(preferenceName);
        if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
            return;
        }
        this.onDidPreferencesChangedEmitter.fire({
            [preferenceName]: { preferenceName, oldValue, newValue, scope: PreferenceScope.User },
        });
    }
}

/**
 * Wraps the User-scope preference provider on activation. Upstream binds it as a named `PreferenceProvider`
 * (`whenTargetNamed(PreferenceScope.User)`), which cannot be rebound in isolation, so the activation hook is the seam.
 */
export function decorateQaapTenantAiUserPreferenceProvider(
    onActivation: interfaces.Container['onActivation'],
    isTenant: () => boolean = () => shouldInterceptSharedUserAiPrefWrites(readQaapAuthUser()?.login),
): void {
    onActivation<PreferenceProvider>(PreferenceProvider, (context, provider) => {
        const scope = context.currentRequest.target.getNamedTag()?.value;
        return scope === PreferenceScope.User && !(provider instanceof QaapTenantAiUserPreferenceProvider)
            ? new QaapTenantAiUserPreferenceProvider(provider, isTenant)
            : provider;
    });
}

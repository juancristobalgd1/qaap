// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { DeployedPlugin, PluginIdentifiers } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { HostedPluginLocalizationService } from '@theia/plugin-ext/lib/hosted/node/hosted-plugin-localization-service';

/**
 * Localizes each deployed plugin once per version and language instead of once per frontend connection.
 *
 * Upstream re-reads every plugin's `package.nls.json` and walks its whole `package.json` on each
 * `getDeployedPlugins` call: with 99 builtin plugins that was ~2.4 s of event-loop time per IDE page during
 * "Loading plugin contributions" on a 1-CPU tenant (staging, 24 Nov 2026). The memo is dropped whenever a plugin's
 * localizations are deployed or undeployed, which also covers a language pack changing the translations. Callers
 * receive a copy, as upstream's `localizePlugin` always returned a fresh object they may change.
 */
@injectable()
export class QaapHostedPluginLocalizationService extends HostedPluginLocalizationService {

    protected readonly localizedPlugins = new Map<string, Promise<DeployedPlugin>>();

    override async localizePlugin(plugin: DeployedPlugin): Promise<DeployedPlugin> {
        const key = this.localizedPluginKey(plugin);
        let localized = this.localizedPlugins.get(key);
        if (!localized) {
            localized = super.localizePlugin(plugin);
            this.localizedPlugins.set(key, localized);
            localized.catch(() => {
                if (this.localizedPlugins.get(key) === localized) {
                    this.localizedPlugins.delete(key);
                }
            });
        }
        return this.copyLocalizedPlugin(await localized, plugin);
    }

    override async deployLocalizations(plugin: DeployedPlugin): Promise<void> {
        this.localizedPlugins.clear();
        try {
            await super.deployLocalizations(plugin);
        } finally {
            // Translations deployed meanwhile must not be served from a memo started before they landed.
            this.localizedPlugins.clear();
        }
    }

    override undeployLocalizations(plugin: PluginIdentifiers.VersionedId): void {
        super.undeployLocalizations(plugin);
        this.localizedPlugins.clear();
    }

    /** Same plugin version and language: the same localized model. */
    protected localizedPluginKey(plugin: DeployedPlugin): string {
        const versionedId = PluginIdentifiers.componentsToVersionedId(plugin.metadata.model);
        return `${this.localizationProvider.getCurrentLanguage()}\0${versionedId}\0${plugin.metadata.model.packageUri}`;
    }

    /** A copy of the memoized result; a model `structuredClone` cannot copy is localized again instead. */
    protected async copyLocalizedPlugin(localized: DeployedPlugin, original: DeployedPlugin): Promise<DeployedPlugin> {
        try {
            return structuredClone(localized);
        } catch {
            return super.localizePlugin(original);
        }
    }
}

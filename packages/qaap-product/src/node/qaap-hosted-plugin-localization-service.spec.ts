// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { DeployedPlugin, PluginIdentifiers } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { QaapHostedPluginLocalizationService } from './qaap-hosted-plugin-localization-service';

interface CommandContribution {
    command: string;
    title: string;
}

/** A service whose localization provider counts how often upstream localized a plugin. */
function createService(language = 'en'): { service: QaapHostedPluginLocalizationService; localizations: () => number; setLanguage: (next: string) => void } {
    let loads = 0;
    let current = language;
    const service = new QaapHostedPluginLocalizationService();
    Object.assign(service, {
        localizationProvider: {
            getCurrentLanguage: () => current,
            loadLocalization: async (languageId: string) => {
                loads++;
                return { languageId, languageName: languageId, translations: {} };
            },
            addLocalizations: () => ({ dispose: () => undefined }),
        },
        logger: { error: () => undefined },
    });
    return { service, localizations: () => loads, setLanguage: next => { current = next; } };
}

function pluginIn(dir: string, version = '1.0.0'): DeployedPlugin {
    return {
        type: 0,
        metadata: {
            host: 'main',
            model: {
                id: 'vscode.git',
                name: 'git',
                publisher: 'vscode',
                version,
                displayName: '%displayName%',
                packageUri: FileUri.create(dir).toString(),
            },
        },
        contributes: {
            commands: [{ command: 'git.clone', title: '%command.clone%' }],
        },
    } as unknown as DeployedPlugin;
}

function commandTitle(plugin: DeployedPlugin): string | undefined {
    return (plugin.contributes?.commands as CommandContribution[] | undefined)?.[0]?.title;
}

describe('QaapHostedPluginLocalizationService', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-plugin-l10n-'));
        fs.writeFileSync(path.join(dir, 'package.nls.json'), JSON.stringify({ 'command.clone': 'Clone', displayName: 'Git' }));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('localizes a plugin once per version and language and hands every caller its own copy', async () => {
        const { service, localizations } = createService();
        const first = await service.localizePlugin(pluginIn(dir));
        const second = await service.localizePlugin(pluginIn(dir));
        expect(commandTitle(first)).to.equal('Clone');
        expect(commandTitle(second)).to.equal('Clone');
        expect(localizations()).to.equal(1);
        expect(second).to.not.equal(first);
        // A caller changing its copy does not reach the next one.
        (first.contributes!.commands as CommandContribution[])[0].title = 'changed';
        expect(commandTitle(await service.localizePlugin(pluginIn(dir)))).to.equal('Clone');
    });

    it('localizes again for another version or another language', async () => {
        const { service, localizations, setLanguage } = createService();
        await service.localizePlugin(pluginIn(dir));
        await service.localizePlugin(pluginIn(dir, '1.1.0'));
        expect(localizations()).to.equal(2);
        setLanguage('de');
        await service.localizePlugin(pluginIn(dir));
        expect(localizations()).to.equal(3);
    });

    it('forgets the memo when a plugin is redeployed or undeployed', async () => {
        const { service, localizations } = createService();
        await service.localizePlugin(pluginIn(dir));
        fs.writeFileSync(path.join(dir, 'package.nls.json'), JSON.stringify({ 'command.clone': 'Clone Repository' }));
        await service.deployLocalizations(pluginIn(dir));
        expect(commandTitle(await service.localizePlugin(pluginIn(dir)))).to.equal('Clone Repository');
        expect(localizations()).to.equal(2);

        service.undeployLocalizations('vscode.git@1.0.0' as PluginIdentifiers.VersionedId);
        await service.localizePlugin(pluginIn(dir));
        expect(localizations()).to.equal(3);
    });
});

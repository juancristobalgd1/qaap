// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { Container, ContainerModule } from '@theia/core/shared/inversify';
import { ContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { Deferred } from '@theia/core/lib/common/promise-util';
import { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import { ILogger } from '@theia/core/lib/common/logger';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { CliContribution } from '@theia/core/lib/node/cli';
import { LocalizationRegistry } from '@theia/core/lib/node/i18n/localization-contribution';
import { LocalizationProvider } from '@theia/core/lib/node/i18n/localization-provider';
import { LocalizationServerImpl } from '@theia/core/lib/node/i18n/localization-server';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { ExtPluginApiProvider } from '@theia/plugin-ext/lib/common/plugin-ext-api-contribution';
import { DeployedPlugin, HostedPluginClient, HostedPluginServer, PluginDeployer, PluginIdentifiers } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { HostedPluginSupport } from '@theia/plugin-ext/lib/hosted/node/hosted-plugin';
import { HostedPluginLocalizationService } from '@theia/plugin-ext/lib/hosted/node/hosted-plugin-localization-service';
import { PluginDeployerHandlerImpl } from '@theia/plugin-ext/lib/hosted/node/plugin-deployer-handler-impl';
import { BackendPluginHostableFilter, HostedPluginServerImpl } from '@theia/plugin-ext/lib/hosted/node/plugin-service';
import { PluginDeployerContribution } from '@theia/plugin-ext/lib/main/node/plugin-deployer-contribution';
import { PluginLocalizationServer } from '@theia/plugin-ext/lib/main/node/plugin-localization-server';
import { PluginUninstallationManager } from '@theia/plugin-ext/lib/main/node/plugin-uninstallation-manager';
import { QaapHostedPluginServer } from '../common/qaap-hosted-plugin-server';
import { bindQaapLazyPlugins } from './qaap-lazy-plugin-bindings';
import { QaapPluginDeploymentGate } from './qaap-plugin-deployment-gate';

const PLUGIN_ID = 'vscode.git@1.0.0' as PluginIdentifiers.VersionedId;

/** Lets pending promise chains (and a few timers) run. */
async function settle(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
}

/** Resolves `'pending'` when the promise has not settled after {@link settle}. */
async function stateOf(promise: Promise<unknown>): Promise<'settled' | 'pending'> {
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    await settle();
    return settled ? 'settled' : 'pending';
}

class FakePluginDeployer {
    starts = 0;
    /** When set, `start()` stays pending until the test resolves it (a deployment in progress). */
    pendingStart: Deferred<void> | undefined;
    protected readonly onDidDeployEmitter = new Emitter<void>();
    readonly onDidDeploy = this.onDidDeployEmitter.event;
    start(): Promise<void> {
        this.starts++;
        return this.pendingStart?.promise ?? Promise.resolve();
    }
    fireDidDeploy(): void {
        this.onDidDeployEmitter.fire();
    }
}

class FakeHostedPluginSupport {
    hostForks = 0;
    runPluginServer(): void {
        this.hostForks++;
    }
    clientClosed(): void { }
    setClient(): void { }
}

/** The plugin-ext bindings this fork replaces, as `plugin-ext-backend-module` / `plugin-ext-hosted-backend-module` declare them. */
function createBackend(): { container: Container, deployer: FakePluginDeployer } {
    const container = new Container();
    const deployer = new FakePluginDeployer();
    const logger = { error: () => undefined, debug: () => undefined, info: () => undefined, warn: () => undefined };
    container.bind(ILogger).toConstantValue(logger as unknown as ILogger);
    container.bind(PluginDeployer).toConstantValue(deployer as unknown as PluginDeployer);
    container.bind(PluginDeployerContribution).toSelf().inSingletonScope();
    container.bind(BackendApplicationContribution).toService(PluginDeployerContribution);
    container.bind(LocalizationRegistry).toConstantValue({ initialize: async () => undefined } as unknown as LocalizationRegistry);
    container.bind(LocalizationProvider).toConstantValue({} as LocalizationProvider);
    container.bind(LocalizationServerImpl).to(PluginLocalizationServer).inSingletonScope();
    const backendPlugin = { metadata: { model: { entryPoint: { backend: 'extension.js' } } } } as unknown as DeployedPlugin;
    container.bind(PluginDeployerHandlerImpl).toConstantValue({
        getDeployedBackendPlugins: async () => [backendPlugin],
        getDeployedBackendPluginIds: async () => [PLUGIN_ID],
        getDeployedFrontendPluginIds: async () => [],
    } as unknown as PluginDeployerHandlerImpl);
    container.bind(PluginUninstallationManager).toConstantValue({
        getUninstalledPluginIds: () => [],
        getDisabledPluginIds: async () => [],
        onDidChangeUninstalledPlugins: () => Disposable.NULL,
        onDidChangeDisabledPlugins: () => Disposable.NULL,
    } as unknown as PluginUninstallationManager);
    container.bind(HostedPluginLocalizationService).toConstantValue({} as HostedPluginLocalizationService);
    container.bind(ContributionProvider).toConstantValue({ getContributions: () => [] }).whenTargetNamed(Symbol.for(ExtPluginApiProvider));
    container.load(new ContainerModule((bind, _unbind, isBound, rebind) => bindQaapLazyPlugins(bind, isBound, rebind)));
    return { container, deployer };
}

/** A frontend connection's container, as Theia's messaging service creates one per connection. */
function connect(container: Container): { server: HostedPluginServer, hostedPlugin: FakeHostedPluginSupport } {
    const connection = container.createChild();
    const hostedPlugin = new FakeHostedPluginSupport();
    connection.bind(HostedPluginSupport).toConstantValue(hostedPlugin as unknown as HostedPluginSupport);
    connection.bind(HostedPluginServerImpl).toSelf().inSingletonScope();
    connection.bind(HostedPluginServer).toService(HostedPluginServerImpl);
    connection.bind(BackendPluginHostableFilter).toConstantValue(() => true);
    connection.load(...container.getAll<ContainerModule>(ConnectionContainerModule));
    return { server: connection.get<HostedPluginServer>(HostedPluginServer), hostedPlugin };
}

describe('Qaap lazy plugin deployment (tenant backend)', () => {

    it('does not deploy plugins when the backend initializes', async () => {
        const { container, deployer } = createBackend();
        for (const contribution of container.getAll<BackendApplicationContribution>(BackendApplicationContribution)) {
            await contribution.initialize?.();
        }
        await settle();
        expect(deployer.starts).to.equal(0);

        container.get(QaapPluginDeploymentGate).request();
        container.get(QaapPluginDeploymentGate).request();
        await settle();
        expect(deployer.starts).to.equal(1);
    });

    it('forks no plugin host for a client that lists plugins without asking for them (Work Hub page, phone)', async () => {
        const { container, deployer } = createBackend();
        for (const contribution of container.getAll<BackendApplicationContribution>(BackendApplicationContribution)) {
            await contribution.initialize?.();
        }
        const workHub = connect(container);
        const listing = workHub.server.getDeployedPluginIds();
        expect(await stateOf(listing)).to.equal('pending');
        expect(workHub.hostedPlugin.hostForks).to.equal(0);
        expect(deployer.starts).to.equal(0);

        // Another page opens the IDE: plugins deploy, but this connection still gets no host.
        const ide = connect(container);
        await QaapHostedPluginServer.requestPlugins(ide.server);
        expect(await ide.server.getDeployedPluginIds()).to.deep.equal([PLUGIN_ID]);
        expect(ide.hostedPlugin.hostForks).to.equal(1);
        expect(deployer.starts).to.equal(1);
        expect(await stateOf(listing)).to.equal('pending');
        expect(workHub.hostedPlugin.hostForks).to.equal(0);
    });

    it('lists plugins and forks the host once the page asks for them (IDE page)', async () => {
        const { container } = createBackend();
        const ide = connect(container);
        const listing = ide.server.getDeployedPluginIds();
        await QaapHostedPluginServer.requestPlugins(ide.server);
        expect(await listing).to.deep.equal([PLUGIN_ID]);
        expect(ide.hostedPlugin.hostForks).to.equal(1);
    });

    it('does not make the requesting IDE page load plugins again when the lazy deployment completes', async () => {
        const { container, deployer } = createBackend();
        deployer.pendingStart = new Deferred<void>();
        for (const contribution of container.getAll<BackendApplicationContribution>(BackendApplicationContribution)) {
            await contribution.initialize?.();
        }
        const ide = connect(container);
        let reloads = 0;
        ide.server.setClient({ postMessage: async () => undefined, log: () => undefined, onDidDeploy: () => reloads++ } as HostedPluginClient);
        await settle();

        await QaapHostedPluginServer.requestPlugins(ide.server);
        await settle();
        expect(deployer.starts).to.equal(1);
        // The deployment's own completion event: the page's first listing already waited for it.
        deployer.fireDidDeploy();
        deployer.pendingStart.resolve();
        await settle();
        expect(reloads).to.equal(0);

        // A later install or uninstall still makes the page sync.
        deployer.fireDidDeploy();
        expect(reloads).to.equal(1);
    });

    it('forwards every deploy event during the initial deployment after the first', async () => {
        const { container, deployer } = createBackend();
        deployer.pendingStart = new Deferred<void>();
        for (const contribution of container.getAll<BackendApplicationContribution>(BackendApplicationContribution)) {
            await contribution.initialize?.();
        }
        const ide = connect(container);
        let reloads = 0;
        ide.server.setClient({ postMessage: async () => undefined, log: () => undefined, onDidDeploy: () => reloads++ } as HostedPluginClient);
        await settle();
        await QaapHostedPluginServer.requestPlugins(ide.server);
        await settle();

        // E.g. a plugin install racing the initial deployment: one of the two events still reaches the page.
        deployer.fireDidDeploy();
        deployer.fireDidDeploy();
        expect(reloads).to.equal(1);
    });

    it('answers localization requests without waiting for a deployment nobody requested', async () => {
        const { container, deployer } = createBackend();
        const localization = container.get(LocalizationServerImpl);
        await localization.initialize();
        expect(await stateOf(localization.waitForInitialization())).to.equal('settled');

        container.get(QaapPluginDeploymentGate).request();
        const afterRequest = localization.waitForInitialization();
        expect(await stateOf(afterRequest)).to.equal('pending');
        deployer.fireDidDeploy();
        expect(await stateOf(afterRequest)).to.equal('settled');
    });

    it('deploys for the list-plugins CLI command only', async () => {
        const { container } = createBackend();
        const gate = container.get(QaapPluginDeploymentGate);
        const cli = container.getAll<CliContribution>(CliContribution);
        for (const contribution of cli) {
            await contribution.setArguments({ _: [], $0: 'theia' });
        }
        expect(gate.requested).to.equal(false);
        for (const contribution of cli) {
            await contribution.setArguments({ _: ['list-plugins'], $0: 'theia' });
        }
        expect(gate.requested).to.equal(true);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Container, ContainerModule } from '@theia/core/shared/inversify';
import { ApplicationShellLayoutMigration, ShellLayoutRestorer, ShellLayoutTransformer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { QaapPluginHostFrontend } from './qaap-phone-debug-service';
import { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { ILogger } from '@theia/core/lib/common/logger';
import { ContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { QaapPhoneShellLayoutRestorer } from './qaap-phone-shell-layout-restorer';

disableJSDOM();

describe('QaapPhoneShellLayoutRestorer', () => {

    function create(storageCalls: string[]): QaapPhoneShellLayoutRestorer {
        const storage = {
            setData: async (key: string) => { storageCalls.push(`set:${key}`); },
            getData: async (key: string) => {
                storageCalls.push(`get:${key}`);
                return '{"version":"6.0"}';
            },
        } as unknown as StorageService;
        const logger = { info: () => undefined, warn: () => undefined, error: () => undefined } as unknown as ILogger;
        return new QaapPhoneShellLayoutRestorer({} as WidgetManager, logger, storage);
    }

    /** Fails the test if the restorer touches the shell. */
    const app = {
        get shell(): never {
            throw new Error('the phone entry must not read or write the shell layout');
        }
    } as unknown as FrontendApplication;

    it('never stores the Work Hub-only shell layout that the desktop entry would restore after widening', () => {
        const calls: string[] = [];
        create(calls).storeLayout(app);
        expect(calls).to.deep.equal([]);
    });

    it('never restores a stored layout, so the default layout is built', async () => {
        const calls: string[] = [];
        expect(await create(calls).restoreLayout(app)).to.equal(false);
        expect(calls).to.deep.equal([]);
    });

    describe('rebindOnPhoneEntry', () => {

        async function boundRestorer(desktopEntry: boolean): Promise<{ service: ShellLayoutRestorer; upstream: ShellLayoutRestorer }> {
            const container = new Container();
            const upstream = {} as ShellLayoutRestorer;
            container.bind(ShellLayoutRestorer).toConstantValue(upstream);
            container.bind(WidgetManager).toConstantValue({} as WidgetManager);
            container.bind(ILogger).toConstantValue({} as ILogger);
            container.bind(StorageService).toConstantValue({} as StorageService);
            const contributions = { getContributions: () => [] };
            container.bind(ContributionProvider).toConstantValue(contributions).whenTargetNamed(ApplicationShellLayoutMigration);
            container.bind(ContributionProvider).toConstantValue(contributions).whenTargetNamed(ShellLayoutTransformer);
            container.bind(ThemeService).toConstantValue({} as ThemeService);
            container.bind(WindowService).toConstantValue({} as WindowService);
            if (desktopEntry) {
                container.bind(QaapPluginHostFrontend).toConstantValue(true);
            }
            container.load(new ContainerModule((bind, _unbind, isBound, rebind) => {
                QaapPhoneShellLayoutRestorer.rebindOnPhoneEntry(bind, isBound, rebind);
            }));
            return { service: await container.getAsync(ShellLayoutRestorer), upstream };
        }

        it('keeps the upstream restorer on the desktop entry', async () => {
            const { service, upstream } = await boundRestorer(true);
            expect(service).to.equal(upstream);
        });

        it('resolves the phone restorer through the shell layout service on the phone entry', async () => {
            const { service, upstream } = await boundRestorer(false);
            expect(service).to.be.instanceOf(QaapPhoneShellLayoutRestorer);
            expect(service).not.to.equal(upstream);
        });
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';

const disableImportJSDOM = enableJSDOM();

import { expect } from 'chai';
import { Container } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { PreloadContribution } from '@theia/core/lib/browser/preload/preloader';
import { ContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { QaapMobileBootBudget } from './qaap-mobile-boot-budget';
import { QaapPreloader } from './qaap-preloader';
import { QaapFrontendApplication } from './qaap-frontend-application';

disableImportJSDOM();

const BOOT_CLASS = 'theia-mobile-workhub-boot';

class FastBudget extends QaapMobileBootBudget {
    override readonly hookBudgetMs: number = 20;
}

const never = (): Promise<void> => new Promise<void>(() => undefined);
const delay = (ms: number): Promise<void> => new Promise<void>(resolve => setTimeout(resolve, ms));

describe('QaapMobileBootBudget', () => {
    let disableSuiteJSDOM: () => void;
    before(() => { disableSuiteJSDOM = enableJSDOM(); });
    after(() => disableSuiteJSDOM());

    /** A phone booting the mobile entry into the Work Hub (what the login gate sets up). */
    function emulateMobileWorkHubBoot(): void {
        Object.defineProperty(window, 'matchMedia', {
            configurable: true,
            writable: true,
            value: (query: string) => ({ matches: true, media: query }),
        });
        (window as { __qaapEntry?: string }).__qaapEntry = 'mobile';
        document.documentElement.classList.add(BOOT_CLASS);
    }

    afterEach(() => {
        delete (window as { matchMedia?: unknown }).matchMedia;
        delete (window as { __qaapEntry?: string }).__qaapEntry;
        document.documentElement.classList.remove(BOOT_CLASS);
        window.sessionStorage.clear();
    });

    describe('applies', () => {
        it('applies to a phone booting the mobile entry into the Work Hub', () => {
            emulateMobileWorkHubBoot();
            expect(new QaapMobileBootBudget().applies()).to.equal(true);
        });

        it('does not apply to the full entry (desktop bundle)', () => {
            emulateMobileWorkHubBoot();
            (window as { __qaapEntry?: string }).__qaapEntry = 'full';
            expect(new QaapMobileBootBudget().applies()).to.equal(false);
        });

        it('does not apply without the Work Hub boot guard (IDE surface)', () => {
            emulateMobileWorkHubBoot();
            document.documentElement.classList.remove(BOOT_CLASS);
            expect(new QaapMobileBootBudget().applies()).to.equal(false);
        });

        it('honors the wait-for-backend diagnostics switch', () => {
            emulateMobileWorkHubBoot();
            window.sessionStorage.setItem('qaap.boot.waitForBackend', '1');
            expect(new QaapMobileBootBudget().applies()).to.equal(false);
        });
    });

    describe('settleWithinBudget', () => {
        it('returns the value of a hook that settles in time', async () => {
            const budget = new FastBudget();
            expect(await budget.settleWithinBudget('fast', async () => 'done')).to.equal('done');
            expect(await budget.settleWithinBudget('sync', () => 'sync')).to.equal('sync');
            expect(budget.getDetachedHooks()).to.deep.equal([]);
        });

        it('stops waiting for a hook past the budget and records it', async () => {
            const budget = new FastBudget();
            expect(await budget.settleWithinBudget('Slow.onStart', never)).to.equal(undefined);
            expect(budget.getDetachedHooks()).to.deep.equal(['Slow.onStart']);
        });

        it('still rejects when a hook fails within the budget', async () => {
            const budget = new FastBudget();
            let caught: unknown;
            await budget.settleWithinBudget('Broken.configure', () => Promise.reject(new Error('boom'))).catch(error => { caught = error; });
            expect((caught as Error).message).to.equal('boom');
        });
    });

    describe('QaapPreloader', () => {
        function createPreloader(contributions: PreloadContribution[]): QaapPreloader {
            const container = new Container();
            container.bind(QaapMobileBootBudget).to(FastBudget).inSingletonScope();
            container.bind(QaapPreloader).toSelf().inSingletonScope();
            container.bind(ContributionProvider).toConstantValue({ getContributions: () => contributions })
                .whenTargetNamed(PreloadContribution as unknown as string);
            return container.get(QaapPreloader);
        }

        it('does not wait for a backend-bound preload on a mobile Work Hub boot', async () => {
            emulateMobileWorkHubBoot();
            let localDone = false;
            const preloader = createPreloader([
                { initialize: never },
                { initialize: () => { localDone = true; } },
            ]);
            await preloader.initialize();
            expect(localDone).to.equal(true);
        });

        it('keeps waiting for every preload elsewhere', async () => {
            let finished = false;
            const preloader = createPreloader([{ initialize: () => delay(60).then(() => { finished = true; }) }]);
            await preloader.initialize();
            expect(finished).to.equal(true);
        });
    });

    describe('QaapFrontendApplication', () => {
        /** The contribution loop without the rest of FrontendApplication's startup. */
        function createApplication(contributions: FrontendApplicationContribution[]): QaapFrontendApplication {
            const application = Object.create(QaapFrontendApplication.prototype) as QaapFrontendApplication;
            Object.assign(application, {
                bootBudget: new FastBudget(),
                budgetedStartup: false,
                stateService: { state: 'init' },
                contributions: { getContributions: () => contributions },
                commands: { onStart: () => undefined },
                keybindings: { onStart: () => undefined },
                menus: { onStart: () => undefined },
                stopwatch: { startAsync: (_name: string, _message: string, fn: () => unknown) => fn() },
                logger: { error: () => undefined },
            });
            return application;
        }

        function startContributions(application: QaapFrontendApplication): Promise<void> {
            return (application as unknown as { startContributions(): Promise<void> }).startContributions();
        }

        it('moves past a contribution hook stalled on the backend during a mobile Work Hub boot', async () => {
            emulateMobileWorkHubBoot();
            const started: string[] = [];
            const application = createApplication([
                { configure: never },
                { onStart: () => { started.push('work-hub'); } },
            ]);
            await startContributions(application);
            expect(started).to.deep.equal(['work-hub']);
        });

        it('keeps upstream ordering when the budget does not apply', async () => {
            const order: string[] = [];
            const application = createApplication([
                { configure: () => delay(60).then(() => { order.push('slow'); }) },
                { onStart: () => { order.push('next'); } },
            ]);
            await startContributions(application);
            expect(order).to.deep.equal(['slow', 'next']);
        });
    });
});

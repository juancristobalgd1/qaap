// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * The `bundle-mobile` entry must boot on its own. Computes exactly the module list the generator
 * writes to `src-gen/frontend/index-mobile.js` (the browser example's collected extensions filtered
 * by `qaapMobile` of `@theia/qaap-product`), loads it into a fresh container in the generated order
 * (messaging, preload modules, application + logger modules, frontend modules) and resolves the
 * application, every `FrontendApplicationContribution` and the Work Hub roots. A module that
 * rebinds an identifier no mobile module binds, or a missing binding, fails here instead of in
 * the browser.
 *
 * Run in its own process by `qaap-mobile-entry-container.spec.ts`: the resolved services start
 * timers and sockets that must not leak into other spec files' jsdom.
 */

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
let disableJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
FrontendApplicationConfigProvider.set({ applicationName: 'Qaap' });

import { expect } from 'chai';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
const appRoot = path.join(repoRoot, 'examples', 'browser');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeModule = require('module') as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const originalResolveFilename = NodeModule._resolveFilename;
const cssStub = path.join(repoRoot, 'packages', 'core', 'src', 'browser', 'style', 'index.css');

/** Deep `src/` imports exist only for esbuild; stylesheets are ignored like every `.css`. */
function installResolveHook(): void {
    NodeModule._resolveFilename = (request: string, ...rest: unknown[]): string => {
        try {
            const mapped = /^@theia\/[^/]+\/src\//.test(request) && !/\.css(\?.*)?$/.test(request) ? request.replace('/src/', '/lib/') : request;
            return originalResolveFilename(mapped, ...rest);
        } catch (error) {
            if (/\.css(\?.*)?$/.test(request)) {
                return cssStub;
            }
            throw error;
        }
    };
}

/** Browser APIs jsdom lacks and the mobile modules touch while being constructed. */
function installBrowserStubs(): void {
    const target = window as unknown as Record<string, unknown>;
    const globalTarget = global as unknown as Record<string, unknown>;
    /** Services open sockets/streams when constructed; nothing listens in a unit test. */
    class InertSocket {
        readyState = 3;
        close(): void { }
        send(): void { }
        addEventListener(): void { }
        removeEventListener(): void { }
    }
    const stubs: Record<string, unknown> = {
        WebSocket: InertSocket,
        EventSource: InertSocket,
        requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
        cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
        CSS: { escape: (value: string) => String(value), supports: () => false },
        matchMedia: (query: string) => ({
            // Mobile entry: one-column layout.
            matches: /max-width|coarse/.test(query), media: query,
            addEventListener: () => undefined, removeEventListener: () => undefined,
            addListener: () => undefined, removeListener: () => undefined,
        }),
    };
    for (const [name, value] of Object.entries(stubs)) {
        target[name] = value;
        globalTarget[name] = value;
    }
    // Monaco keeps the window it saw first (`mainWindow`), possibly another spec file's jsdom.
    for (const [file, cached] of Object.entries(require.cache)) {
        const mainWindow = /vs[\\/]base[\\/]browser[\\/]window\.js$/.test(file) ? cached?.exports?.mainWindow : undefined;
        if (mainWindow && typeof mainWindow.matchMedia !== 'function') {
            mainWindow.matchMedia = stubs.matchMedia;
        }
    }
}

interface MobileModuleLists {
    readonly preload: string[];
    readonly frontend: string[];
}

/** Same computation as `FrontendGenerator.generateMobileIndex` for the browser example. */
function mobileModuleLists(): MobileModuleLists {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-dynamic-require
    const { ApplicationPackage } = require(path.join(repoRoot, 'dev-packages', 'application-package', 'lib', 'application-package'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-dynamic-require
    const { FrontendGenerator } = require(path.join(repoRoot, 'dev-packages', 'application-manager', 'lib', 'generator', 'frontend-generator'));
    const pck = new ApplicationPackage({ projectPath: appRoot, log: () => undefined, error: () => undefined });
    const generator = new FrontendGenerator(pck, { mode: 'development' });
    const config = generator.getQaapMobileConfig();
    expect(config, 'qaapMobile config of @theia/qaap-product').to.not.equal(undefined);
    const frontend: Map<string, string> = generator.addMobileOnlyModules(generator.filterMobileModules(pck.targetFrontendModules, config), config);
    const preload: Map<string, string> = generator.filterMobileModules(pck.targetFrontendPreloadModules, config);
    return { preload: [...preload.values()], frontend: [...frontend.values()] };
}

// `@theia/terminal` is not listed: the Work Hub terminal surface uses it on mobile too.
const IDE_PACKAGES = /^@theia\/(plugin-ext|plugin-ext-vscode|debug|notebook|vsx-registry|task|terminal-manager|ai-terminal|ai-ide|getting-started|keymaps|memory-inspector|plugin-dev)\//;

describe('bundle-mobile entry container', function (): void {
    this.timeout(180_000);

    let lists: MobileModuleLists;

    before(() => {
        disableJSDOM();
        disableJSDOM = enableJSDOM();
        // The provider keeps the configuration on the (new) jsdom window.
        FrontendApplicationConfigProvider.set({ applicationName: 'Qaap' });
        installBrowserStubs();
        installResolveHook();
        lists = mobileModuleLists();
    });

    after(() => {
        NodeModule._resolveFilename = originalResolveFilename;
        // jsdom stays up: this file runs in its own process (mocha `exit: true`), and timers the resolved
        // Work Hub services started (stream update schedulers, ...) may still fire into `document`.
    });

    it('loads no IDE package module and none of the IDE-only halves', () => {
        expect(lists.frontend.filter(modulePath => IDE_PACKAGES.test(modulePath))).to.deep.equal([]);
        expect(lists.frontend.filter(modulePath => /-ide-frontend-module$/.test(modulePath))).to.deep.equal([]);
        expect(lists.frontend).to.include('@theia/qaap-work-hub/lib/browser/qaap-work-hub-mobile-frontend-module');
        expect(lists.frontend).to.include('@theia/terminal/lib/browser/terminal-frontend-module');
    });

    it('loads every module and resolves the application, all contributions and the Work Hub roots', async () => {
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { Container } = require('@theia/core/shared/inversify');
        const { messagingFrontendModule } = require('@theia/core/lib/browser/messaging/messaging-frontend-module');
        const { frontendApplicationModule } = require('@theia/core/lib/browser/frontend-application-module');
        const { loggerFrontendModule } = require('@theia/core/lib/browser/logger-frontend-module');
        const { FrontendApplication } = require('@theia/core/lib/browser/frontend-application');
        const { FrontendApplicationContribution } = require('@theia/core/lib/browser/frontend-application-contribution');
        /* eslint-enable @typescript-eslint/no-require-imports */

        const container = new Container();
        container.load(messagingFrontendModule);
        // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-dynamic-require
        const loadModule = (modulePath: string): void => container.load(require(require.resolve(modulePath, { paths: [appRoot] })).default);
        for (const modulePath of lists.preload) {
            loadModule(modulePath);
        }
        container.load(frontendApplicationModule);
        container.load(loggerFrontendModule);
        for (const modulePath of lists.frontend) {
            try {
                loadModule(modulePath);
            } catch (error) {
                throw new Error(`${modulePath}: ${error instanceof Error ? error.message : error}`);
            }
        }

        // Required only now: importing them first changes the module evaluation order the entry uses.
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { ChatViewWidget } = require('@theia/ai-chat-ui/lib/browser/chat-view-widget');
        const { MobileOneColumnShellContribution } = require('@theia/qaap-work-hub/lib/browser/mobile-one-column-shell-contribution');
        const { QaapProjectBootstrapService } = require('@theia/qaap-shared-core/lib/browser/qaap-project-bootstrap-service');
        /* eslint-enable @typescript-eslint/no-require-imports */

        expect(await container.getAsync(FrontendApplication)).to.not.equal(undefined);
        const contributions: unknown[] = await container.getAllAsync(FrontendApplicationContribution);
        expect(contributions.length).to.be.greaterThan(20);
        expect(contributions).to.include(await container.getAsync(MobileOneColumnShellContribution));
        expect(await container.getAsync(ChatViewWidget)).to.not.equal(undefined);
        // Contribution points the Work Hub collects lazily (after start): every binding must resolve.
        /* eslint-disable @typescript-eslint/no-require-imports */
        const contributionPoints: Array<[string, unknown]> = [
            ['CommandContribution', require('@theia/core/lib/common/command').CommandContribution],
            ['MenuContribution', require('@theia/core/lib/common/menu').MenuContribution],
            ['KeybindingContribution', require('@theia/core/lib/browser/keybinding').KeybindingContribution],
            ['ColorContribution', require('@theia/core/lib/browser/color-application-contribution').ColorContribution],
            ['OpenHandler', require('@theia/core/lib/browser/opener-service').OpenHandler],
            ['WidgetFactory', require('@theia/core/lib/browser/widget-manager').WidgetFactory],
            ['AIVariableContribution', require('@theia/ai-core/lib/common/variable-service').AIVariableContribution],
            ['ToolProvider', require('@theia/ai-core/lib/common/tool-invocation-registry').ToolProvider],
            ['ChatAgent', require('@theia/ai-chat/lib/common/chat-agents').ChatAgent],
        ];
        /* eslint-enable @typescript-eslint/no-require-imports */
        const unresolved: string[] = [];
        for (const [name, identifier] of contributionPoints) {
            if (!container.isBound(identifier)) {
                continue;
            }
            try {
                await container.getAllAsync(identifier);
            } catch (error) {
                unresolved.push(`${name}: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`);
            }
        }
        expect(unresolved).to.deep.equal([]);

        // The Work Hub terminal surface: the bridge aliases resolve the upstream terminal services, and
        // the Qaap terminal contribution and theme replace the upstream ones.
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { TerminalService } = require('@theia/terminal/lib/browser/base/terminal-service');
        const { TerminalWatcher } = require('@theia/terminal/lib/common/terminal-watcher');
        const { TerminalFrontendContribution } = require('@theia/terminal/lib/browser/terminal-frontend-contribution');
        const { TerminalThemeService } = require('@theia/terminal/lib/browser/terminal-theme-service');
        const { QaapIdeTerminalService, QaapIdeTerminalWatcher, QaapIdeDesktopTerminalLayout } = require('@theia/qaap-shared-core/lib/browser/qaap-ide-bridge');
        /* eslint-enable @typescript-eslint/no-require-imports */
        expect(await container.getAsync(QaapIdeTerminalService)).to.equal(await container.getAsync(TerminalService));
        expect(await container.getAsync(QaapIdeTerminalWatcher)).to.equal(await container.getAsync(TerminalWatcher));
        expect((await container.getAsync(TerminalFrontendContribution)).constructor.name).to.equal('QaapTerminalFrontendContribution');
        expect((await container.getAsync(TerminalThemeService)).constructor.name).to.equal('QaapTerminalThemeService');
        // The desktop bottom-panel terminal layout is IDE UI: not bound in this entry.
        expect(container.isBound(QaapIdeDesktopTerminalLayout)).to.equal(false);

        const bootstrap = await container.getAsync(QaapProjectBootstrapService);
        // The project bootstrap runs on the headless runner (live output without attaching a widget to
        // the IDE shell), even though the terminal service is bound.
        expect(bootstrap.terminalService.constructor.name).to.equal('QaapHeadlessTerminalService');
    });
});

// *****************************************************************************
// Copyright (C) 2026 Qaap and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { FrontendGenerator, QaapMobileConfig } from './frontend-generator';

const DESKTOP_FRONTEND = [
    '@theia/core/lib/browser/i18n/i18n-frontend-module',
    '@theia/editor/lib/browser/editor-frontend-module',
    '@theia/monaco/lib/browser/monaco-frontend-module',
    '@theia/ai-core/lib/browser/ai-core-frontend-module',
    '@theia/ai-chat/lib/browser/ai-chat-frontend-module',
    '@theia/terminal/lib/browser/terminal-frontend-module',
    '@theia/qaap-shared-core/lib/browser/qaap-shared-core-frontend-module',
    '@theia/plugin-ext/lib/plugin-ext-frontend-module',
    '@theia/qaap-work-hub/lib/browser/qaap-work-hub-frontend-module',
    '@theia/debug/lib/browser/debug-frontend-module',
    '@theia/qaap-product/lib/browser/qaap-product-frontend-module'
];
const DESKTOP_PRELOAD = [
    '@theia/core/lib/browser/preload/preload-module',
    '@theia/plugin-ext/lib/main/browser/plugin-ext-preload-module',
    '@theia/qaap-product/lib/browser/preload/qaap-product-preload-module'
];
const MOBILE_CONFIG: QaapMobileConfig = {
    frontendModules: ['@theia/core', '@theia/ai-core', '@theia/ai-chat', '@theia/qaap-shared-core', '@theia/qaap-work-hub', '@theia/qaap-product'],
    exclude: []
};

function toMap(prefix: string, paths: string[]): Map<string, string> {
    return new Map(paths.map((modulePath, index) => [`${prefix}_${index + 1}`, modulePath]));
}

class TestFrontendGenerator extends FrontendGenerator {
    mobileConfig(): QaapMobileConfig | undefined {
        return this.getQaapMobileConfig();
    }
    filter(modules: Map<string, string>, config: QaapMobileConfig): Map<string, string> {
        return this.filterMobileModules(modules, config);
    }
    mobileIndex(config: QaapMobileConfig): string {
        return this.compileMobileIndexJs(
            this.filterMobileModules(toMap('frontend', DESKTOP_FRONTEND), config),
            this.filterMobileModules(toMap('frontendPreload', DESKTOP_PRELOAD), config)
        );
    }
    desktopIndex(): string {
        return this.compileIndexJs(toMap('frontend', DESKTOP_FRONTEND), toMap('frontendPreload', DESKTOP_PRELOAD));
    }
    generateMobile(): Promise<void> {
        return this.generateMobileIndex();
    }
}

function createGenerator(extensionPackages: unknown[] = [], overrides: Record<string, unknown> = {}): TestFrontendGenerator {
    const pck = {
        extensionPackages,
        props: { frontend: { config: { applicationName: 'Qaap' } } },
        isBrowser: () => true,
        isBrowserOnly: () => false,
        ifBrowserOnly: (_value: string, defaultValue: string) => defaultValue,
        targetFrontendModules: toMap('frontend', DESKTOP_FRONTEND),
        targetFrontendPreloadModules: toMap('frontendPreload', DESKTOP_PRELOAD),
        ...overrides
    };
    return new TestFrontendGenerator(pck as never, { mode: 'development' });
}

/** Module specifiers loaded by the generated entry, in source order. */
function loadedModules(source: string): string[] {
    return [...source.matchAll(/(?:import|require)\('(@theia\/[^']+)'\)/g)].map(match => match[1]);
}

describe('FrontendGenerator mobile entry', () => {

    it('keeps the desktop order, filtered by the allowlist', () => {
        const filtered = [...createGenerator().filter(toMap('frontend', DESKTOP_FRONTEND), MOBILE_CONFIG).values()];
        expect(filtered).to.deep.equal(DESKTOP_FRONTEND.filter(modulePath => MOBILE_CONFIG.frontendModules.some(name => modulePath.startsWith(name + '/'))));
        const positions = filtered.map(modulePath => DESKTOP_FRONTEND.indexOf(modulePath));
        expect(positions).to.deep.equal([...positions].sort((a, b) => a - b));
    });

    it('does not mistake a package whose name starts with an allowlisted name for it', () => {
        const modules = new Map([['frontend_1', '@theia/ai-core-ui/lib/browser/x'], ['frontend_2', '@theia/ai-core/lib/browser/y']]);
        expect([...createGenerator().filter(modules, MOBILE_CONFIG).values()]).to.deep.equal(['@theia/ai-core/lib/browser/y']);
    });

    it('lets exclude win over the allowlist', () => {
        const config = { ...MOBILE_CONFIG, exclude: ['@theia/qaap-shared-core'] };
        const filtered = [...createGenerator().filter(toMap('frontend', DESKTOP_FRONTEND), config).values()];
        expect(filtered).to.not.include('@theia/qaap-shared-core/lib/browser/qaap-shared-core-frontend-module');
        expect(filtered).to.include('@theia/qaap-work-hub/lib/browser/qaap-work-hub-frontend-module');
    });

    it('excludes a single module path (the IDE-only half of a split module) but keeps its siblings', () => {
        const modules = new Map([
            ['frontend_1', '@theia/qaap-work-hub/lib/browser/qaap-work-hub-frontend-module'],
            ['frontend_2', '@theia/qaap-work-hub/lib/browser/qaap-work-hub-ide-frontend-module'],
        ]);
        const config = { ...MOBILE_CONFIG, exclude: ['@theia/qaap-work-hub/lib/browser/qaap-work-hub-ide-frontend-module'] };
        expect([...createGenerator().filter(modules, config).values()]).to.deep.equal(['@theia/qaap-work-hub/lib/browser/qaap-work-hub-frontend-module']);
    });

    describe('index-mobile.js', () => {
        const source = createGenerator([{ name: '@theia/monaco', raw: {} }]).mobileIndex(MOBILE_CONFIG);

        it('has no Monaco bootstrap, no plugin host and no terminal', () => {
            expect(source).to.not.contain('MonacoInit');
            expect(source).to.not.contain('MonacoEnvironment');
            expect(source).to.not.contain('plugin-ext');
            expect(source).to.not.contain('terminal');
            expect(source).to.not.contain('@theia/monaco');
            expect(source).to.not.contain('@theia/debug');
        });

        it('sets window.__qaapEntry before anything else runs', () => {
            const lines = source.split('\n');
            expect(lines[1]).to.equal('window.__qaapEntry = \'mobile\';');
            expect(source.indexOf('__qaapEntry')).to.be.lessThan(source.indexOf('require(\'reflect-metadata\')'));
        });

        it('loads the allowlisted modules in desktop order', () => {
            const loaded = loadedModules(source);
            const expected = [...DESKTOP_PRELOAD, ...DESKTOP_FRONTEND].filter(modulePath => MOBILE_CONFIG.frontendModules.some(name => modulePath.startsWith(name + '/')));
            const positions = expected.map(modulePath => loaded.indexOf(modulePath));
            expect(positions.every(position => position >= 0), `${expected} in ${loaded}`).to.be.true;
            const frontendOnly = loaded.filter(modulePath => DESKTOP_FRONTEND.includes(modulePath));
            expect(frontendOnly).to.deep.equal(DESKTOP_FRONTEND.filter(modulePath => frontendOnly.includes(modulePath)));
        });

        it('shares the config bootstrap with the desktop entry', () => {
            const desktop = createGenerator([{ name: '@theia/monaco', raw: {} }]).desktopIndex();
            expect(desktop).to.contain('MonacoInit');
            for (const snippet of ['applyApplicationNameFromMeta(__theiaFrontendConfig);', 'FrontendApplicationConfigProvider.set(__theiaFrontendConfig);']) {
                expect(desktop).to.contain(snippet);
                expect(source).to.contain(snippet);
            }
        });
    });

    describe('qaapMobile configuration', () => {
        it('is read from the collected extension packages like theiaExtensions', () => {
            const generator = createGenerator([
                { name: '@theia/core', raw: { theiaExtensions: [] } },
                { name: '@theia/qaap-product', raw: { qaapMobile: { frontendModules: ['@theia/core'] } } }
            ]);
            expect(generator.mobileConfig()).to.deep.equal({ frontendModules: ['@theia/core'], exclude: [] });
        });

        it('is undefined when no extension package declares it', () => {
            expect(createGenerator([{ name: '@theia/core', raw: {} }]).mobileConfig()).to.equal(undefined);
        });
    });

    describe('generate', () => {
        let dir: string;
        beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qaap-mobile-gen-')); });
        afterEach(async () => { await fs.remove(dir); });

        const extensions = [{ name: '@theia/qaap-product', raw: { qaapMobile: MOBILE_CONFIG } }];

        it('writes src-gen/frontend/index-mobile.js for browser targets', async () => {
            await createGenerator(extensions, { frontend: (file: string) => path.join(dir, file) }).generateMobile();
            const written = await fs.readFile(path.join(dir, 'index-mobile.js'), 'utf8');
            expect(written).to.contain('window.__qaapEntry');
        });

        it('writes nothing, and removes a stale file, without configuration or on other targets', async () => {
            const target = path.join(dir, 'index-mobile.js');
            await fs.writeFile(target, 'stale');
            await createGenerator([], { frontend: (file: string) => path.join(dir, file) }).generateMobile();
            expect(await fs.pathExists(target)).to.be.false;
            await createGenerator(extensions, { isBrowser: () => false, frontend: (file: string) => path.join(dir, file) }).generateMobile();
            expect(await fs.pathExists(target)).to.be.false;
        });
    });
});

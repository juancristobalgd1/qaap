// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import { QaapMobileFrontendEntry } from '../common/qaap-mobile-frontend-entry';

const PACKAGES_DIR = path.resolve(__dirname, '../../..');
const EXAMPLES_DIR = path.resolve(PACKAGES_DIR, '../examples');

/**
 * Kept-package files that only desktop-only (excluded) modules import, so they may use excluded
 * packages: plugin-ext and vsx-registry bindings of `qaap-product-plugin-frontend-module` and
 * `qaap-work-hub-vsx-frontend-module`; `plugin-ext-headless` has no frontend.
 */
const DESKTOP_ONLY_FILES = [
    'plugin-ext-headless/',
    'qaap-product/src/browser/qaap-hosted-plugin-support.ts',
    'qaap-product/src/browser/qaap-plugin-view-welcome-policy.ts',
    'qaap-shared-core/src/browser/qaap-vsx-extensions-mobile-contribution.ts',
];

interface SourceFile {
    relative: string;
    source: string;
}

function* frontendSources(directory: string): IterableIterator<string> {
    if (!fs.existsSync(directory)) {
        return;
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* frontendSources(file);
        } else if (/\.tsx?$/.test(entry.name) && !/spec\.tsx?$/.test(entry.name)) {
            yield file;
        }
    }
}

function read(files: Iterable<string>): SourceFile[] {
    return [...files].map(file => ({ relative: path.relative(PACKAGES_DIR, file).split(path.sep).join('/'), source: fs.readFileSync(file, 'utf8') }));
}

/** `@theia/<name>/lib/<module>` → `<name>/src/<module>.ts` relative to the packages directory. */
function moduleSource(module: string): string {
    const [, name, ...rest] = module.split('/');
    return [name, 'src', ...rest.slice(1)].join('/') + '.ts';
}

/** Packages none of whose frontend (preload) modules stay in the phone entry. */
function excludedPackages(): Set<string> {
    const excluded = new Set<string>();
    for (const name of new Set(QaapMobileFrontendEntry.EXCLUDED_MODULES.map(module => module.split('/')[1]))) {
        const directory = [PACKAGES_DIR, EXAMPLES_DIR].map(parent => path.join(parent, name)).find(candidate => fs.existsSync(path.join(candidate, 'package.json')));
        const extensions: Array<Record<string, string>> = directory ? JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).theiaExtensions ?? [] : [];
        const modules = extensions.flatMap(extension => [extension.frontend, extension.frontendPreload]).filter(module => !!module);
        if (modules.every(module => QaapMobileFrontendEntry.EXCLUDED_MODULES.includes(`@theia/${name}/${module}`))) {
            excluded.add(name);
        }
    }
    return excluded;
}

/** Frontend sources the phone entry may load: kept packages minus excluded modules and desktop-only files. */
function keptSources(excluded: Set<string>): SourceFile[] {
    const excludedModuleFiles = QaapMobileFrontendEntry.EXCLUDED_MODULES.map(moduleSource);
    return read(fs.readdirSync(PACKAGES_DIR).filter(name => !excluded.has(name))
        .flatMap(name => ['browser', 'common'].flatMap(platform => [...frontendSources(path.join(PACKAGES_DIR, name, 'src', platform))])))
        .filter(file => !excludedModuleFiles.includes(file.relative) && !DESKTOP_ONLY_FILES.some(desktopOnly => file.relative.startsWith(desktopOnly)));
}

describe('QaapMobileFrontendEntry excluded modules', () => {

    it('are DI leaves: no file kept on phones imports an excluded package', () => {
        const excluded = excludedPackages();
        const offenders = keptSources(excluded).flatMap(({ relative, source }) => [...source.matchAll(/from '@theia\/([^/']+)/g)]
            .filter(match => excluded.has(match[1]))
            .map(match => `${relative} imports @theia/${match[1]}`));
        expect(offenders).to.deep.equal([]);
    });

    it('keep desktop-only files and excluded Qaap modules out of the files kept on phones', () => {
        const desktopOnly = [...DESKTOP_ONLY_FILES.filter(file => file.endsWith('.ts')), ...QaapMobileFrontendEntry.EXCLUDED_MODULES.map(moduleSource)]
            .map(file => path.basename(file, '.ts'));
        const offenders = keptSources(excludedPackages()).flatMap(({ relative, source }) => [...source.matchAll(/from '([^']+)'/g)]
            .filter(match => desktopOnly.includes(path.posix.basename(match[1])))
            .map(match => `${relative} imports ${match[1]}`));
        expect(offenders).to.deep.equal([]);
    });

    it('leave no kept RPC proxy that only an excluded module replaced', () => {
        // e.g. plugin-ext rebinds @theia/debug's `DebugService` proxy; on phones the raw proxy would send
        // `onDid*` subscriptions to a backend that does not implement them.
        const excluded = excludedPackages();
        const kept = keptSources(excluded);
        const keptFiles = new Set(kept.map(file => file.relative));
        // plugin-ext keeps its frontend under src/main/browser, so scan all excluded sources but the backend.
        const reboundByExcluded = new Set(read(fs.readdirSync(PACKAGES_DIR).flatMap(name => [...frontendSources(path.join(PACKAGES_DIR, name, 'src'))]))
            .filter(file => !keptFiles.has(file.relative) && !/\/(node|electron-main)\//.test(file.relative))
            .flatMap(({ source }) => [...source.matchAll(/\brebind\((\w+)\)/g)].map(match => match[1])));
        const offenders: string[] = [];
        for (const { relative, source } of kept) {
            for (const match of source.matchAll(/\bbind\((\w+)\)\.toDynamicValue\([^;]*?createProxy/g)) {
                const symbol = match[1];
                if (reboundByExcluded.has(symbol)
                    && !kept.some(file => file.relative.startsWith('qaap-') && file.source.includes(`rebind(${symbol})`))) {
                    offenders.push(`${relative} binds ${symbol} to an RPC proxy that only excluded modules replace`);
                }
            }
        }
        expect(offenders).to.deep.equal([]);
    });

    it('name frontend modules of the repository', () => {
        const missing = QaapMobileFrontendEntry.EXCLUDED_MODULES
            .filter(module => ![PACKAGES_DIR, EXAMPLES_DIR].some(directory => fs.existsSync(path.join(directory, moduleSource(module)))));
        expect(missing).to.deep.equal([]);
    });
});

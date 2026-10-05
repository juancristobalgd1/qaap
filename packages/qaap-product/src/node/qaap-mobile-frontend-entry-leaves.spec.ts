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
 * Kept files that import an excluded package without injecting anything it binds, so the phone
 * entry still resolves: `qaap-product` binds its own `PluginViewWelcomePolicy` implementation and
 * rebinds `HostedPluginSupport` only when plugin-ext bound it, `qaap-shared-core` only looks VSX
 * widgets up by id, and `plugin-ext-headless` has no frontend.
 */
const ALLOWED_IMPORTERS = [
    'plugin-ext-headless/',
    'qaap-product/src/browser/qaap-hosted-plugin-support.ts',
    'qaap-product/src/browser/qaap-plugin-view-welcome-policy.ts',
    'qaap-product/src/browser/qaap-product-bindings-frontend-module.ts',
    'qaap-shared-core/src/browser/qaap-vsx-extensions-mobile-contribution.ts',
];

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

describe('QaapMobileFrontendEntry excluded modules', () => {

    it('are DI leaves: no package kept on phones imports an excluded package', () => {
        const excluded = new Set(QaapMobileFrontendEntry.EXCLUDED_MODULES.map(module => module.split('/')[1]));
        const offenders: string[] = [];
        for (const name of fs.readdirSync(PACKAGES_DIR)) {
            if (excluded.has(name)) {
                continue;
            }
            for (const platform of ['browser', 'common']) {
                for (const file of frontendSources(path.join(PACKAGES_DIR, name, 'src', platform))) {
                    const relative = path.relative(PACKAGES_DIR, file).split(path.sep).join('/');
                    if (ALLOWED_IMPORTERS.some(allowed => relative.startsWith(allowed))) {
                        continue;
                    }
                    for (const match of fs.readFileSync(file, 'utf8').matchAll(/from '@theia\/([^/']+)/g)) {
                        if (excluded.has(match[1])) {
                            offenders.push(`${relative} imports @theia/${match[1]}`);
                        }
                    }
                }
            }
        }
        expect(offenders).to.deep.equal([]);
    });

    it('are only rebound by kept modules when they were bound', () => {
        // `rebind` throws when nothing is bound, which on phones aborts the frontend start before the Work Hub mounts.
        const excluded = new Set(QaapMobileFrontendEntry.EXCLUDED_MODULES.map(module => module.split('/')[1]));
        const offenders: string[] = [];
        for (const allowed of ALLOWED_IMPORTERS.filter(importer => importer.endsWith('.ts'))) {
            const source = fs.readFileSync(path.join(PACKAGES_DIR, allowed), 'utf8');
            for (const match of source.matchAll(/import \{([^}]+)\} from '@theia\/([^/']+)/g)) {
                if (!excluded.has(match[2])) {
                    continue;
                }
                for (const symbol of match[1].split(',').map(name => name.trim()).filter(name => name.length > 0)) {
                    if (source.includes(`rebind(${symbol})`) && !source.includes(`isBound(${symbol})`)) {
                        offenders.push(`${allowed} rebinds ${symbol} without isBound(${symbol})`);
                    }
                }
            }
        }
        expect(offenders).to.deep.equal([]);
    });

    it('name packages of the repository', () => {
        const missing = QaapMobileFrontendEntry.EXCLUDED_MODULES
            .map(module => module.split('/')[1])
            .filter(name => ![PACKAGES_DIR, EXAMPLES_DIR].some(directory => fs.existsSync(path.join(directory, name, 'package.json'))));
        expect(missing).to.deep.equal([]);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { QaapMobileFrontendEntry } from './qaap-mobile-frontend-entry';

const KEPT = [
    '@theia/core/lib/browser/preload/preload-module',
    '@theia/monaco/lib/browser/monaco-frontend-module',
    '@theia/terminal/lib/browser/terminal-frontend-module',
    '@theia/debug/lib/browser/debug-frontend-module',
    '@theia/ai-ide/lib/browser/frontend-module',
    '@theia/getting-started/lib/browser/getting-started-frontend-module',
    '@theia/memory-inspector/lib/browser/memory-inspector-frontend-module',
    '@theia/qaap-work-hub/lib/browser/qaap-work-hub-frontend-module',
    '@theia/qaap-product/lib/browser/qaap-product-bindings-frontend-module',
];

function generatedEntry(eol: string, kind: 'import' | 'require'): string {
    return [
        "require('reflect-metadata');",
        'async function preload(container) {',
        ...[KEPT[0], '@theia/api-samples/lib/browser/api-samples-preload-module']
            .map(module => `        await load(container, ${kind}('${module}'));`),
        '}',
        'module.exports = (async () => {',
        ...[...KEPT.slice(1), ...QaapMobileFrontendEntry.EXCLUDED_MODULES.filter(module => !module.includes('preload'))]
            .map(module => `        await load(container, ${kind}('${module}'));`),
        '        await start();',
        '})();',
        '',
    ].join(eol);
}

describe('QaapMobileFrontendEntry', () => {

    for (const [eol, kind] of [['\n', 'import'], ['\r\n', 'require']] as const) {
        it(`drops only the IDE-only modules (${JSON.stringify(eol)}, ${kind})`, () => {
            const source = generatedEntry(eol, kind);
            const mobile = QaapMobileFrontendEntry.create(source);
            for (const module of QaapMobileFrontendEntry.EXCLUDED_MODULES) {
                expect(source).to.contain(`'${module}'`);
                expect(mobile).to.not.contain(`'${module}'`);
            }
            for (const module of KEPT) {
                expect(mobile).to.contain(`await load(container, ${kind}('${module}'));${eol}`);
            }
            expect(mobile).to.contain(`module.exports = (async () => {${eol}`);
            expect(mobile.split(eol).length).to.equal(source.split(eol).length - QaapMobileFrontendEntry.EXCLUDED_MODULES.length);
        });
    }

    it('never drops the plugin host without everything that injects it', () => {
        const excluded = QaapMobileFrontendEntry.EXCLUDED_MODULES;
        expect(excluded).to.include('@theia/plugin-ext/lib/plugin-ext-frontend-module');
        expect(excluded).to.include('@theia/plugin-ext-vscode/lib/browser/plugin-vscode-frontend-module');
        expect(excluded).to.include('@theia/vsx-registry/lib/browser/vsx-registry-frontend-module');
        expect(excluded).to.include('@theia/ai-registry/lib/browser/ai-registry-frontend-module');
    });

    it('fails loudly when the generator output has no module lines', () => {
        expect(() => QaapMobileFrontendEntry.create('module.exports = {};\n')).to.throw(/qaap mobile entry/);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/**
 * Desktop safety net for the mobile/IDE module split.
 *
 * Replays every `@theia/qaap-*` frontend (and frontend preload) container module of the DESKTOP
 * composition, in desktop load order, against a recording `bind`/`rebind`/`unbind`/`isBound`/
 * `onActivation`, and compares the result with `test-resources/qaap-desktop-bindings.snapshot.txt`:
 * one line per binding, `serviceIdentifier -> binding chain`, sorted. Multi-binding order (for example
 * the order of `FrontendApplicationContribution`s) is deliberately not part of the snapshot: a module
 * split loads the IDE-only half after the mobile-safe half.
 *
 * Splitting a module into a mobile-safe and an IDE-only module must keep this snapshot byte-identical
 * (desktop loads both). Regenerate only for a deliberate desktop change:
 *   QAAP_UPDATE_BINDING_SNAPSHOT=1 npx mocha packages/qaap-product/lib/browser/qaap-desktop-binding-snapshot.spec.js
 */

import { enableJSDOM } from '@theia/core/lib/browser/test/jsdom';
const disableImportJSDOM = enableJSDOM();

import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
FrontendApplicationConfigProvider.set({});

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

// Some product modules deep-import an upstream package's `src/` TypeScript (esbuild bundles it); in
// node only the compiled `lib/` exists. Map it for this spec only.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeModule = require('module') as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
const originalResolveFilename = NodeModule._resolveFilename;
// Stylesheets that only exist under `src/` are ignored like every other `.css` (ignore-styles).
const cssStub = path.join(repoRoot, 'packages', 'core', 'src', 'browser', 'style', 'index.css');
NodeModule._resolveFilename = (request: string, ...rest: unknown[]): string => {
    try {
        return originalResolveFilename(/^@theia\/[^/]+\/src\//.test(request) ? request.replace('/src/', '/lib/') : request, ...rest);
    } catch (error) {
        if (/\.css(\?.*)?$/.test(request)) {
            return cssStub;
        }
        throw error;
    }
};

const snapshotFile = path.join(repoRoot, 'packages', 'qaap-product', 'test-resources', 'qaap-desktop-bindings.snapshot.txt');

/**
 * Desktop load order of the Qaap modules (same order as `src-gen/frontend/index.js`). The spec also
 * checks that this list is exactly the set of `frontendPreload` + `frontend` theiaExtensions declared
 * by `packages/qaap-*`, so a new module cannot be left out of the snapshot.
 */
const DESKTOP_QAAP_MODULES: readonly string[] = [
    'qaap-cloud-workspace/lib/browser/qaap-login-preload-module',
    'qaap-product/lib/browser/preload/qaap-product-preload-module',
    'qaap-element-inspector/lib/browser/qaap-element-inspector-frontend-module',
    'qaap-adapters/lib/browser/qaap-adapters-frontend-module',
    'qaap-ai-nvidia/lib/browser/nvidia-frontend-module',
    'qaap-ai-openrouter/lib/browser/openrouter-frontend-module',
    'qaap-mobile-shell/lib/browser/qaap-mobile-shell-frontend-module',
    'qaap-product-theme/lib/browser/qaap-product-theme-frontend-module',
    'qaap-product-theme/lib/browser/qaap-product-theme-ide-frontend-module',
    'qaap-shell/lib/browser/qaap-shell-frontend-module',
    'qaap-work-hub/lib/browser/qaap-workbench-frontend-module',
    'qaap-work-hub/lib/browser/qaap-work-hub-frontend-module',
    'qaap-work-hub/lib/browser/qaap-work-hub-ide-frontend-module',
    'qaap-cloud-workspace/lib/browser/qaap-login-frontend-module',
    'qaap-cloud-workspace/lib/browser/qaap-cloud-workspace-frontend-module',
    'qaap-ai-config/lib/browser/qaap-ai-config-frontend-module',
    'qaap-ai-config/lib/browser/qaap-ai-config-ide-frontend-module',
    'qaap-product/lib/browser/qaap-product-frontend-module',
    'qaap-product/lib/browser/qaap-product-bindings-frontend-module',
    'qaap-product/lib/browser/qaap-product-ide-frontend-module',
];

function declaredQaapFrontendModules(): string[] {
    const packagesDir = path.join(repoRoot, 'packages');
    const result: string[] = [];
    for (const dir of fs.readdirSync(packagesDir)) {
        const packageJson = path.join(packagesDir, dir, 'package.json');
        if (!dir.startsWith('qaap-') || !fs.existsSync(packageJson)) {
            continue;
        }
        const extensions: Array<Record<string, string>> = JSON.parse(fs.readFileSync(packageJson, 'utf8')).theiaExtensions ?? [];
        for (const extension of extensions) {
            for (const key of ['frontendPreload', 'frontend']) {
                if (extension[key]) {
                    result.push(`${dir}/${extension[key]}`);
                }
            }
        }
    }
    return result.sort();
}

function describeIdentifier(id: unknown): string {
    if (typeof id === 'function') {
        return id.name || '<anonymous class>';
    }
    if (typeof id === 'symbol') {
        return `Symbol(${id.description ?? ''})`;
    }
    return JSON.stringify(id);
}

function describeValue(value: unknown, depth = 0): string {
    if (typeof value === 'function') {
        return value.prototype && value.name ? value.name : 'fn';
    }
    if (typeof value === 'symbol') {
        return `Symbol(${value.description ?? ''})`;
    }
    if (value === undefined || value === null || typeof value !== 'object') { // eslint-disable-line no-null/no-null
        return JSON.stringify(value) ?? 'undefined';
    }
    if (depth > 2) {
        return '{…}';
    }
    if (Array.isArray(value)) {
        return `[${value.map(item => describeValue(item, depth + 1)).join(', ')}]`;
    }
    const constructorName = (value as object).constructor?.name;
    if (constructorName && constructorName !== 'Object') {
        return `<${constructorName}>`;
    }
    return `{${Object.keys(value).sort().map(key => `${key}: ${describeValue((value as Record<string, unknown>)[key], depth + 1)}`).join(', ')}}`;
}

interface RecordedBinding {
    readonly op: string;
    readonly steps: string[];
}

class BindingRecorder {
    readonly bindings = new Map<string, RecordedBinding[]>();
    readonly bound = new Set<unknown>();

    protected record(op: string, id: unknown): unknown {
        const key = describeIdentifier(id);
        const entry: RecordedBinding = { op, steps: [] };
        const list = this.bindings.get(key) ?? [];
        list.push(entry);
        this.bindings.set(key, list);
        this.bound.add(id);
        const syntax: unknown = new Proxy({}, {
            get: (_target, property) => (...args: unknown[]) => {
                const name = String(property);
                const described = /^to(DynamicValue|Factory|Provider)$|^on(Activation|Deactivation)$/.test(name)
                    ? 'fn'
                    : args.map(arg => name === 'toSelf' ? '' : describeValue(arg)).join(', ');
                entry.steps.push(`${name}(${described})`);
                return syntax;
            }
        });
        return syntax;
    }

    readonly bind = (id: unknown): unknown => this.record('bind', id);
    readonly rebind = (id: unknown): unknown => this.record('rebind', id);
    readonly unbind = (id: unknown): void => {
        this.record('unbind', id);
        this.bound.delete(id);
    };
    readonly unbindAsync = async (id: unknown): Promise<void> => this.unbind(id);
    readonly isBound = (id: unknown): boolean => this.bound.has(id);
    readonly onActivation = (id: unknown): void => {
        this.record('onActivation', id);
    };
    readonly onDeactivation = (id: unknown): void => {
        this.record('onDeactivation', id);
    };

    lines(): string[] {
        const lines: string[] = [];
        for (const [key, entries] of this.bindings) {
            for (const entry of entries) {
                lines.push(`${key} -> ${entry.op}${entry.steps.length ? '.' : ''}${entry.steps.join('.')}`);
            }
        }
        return lines.sort();
    }
}

/**
 * `QaapIde*` symbols (`@theia/qaap-shared-core/lib/browser/qaap-ide-bridge`) are new by construction:
 * IDE-only modules bind them as `toService` aliases of an upstream service so mobile-safe classes can
 * inject them with `@optional()`. They are checked to be pure aliases and kept out of the snapshot.
 */
const IDE_BRIDGE_LINE = /^Symbol\(QaapIde[A-Za-z]*\) -> /;

function replayDesktopModules(): BindingRecorder {
    const recorder = new BindingRecorder();
    for (const modulePath of DESKTOP_QAAP_MODULES) {
        // Computed path on purpose: the snapshot replays modules of packages qaap-product does not depend on.
        // eslint-disable-next-line @typescript-eslint/no-require-imports, import/no-dynamic-require
        const containerModule = require(path.join(repoRoot, 'packages', modulePath)).default;
        containerModule.registry(recorder.bind, recorder.unbind, recorder.isBound, recorder.rebind,
            recorder.unbindAsync, recorder.onActivation, recorder.onDeactivation);
    }
    return recorder;
}

disableImportJSDOM();

let disableJSDOM: () => void = () => undefined;

describe('Qaap desktop binding snapshot', function (): void {
    this.timeout(120_000);

    // Other spec files of this package may tear their jsdom down before this suite runs.
    before(() => {
        disableJSDOM = enableJSDOM();
    });

    after(() => {
        NodeModule._resolveFilename = originalResolveFilename;
        disableJSDOM();
    });

    it('lists every qaap frontend module of the desktop composition', () => {
        expect([...DESKTOP_QAAP_MODULES].sort()).to.deep.equal(declaredQaapFrontendModules());
    });

    it('keeps the desktop bindings of the qaap modules identical', () => {
        const lines = replayDesktopModules().lines();
        const bridgeLines = lines.filter(line => IDE_BRIDGE_LINE.test(line));
        for (const line of bridgeLines) {
            expect(line).to.match(/ -> bind\.toService\((?:[A-Za-z]+|Symbol\([A-Za-z]+\))\)$/, 'IDE bridge symbols are plain toService aliases');
        }
        const actual = lines.filter(line => !IDE_BRIDGE_LINE.test(line)).join('\n') + '\n';
        if (process.env.QAAP_UPDATE_BINDING_SNAPSHOT === '1') {
            fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
            fs.writeFileSync(snapshotFile, actual);
        }
        const expected = fs.readFileSync(snapshotFile, 'utf8').replace(/\r\n/g, '\n');
        expect(actual).to.equal(expected);
    });
});

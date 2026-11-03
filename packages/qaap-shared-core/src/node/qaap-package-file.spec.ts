// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findQaapPackageFile, findQaapRepositoryFile, resolveQaapPackageFile } from './qaap-package-file';

function write(file: string, content = ''): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

describe('qaap-package-file', () => {
    let root: string;

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-package-file-')));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    // A bundled backend: the bundle folder sits in examples/browser/lib/backend, the package in node_modules.
    const bundleDir = (): string => path.join(root, 'examples', 'browser', 'lib', 'backend');

    it('uses the direct candidate first, when it exists', () => {
        const direct = path.join(root, 'direct', 'worker.js');
        write(direct);
        write(path.join(root, 'node_modules', '@theia', 'qaap-cloud-workspace', 'lib', 'node', 'worker.js'));
        expect(findQaapPackageFile('@theia/qaap-cloud-workspace', 'lib/node/worker.js', { directCandidate: direct })).to.equal(direct);
    });

    it('walks up from a bundle folder to the installed package when the direct candidate is missing', () => {
        const installed = path.join(root, 'node_modules', '@theia', 'qaap-cloud-workspace', 'lib', 'node', 'worker.js');
        write(installed);
        fs.mkdirSync(bundleDir(), { recursive: true });
        expect(findQaapPackageFile('@theia/qaap-cloud-workspace', 'lib/node/worker.js', {
            startDirectory: bundleDir(),
            directCandidate: path.join(bundleDir(), 'worker.js'),
        })).to.equal(installed);
    });

    it('finds a package file from the nearest node_modules that has it', () => {
        const near = path.join(root, 'examples', 'node_modules', '@theia', 'qaap-product', 'resources', 'skills');
        write(path.join(root, 'node_modules', '@theia', 'qaap-product', 'resources', 'skills'));
        write(near);
        expect(findQaapPackageFile('@theia/qaap-product', 'resources/skills', { startDirectory: bundleDir() })).to.equal(near);
    });

    it('returns undefined when the file is nowhere, and resolve falls back to the direct candidate', () => {
        const direct = path.join(bundleDir(), 'worker.js');
        expect(findQaapPackageFile('@theia/qaap-cloud-workspace', 'lib/node/worker.js', {
            startDirectory: bundleDir(),
            directCandidate: direct,
        })).to.equal(undefined);
        expect(resolveQaapPackageFile('@theia/qaap-cloud-workspace', 'lib/node/worker.js', {
            startDirectory: bundleDir(),
            directCandidate: direct,
        })).to.equal(direct);
    });

    it('finds a repository file such as scripts/ in an ancestor folder, and prefers the direct candidate', () => {
        const script = path.join(root, 'scripts', 'qaap-guarded-bash.mjs');
        write(script);
        fs.mkdirSync(bundleDir(), { recursive: true });
        expect(findQaapRepositoryFile('scripts/qaap-guarded-bash.mjs', { startDirectory: bundleDir() })).to.equal(script);
        const direct = path.join(root, 'direct.mjs');
        write(direct);
        expect(findQaapRepositoryFile('scripts/qaap-guarded-bash.mjs', { startDirectory: bundleDir(), directCandidate: direct })).to.equal(direct);
        expect(findQaapRepositoryFile('scripts/missing.mjs', { startDirectory: bundleDir() })).to.equal(undefined);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapCloudWorkspaceResource } from './qaap-cloud-workspace-resource';

const FILE = 'qaap-tool-gate-pi.mjs';

describe('resolveQaapCloudWorkspaceResource', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-cloud-workspace-resource-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function write(relative: string): string {
        const file = path.join(root, relative);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, '// gate');
        return file;
    }

    it('finds the file directly for the unbundled layout: <package>/lib/node -> <package>/resources', () => {
        const packageRoot = path.join(root, 'packages', 'qaap-cloud-workspace');
        const shipped = write(path.join('packages', 'qaap-cloud-workspace', 'resources', FILE));
        const resolved = resolveQaapCloudWorkspaceResource(FILE, path.join(packageRoot, 'lib', 'node'));
        expect(resolved).to.equal(shipped);
    });

    it('walks up to the workspace node_modules link for the bundled example backend', () => {
        const bundleDirectory = path.join(root, 'examples', 'browser', 'lib', 'backend');
        fs.mkdirSync(bundleDirectory, { recursive: true });
        const shipped = write(path.join('node_modules', '@theia', 'qaap-cloud-workspace', 'resources', FILE));
        const resolved = resolveQaapCloudWorkspaceResource(FILE, bundleDirectory);
        expect(resolved).to.equal(shipped);
    });

    it('prefers the direct layout when both candidates exist', () => {
        const bundleDirectory = path.join(root, 'examples', 'browser', 'lib', 'backend');
        fs.mkdirSync(bundleDirectory, { recursive: true });
        write(path.join('examples', 'browser', 'resources', FILE));
        const linked = write(path.join('node_modules', '@theia', 'qaap-cloud-workspace', 'resources', FILE));
        const resolved = resolveQaapCloudWorkspaceResource(FILE, bundleDirectory);
        expect(resolved).to.not.equal(linked);
        expect(resolved).to.equal(path.join(bundleDirectory, '..', '..', 'resources', FILE));
    });

    it('returns the first (unbundled) candidate when the file exists nowhere, so the error names it', () => {
        const startDirectory = path.join(root, 'examples', 'browser', 'lib', 'backend');
        fs.mkdirSync(startDirectory, { recursive: true });
        const resolved = resolveQaapCloudWorkspaceResource(FILE, startDirectory);
        expect(resolved).to.equal(path.resolve(startDirectory, '..', '..', 'resources', FILE));
        expect(fs.existsSync(resolved)).to.equal(false);
    });

    it('resolves the real shipped resources from the source tree', () => {
        const resolved = resolveQaapCloudWorkspaceResource(FILE);
        expect(fs.existsSync(resolved), resolved).to.equal(true);
    });
});

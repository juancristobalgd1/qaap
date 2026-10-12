// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as path from 'path';

/**
 * Boots the `bundle-mobile` module list in a container (see `test/qaap-mobile-entry-container-check`).
 * The check runs in a child mocha process because the resolved services keep timers and sockets
 * alive that would otherwise fire into the jsdom of later spec files.
 */
describe('bundle-mobile entry container (isolated process)', function (): void {
    this.timeout(240_000);

    it('loads the mobile module list and resolves the application and the Work Hub', () => {
        const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
        const check = path.join(__dirname, 'test', 'qaap-mobile-entry-container-check.js');
        const result = spawnSync(process.execPath, [
            require.resolve('mocha/bin/mocha.js'), '--config', path.join(repoRoot, 'configs', 'mocharc.yml'), '--reporter', 'dot', check
        ], { cwd: repoRoot, encoding: 'utf8' });
        expect(result.status, `${result.stdout}\n${result.stderr}`).to.equal(0);
    });
});

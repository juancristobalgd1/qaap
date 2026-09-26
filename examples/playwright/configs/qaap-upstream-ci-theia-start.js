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

// @ts-check

/**
 * Qaap: `webServer` command of `playwright.qaap-upstream-ci.config.ts`. Same as the upstream
 * `npm run theia:start` (fresh `examples/browser/.tmp.cfg` config dir), but seeds the user settings
 * the upstream suite assumes and Qaap changes on purpose:
 *
 * - `workbench.startupEditor: welcomePage` — Qaap defaults to `none` because the Work Hub hides the
 *   main area on boot; upstream opens the Welcome page, which the getting-started spec and the
 *   "Close All Tabs in Main Area" quick-command check rely on.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const browserAppDir = path.resolve(__dirname, '../../browser');
const configDir = path.join(browserAppDir, '.tmp.cfg');

fs.rmSync(configDir, { recursive: true, force: true });
fs.mkdirSync(configDir, { recursive: true });
fs.writeFileSync(path.join(configDir, 'settings.json'), JSON.stringify({
    'workbench.startupEditor': 'welcomePage'
}, undefined, 4));

const theia = spawn('npm', ['run', 'start'], {
    cwd: browserAppDir,
    env: { ...process.env, THEIA_CONFIG_DIR: configDir },
    stdio: 'inherit',
    shell: process.platform === 'win32'
});
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => theia.kill(signal));
}
theia.on('exit', code => process.exit(code ?? 0));

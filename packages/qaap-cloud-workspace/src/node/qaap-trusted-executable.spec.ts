// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isOnPath } from './qaap-agent-task-runner-utils';
import {
    filterTrustedPath,
    findExecutableOnPath,
    isDirectoryTrustedForUid,
    resolveTrustedExecutable,
    resolveTrustedSystemExecutable,
} from './qaap-trusted-executable';

const isWindows = process.platform === 'win32';
/**
 * Ownership checks need a directory root does not own (so they cannot run as root) inside a tmpdir
 * whose ancestors are themselves trustworthy (e.g. a sticky `/tmp`, not a group-writable one).
 */
function canCheckOwnershipInTmpdir(): boolean {
    if (isWindows || process.getuid?.() === 0) {
        return false;
    }
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-trust-probe-'));
    try {
        return isDirectoryTrustedForUid(probe, process.getuid?.());
    } finally {
        fs.rmSync(probe, { recursive: true, force: true });
    }
}
const posixNonRootIt = canCheckOwnershipInTmpdir() ? it : it.skip;

function writeExecutable(directory: string, name: string, posixBody: string): string {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, isWindows ? `${name}.cmd` : name);
    fs.writeFileSync(file, isWindows ? '@exit /b 0\r\n' : `#!/bin/sh\n${posixBody}\n`);
    fs.chmodSync(file, 0o755);
    return file;
}

describe('qaap trusted executable resolution', () => {
    let sandbox: string;

    beforeEach(() => {
        sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-trusted-exec-'));
    });

    afterEach(() => {
        fs.rmSync(sandbox, { recursive: true, force: true });
    });

    it('finds CLIs in-process: isOnPath never spawns a PATH-resolved which/where', () => {
        const marker = path.join(sandbox, 'which-ran');
        const plantedDirectory = path.join(sandbox, 'planted');
        writeExecutable(plantedDirectory, 'which', `touch '${marker}'`);
        writeExecutable(plantedDirectory, 'where', `touch '${marker}'`);
        const cli = writeExecutable(path.join(sandbox, 'cli'), 'qaap-fake-cli', 'exit 0');
        const env = { PATH: [plantedDirectory, path.dirname(cli)].join(path.delimiter) };

        expect(isOnPath('qaap-fake-cli', env)).to.equal(true);
        expect(isOnPath('qaap-missing-cli', env)).to.equal(false);
        // Windows matches PATHEXT case-insensitively (`.CMD` finds `.cmd`).
        expect(findExecutableOnPath('qaap-fake-cli', env.PATH)?.toLowerCase()).to.equal(cli.toLowerCase());
        expect(fs.existsSync(marker)).to.equal(false);
    });

    posixNonRootIt('trusts a directory for its owner but never for root, and rejects group/world-writable ones', () => {
        const uid = process.getuid!();
        const owned = path.join(sandbox, 'owned');
        fs.mkdirSync(owned, { mode: 0o755 });
        fs.chmodSync(sandbox, 0o755);
        expect(isDirectoryTrustedForUid(owned, uid)).to.equal(true);
        expect(isDirectoryTrustedForUid(owned, 0)).to.equal(false);

        fs.chmodSync(owned, 0o777);
        expect(isDirectoryTrustedForUid(owned, uid)).to.equal(false);

        // Symlinks are followed: a root-looking alias of an untrusted directory stays untrusted.
        const alias = path.join(sandbox, 'alias');
        fs.symlinkSync(owned, alias);
        expect(isDirectoryTrustedForUid(alias, uid)).to.equal(false);
        expect(isDirectoryTrustedForUid('relative/bin', uid)).to.equal(false);
    });

    posixNonRootIt('resolves a CLI for root only from root-owned PATH entries', () => {
        const tenantBin = path.join(sandbox, 'tenant', 'bin');
        const planted = writeExecutable(tenantBin, 'git', 'exit 0');
        const env = { PATH: [tenantBin, '/usr/bin', '/bin'].join(path.delimiter) };

        expect(filterTrustedPath(env.PATH, 0).split(path.delimiter)).not.to.include(tenantBin);
        expect(resolveTrustedExecutable('git', env, 0)).not.to.equal(planted);
        // The owner of the directory may still run its own file.
        expect(resolveTrustedExecutable('git', env, process.getuid!())).to.equal(planted);
    });

    it('resolves setpriv only to an absolute path from a system directory', () => {
        const setpriv = resolveTrustedSystemExecutable('setpriv');
        if (isWindows) {
            expect(setpriv).to.equal(undefined);
            return;
        }
        if (setpriv !== undefined) {
            expect(path.isAbsolute(setpriv)).to.equal(true);
            expect(['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin']).to.include(path.dirname(setpriv));
        }
    });
});

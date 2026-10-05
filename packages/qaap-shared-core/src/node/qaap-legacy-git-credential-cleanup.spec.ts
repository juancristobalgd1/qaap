// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapLegacyGitCredentialCleanup } from './qaap-legacy-git-credential-cleanup';

class TestableCleanup extends QaapLegacyGitCredentialCleanup {
    constructor(protected readonly directory: string) {
        super();
    }

    protected override legacyDirectory(): string {
        return this.directory;
    }
}

describe('qaap-legacy-git-credential-cleanup', () => {
    let base: string;

    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-legacy-cred-'));
    });

    afterEach(() => {
        fs.rmSync(base, { recursive: true, force: true });
    });

    it('deletes a credential file an earlier build left on start, expired or not', () => {
        const directory = path.join(base, 'qaap-git-credential');
        fs.mkdirSync(directory, { mode: 0o711 });
        const file = path.join(directory, 'github.json');
        fs.writeFileSync(file, JSON.stringify({ login: 'octo', token: 'gho_left', expiresAt: 1 }), { mode: 0o600 });
        fs.writeFileSync(path.join(directory, 'github.json.42.tmp'), 'partial');

        new TestableCleanup(directory).initialize();

        expect(fs.existsSync(directory)).to.equal(false);
    });

    it('never follows an entry planted at the credential path', function (): void {
        if (process.platform === 'win32') {
            this.skip();
        }
        const elsewhere = path.join(base, 'elsewhere');
        fs.mkdirSync(elsewhere);
        fs.writeFileSync(path.join(elsewhere, 'keep.txt'), 'keep');
        const directory = path.join(base, 'qaap-git-credential');
        fs.symlinkSync(elsewhere, directory, 'dir');

        new TestableCleanup(directory).initialize();

        expect(fs.readFileSync(path.join(elsewhere, 'keep.txt'), 'utf8')).to.equal('keep');
        expect(fs.lstatSync(directory).isSymbolicLink()).to.equal(true);
    });

    it('does nothing when no credential was ever published', () => {
        expect(new TestableCleanup(path.join(base, 'missing')).removeLegacyCredential(path.join(base, 'missing'))).to.equal(false);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isRealPathUnder, resolveRealPathWithinExisting } from './qaap-realpath-guard';

describe('qaap-realpath-guard', () => {
    let root: string;
    let alice: string;
    let bob: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-realpath-'));
        alice = path.join(root, 'users', 'alice');
        bob = path.join(root, 'users', 'bob');
        fs.mkdirSync(path.join(alice, 'repo'), { recursive: true });
        fs.mkdirSync(path.join(bob, 'secret'), { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('accepts a real path genuinely inside the user root', () => {
        expect(isRealPathUnder(path.join(alice, 'repo'), alice)).to.equal(true);
        expect(isRealPathUnder(alice, alice)).to.equal(true);
    });

    it('rejects a symlink inside the user root that points into another tenant (the C3 escape)', () => {
        const link = path.join(alice, 'evil');
        fs.symlinkSync(path.join(bob, 'secret'), link);
        // Lexically `.../alice/evil` starts with alice's root, but its real target is bob's tree.
        expect(isRealPathUnder(link, alice)).to.equal(false);
        expect(isRealPathUnder(path.join(link, 'file.txt'), alice)).to.equal(false);
    });

    it('rejects a symlink pointing outside the workspace entirely', () => {
        const link = path.join(alice, 'escape');
        fs.symlinkSync(root, link); // -> repos root, above the user dir
        expect(isRealPathUnder(link, alice)).to.equal(false);
    });

    it('resolves the deepest existing ancestor for a not-yet-created leaf', () => {
        const target = path.join(alice, 'repo', 'new-file.ts');
        expect(resolveRealPathWithinExisting(target)).to.equal(fs.realpathSync(path.join(alice, 'repo')) + path.sep + 'new-file.ts');
        expect(isRealPathUnder(target, alice)).to.equal(true);
    });
});

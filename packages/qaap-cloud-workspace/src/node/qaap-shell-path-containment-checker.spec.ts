// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapShellPathContainmentChecker } from './qaap-shell-path-containment-checker';

describe('QaapShellPathContainmentChecker', () => {
    let root: string;
    let repo: string;
    let outside: string;
    const checker = new QaapShellPathContainmentChecker();

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-path-containment-')));
        repo = path.join(root, 'repo');
        outside = path.join(root, 'outside');
        fs.mkdirSync(path.join(repo, 'src', 'deep'), { recursive: true });
        fs.mkdirSync(outside, { recursive: true });
        fs.writeFileSync(path.join(repo, 'src', 'a.txt'), 'a');
        fs.writeFileSync(path.join(outside, 'secret.txt'), 's');
        // Directory links: junctions need no privilege on Windows; the type is ignored elsewhere.
        fs.symlinkSync(outside, path.join(repo, 'escape'), 'junction');
        fs.symlinkSync(path.join(repo, 'src'), path.join(repo, 'inner'), 'junction');
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('accepts plain paths, missing paths and non-path arguments inside the cwd', () => {
        expect(checker.check(repo, ['src/a.txt', 'src/deep', 'not-there/x', 'pattern', '.'])).to.equal(undefined);
    });

    it('accepts links that stay inside the cwd', () => {
        expect(checker.check(repo, ['inner/a.txt'])).to.equal(undefined);
    });

    it('rejects a link that points outside the cwd, including glob and missing tails', () => {
        expect(checker.check(repo, ['escape/secret.txt'])).to.contain('escape/secret.txt');
        expect(checker.check(repo, ['escape'])).to.contain('escape');
        expect(checker.check(repo, ['escape/*.txt'])).to.contain('escape');
        expect(checker.check(repo, ['escape/missing'])).to.contain('escape');
    });

    it('applies .. to the physical directory like the shell does', () => {
        // `inner` is repo/src, so `inner/../../outside` is repo/../outside physically.
        expect(checker.check(repo, ['inner/../../outside/secret.txt'])).to.contain('inner/../..');
        // Lexically this would be repo/src/deep; physically too (inner -> src): stays inside.
        expect(checker.check(repo, ['inner/deep/..'])).to.equal(undefined);
    });

    it('checks absolute paths', () => {
        expect(checker.check(repo, [path.join(repo, 'src', 'a.txt')])).to.equal(undefined);
        expect(checker.check(repo, [path.join(outside, 'secret.txt')])).to.contain('secret.txt');
    });

    it('fails closed when the cwd cannot be resolved', () => {
        expect(checker.check(path.join(root, 'nope'), ['a'])).to.contain('not resolvable');
    });
});

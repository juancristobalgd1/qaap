// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapSqliteConnectionRegistry } from '@theia/qaap-persistence/lib/node/qaap-sqlite-store';
import { QaapHostedWorktreeRegistry } from './qaap-hosted-worktree-registry';

class SpecRegistry extends QaapHostedWorktreeRegistry {
    constructor(protected readonly base: string) {
        super();
    }

    protected override databasePath(): string {
        return path.join(this.base, 'registry.sqlite');
    }

    protected override reposRoot(): string {
        return this.base;
    }
}

describe('QaapHostedWorktreeRegistry', () => {
    let base: string;
    let clone: string;

    beforeEach(() => {
        base = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-worktree-registry-'));
        clone = path.join(base, 'users', 'octo', 'acme', 'widget');
    });

    afterEach(() => {
        QaapSqliteConnectionRegistry.shared.closeUnder(base);
        fs.rmSync(base, { recursive: true, force: true });
    });

    it('records the project of a worktree cut from the canonical clone, taken from the path lexically', () => {
        const registry = new SpecRegistry(base);
        const worktree = path.join(os.tmpdir(), 'qaap-worktrees', 'octo', 'abcd1234');

        expect(registry.register('octo', clone, worktree)).to.deep.equal({ login: 'octo', owner: 'acme', repo: 'widget' });
        expect(registry.lookup('octo', worktree)).to.deep.equal({ login: 'octo', owner: 'acme', repo: 'widget' });
        expect(registry.lookup('mallory', worktree)).to.equal(undefined);
    });

    it('follows a worktree cut from a recorded worktree, and refuses any other base', () => {
        const registry = new SpecRegistry(base);
        const first = path.join(os.tmpdir(), 'qaap-worktrees', 'octo', 'first');
        const second = path.join(os.tmpdir(), 'qaap-parallel', 'octo', 'run', 'variant');
        registry.register('octo', clone, first);

        expect(registry.register('octo', first, second)).to.deep.equal({ login: 'octo', owner: 'acme', repo: 'widget' });
        expect(registry.register('octo', path.join(base, 'users', 'octo', 'acme'), path.join(base, 'x'))).to.equal(undefined);
        expect(registry.register('octo', path.join(clone, 'packages', 'app'), path.join(base, 'y'))).to.equal(undefined);
        expect(registry.register('octo', path.join(base, 'elsewhere', 'a', 'b'), path.join(base, 'z'))).to.equal(undefined);
        expect(registry.lookup('octo', path.join(base, 'x'))).to.equal(undefined);
    });

    it('survives a backend restart and forgets an unregistered worktree', () => {
        const worktree = path.join(os.tmpdir(), 'qaap-worktrees', 'octo', 'persisted');
        new SpecRegistry(base).register('octo', clone, worktree);
        QaapSqliteConnectionRegistry.shared.closeUnder(base);

        const restarted = new SpecRegistry(base);
        expect(restarted.lookup('octo', worktree)).to.deep.equal({ login: 'octo', owner: 'acme', repo: 'widget' });
        restarted.unregister(worktree);
        expect(restarted.lookup('octo', worktree)).to.equal(undefined);
    });
});

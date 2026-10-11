// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapGithubAuthGuard, type QaapGithubAuthContext } from './qaap-github-auth-guard';
import { QaapMissingCloneRecovery } from './qaap-missing-clone-recovery';

describe('QaapMissingCloneRecovery', () => {

    let reposRoot: string;
    let guard: QaapGithubAuthGuard;
    let recovery: QaapMissingCloneRecovery;
    let restored: Array<{ owner: string; repo: string }>;
    let restore: (owner: string, repo: string) => Promise<string>;

    const alice = { kind: 'authenticated', userLogin: 'alice', sessionId: 's', session: { accessToken: 't', user: { login: 'alice' } } } as unknown as QaapGithubAuthContext;
    const clonePath = (login: string, owner: string, repo: string): string => path.join(reposRoot, 'users', login, owner, repo);

    beforeEach(() => {
        reposRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-missing-clone-'));
        fs.mkdirSync(path.join(reposRoot, 'users', 'alice'), { recursive: true });
        fs.mkdirSync(clonePath('bob', 'octo', 'secret'), { recursive: true });
        guard = new QaapGithubAuthGuard();
        (guard as unknown as { reposRoot: string }).reposRoot = reposRoot;
        (guard as unknown as { logSecurityEvent: () => void }).logSecurityEvent = () => undefined;
        restored = [];
        restore = async (owner, repo) => {
            const target = clonePath('alice', owner, repo);
            fs.mkdirSync(target, { recursive: true });
            return target;
        };
        recovery = new QaapMissingCloneRecovery();
        Object.assign(recovery, {
            auth: guard,
            repositories: {
                restoreMissingRepositoryClone: (_ctx: unknown, owner: string, repo: string) => {
                    restored.push({ owner, repo });
                    return restore(owner, repo);
                },
            },
        });
    });

    afterEach(() => {
        fs.rmSync(reposRoot, { recursive: true, force: true });
    });

    it('re-clones a missing project named by its github: key and resolves its canonical clone', async () => {
        const result = await recovery.resolveOwnedRepositoryCwd(alice, 'github:octo/app');
        expect(restored).to.deep.equal([{ owner: 'octo', repo: 'app' }]);
        expect(result).to.deep.equal({ kind: 'ok', cwd: clonePath('alice', 'octo', 'app') });
    });

    it('re-clones a missing project named by its own canonical path', async () => {
        const result = await recovery.resolveOwnedRepositoryCwd(alice, clonePath('alice', 'octo', 'app'));
        expect(restored).to.deep.equal([{ owner: 'octo', repo: 'app' }]);
        expect(result).to.deep.equal({ kind: 'ok', cwd: clonePath('alice', 'octo', 'app') });
    });

    it('shares one clone between concurrent requests for the same project', async () => {
        const [first, second] = await Promise.all([
            recovery.resolveOwnedRepositoryCwd(alice, 'github:octo/app'),
            recovery.resolveOwnedRepositoryCwd(alice, clonePath('alice', 'octo', 'app')),
        ]);
        expect(restored).to.have.length(1);
        expect(first.kind).to.equal('ok');
        expect(second.kind).to.equal('ok');
    });

    it('does not clone an existing project', async () => {
        fs.mkdirSync(clonePath('alice', 'octo', 'app'), { recursive: true });
        const result = await recovery.resolveOwnedRepositoryCwd(alice, 'github:octo/app');
        expect(restored).to.deep.equal([]);
        expect(result).to.deep.equal({ kind: 'ok', cwd: clonePath('alice', 'octo', 'app') });
    });

    it('returns a readable error, not a cwd error, when the clone cannot be restored', async () => {
        restore = async () => { throw new Error('GitHub repository not found, or you do not have access to it.'); };
        const result = await recovery.resolveOwnedRepositoryCwd(alice, 'github:octo/gone');
        expect(result.kind).to.equal('clone-failed');
        const error = (result as { error: string }).error;
        expect(error).to.contain('octo/gone');
        expect(error).to.contain('GitHub repository not found, or you do not have access to it.');
        expect(error).to.not.match(/cwd/i);
    });

    it('still denies another user\'s path and never clones it into the caller\'s tree', async () => {
        expect(await recovery.resolveOwnedRepositoryCwd(alice, clonePath('bob', 'octo', 'secret'))).to.deep.equal({ kind: 'denied' });
        expect(await recovery.resolveOwnedRepositoryCwd(alice, clonePath('bob', 'octo', 'missing'))).to.deep.equal({ kind: 'denied' });
        expect(restored).to.deep.equal([]);
        expect(fs.existsSync(clonePath('alice', 'octo', 'secret'))).to.equal(false);
    });

    it('never clones through a symlink that leaves the caller\'s tree', async () => {
        // alice's owner directory points into bob's tree: a clone there would write into bob's workspace.
        fs.symlinkSync(path.join(reposRoot, 'users', 'bob', 'octo'), path.join(reposRoot, 'users', 'alice', 'octo'),
            process.platform === 'win32' ? 'junction' : 'dir');
        expect(await recovery.resolveOwnedRepositoryCwd(alice, 'github:octo/new')).to.deep.equal({ kind: 'denied' });
        expect(restored).to.deep.equal([]);
        expect(fs.existsSync(clonePath('bob', 'octo', 'new'))).to.equal(false);
    });

    it('never clones a path-traversal repository key', async () => {
        expect(await recovery.resolveOwnedRepositoryCwd(alice, 'github:../bob')).to.deep.equal({ kind: 'denied' });
        expect(await recovery.resolveOwnedRepositoryCwd(alice, 'github:octo/..')).to.deep.equal({ kind: 'denied' });
        expect(restored).to.deep.equal([]);
    });

    it('leaves skip-auth and container cwds to the plain resolver', async () => {
        const skip = { kind: 'skip', userLogin: '_dev' } as QaapGithubAuthContext;
        expect(await recovery.resolveOwnedRepositoryCwd(skip, '/somewhere/else')).to.deep.equal({ kind: 'ok', cwd: '/somewhere/else' });
        expect(await recovery.resolveOwnedRepositoryCwd(alice, path.join(reposRoot, 'users', 'alice'))).to.deep.equal({ kind: 'needs-project' });
        expect(restored).to.deep.equal([]);
    });
});

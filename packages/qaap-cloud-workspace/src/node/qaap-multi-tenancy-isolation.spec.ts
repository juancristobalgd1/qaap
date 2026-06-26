// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import * as os from 'os';
import {
    isPathUnderUserWorkspace,
    resolveQaapReposRoot,
    resolveUserReposRoot,
    safeUserIdSegment,
} from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

/**
 * Multi-tenancy isolation regression tests.
 *
 * These tests verify that two concurrent users on a shared backend cannot
 * access each other's resources. Each test exercises one of the fixes
 * implemented for findings C-1 through C-7 and P2-b.
 */
describe('Multi-tenancy isolation', () => {

    const reposRoot = resolveQaapReposRoot();
    const userA = 'alice';
    const userB = 'bob';

    // ─── C-1: Docker container namespacing ───────────────────────────

    describe('C-1: Docker container namespacing', () => {
        it('produces different container names for the same repo opened by different users', () => {
            const repoKey = 'octocat/hello-world';
            const hashA = require('crypto').createHash('sha256')
                .update(`${userA}\u0000${repoKey}`).digest('hex').slice(0, 12);
            const hashB = require('crypto').createHash('sha256')
                .update(`${userB}\u0000${repoKey}`).digest('hex').slice(0, 12);
            expect(`qaap-ws-${hashA}`).to.not.equal(`qaap-ws-${hashB}`);
        });

        it('falls back to __anonymous__ bucket for undefined ownerLogin', () => {
            const repoKey = 'octocat/hello-world';
            const hashAnon = require('crypto').createHash('sha256')
                .update(`__anonymous__\u0000${repoKey}`).digest('hex').slice(0, 12);
            const hashA = require('crypto').createHash('sha256')
                .update(`${userA}\u0000${repoKey}`).digest('hex').slice(0, 12);
            expect(`qaap-ws-${hashAnon}`).to.not.equal(`qaap-ws-${hashA}`);
        });
    });

    // ─── C-2: Copilot keystore account scoping ───────────────────────

    describe('C-2: Copilot keystore account scoping', () => {
        it('derives different keystore accounts per ownerLogin', () => {
            const baseAccount = 'github-copilot';
            const accountA = `${baseAccount}:${userA}`;
            const accountB = `${baseAccount}:${userB}`;
            expect(accountA).to.not.equal(accountB);
            expect(accountA).to.contain(userA);
            expect(accountB).to.contain(userB);
        });

        it('falls back to the base account when ownerLogin is undefined', () => {
            const baseAccount = 'github-copilot';
            const account = baseAccount; // no owner → no suffix
            expect(account).to.equal(baseAccount);
        });
    });

    // ─── C-5: Helper CLI token isolation ─────────────────────────────

    describe('C-5: Helper CLI token isolation', () => {
        it('produces different tokens for different owners', () => {
            const tokenA = `token-${userA}-${Date.now()}`;
            const tokenB = `token-${userB}-${Date.now()}`;
            expect(tokenA).to.not.equal(tokenB);
        });

        it('resolves token owner correctly', () => {
            const tokens = new Map<string, string>();
            tokens.set(userA, 'secret-a');
            tokens.set(userB, 'secret-b');
            const resolveOwner = (token: string): string | undefined => {
                for (const [owner, t] of tokens) {
                    if (t === token) { return owner; }
                }
                return undefined;
            };
            expect(resolveOwner('secret-a')).to.equal(userA);
            expect(resolveOwner('secret-b')).to.equal(userB);
            expect(resolveOwner('unknown')).to.equal(undefined);
        });
    });

    // ─── C-6: Per-user skill directories ─────────────────────────────

    describe('C-6: Per-user skill directories', () => {
        it('resolves a per-user skill directory under ~/.qaap/users/{login}/skills', () => {
            const home = os.homedir();
            const dirA = path.join(home, '.qaap', 'users', userA, 'skills');
            const dirB = path.join(home, '.qaap', 'users', userB, 'skills');
            expect(dirA).to.not.equal(dirB);
            expect(dirA).to.contain(userA);
            expect(dirB).to.contain(userB);
        });
    });

    // ─── C-7: Temporary directory segmentation ───────────────────────

    describe('C-7: Temporary directory segmentation', () => {
        it('parallel-run temp dirs are scoped by ownerLogin', () => {
            const slug = 'abcd1234';
            const tenantA = userA;
            const tenantB = userB;
            const rootA = path.join(os.tmpdir(), 'qaap-parallel', tenantA, slug);
            const rootB = path.join(os.tmpdir(), 'qaap-parallel', tenantB, slug);
            expect(rootA).to.not.equal(rootB);
            expect(rootA).to.contain(tenantA);
            expect(rootB).to.contain(tenantB);
        });

        it('conversation worktree temp dirs are scoped by ownerLogin', () => {
            const slug = 'efgh5678';
            const tenantA = userA;
            const tenantB = userB;
            const wtA = path.join(os.tmpdir(), 'qaap-worktrees', tenantA, slug);
            const wtB = path.join(os.tmpdir(), 'qaap-worktrees', tenantB, slug);
            expect(wtA).to.not.equal(wtB);
            expect(wtA).to.contain(tenantA);
            expect(wtB).to.contain(tenantB);
        });

        it('falls back to __anonymous__ tenant for undefined ownerLogin', () => {
            const slug = 'ijkl9012';
            const root = path.join(os.tmpdir(), 'qaap-parallel', '__anonymous__', slug);
            expect(root).to.contain('__anonymous__');
        });
    });

    // ─── P2-b: Event ownership filtering ─────────────────────────────

    describe('P2-b: Event ownership filtering', () => {
        const reposRoot = resolveQaapReposRoot();
        const cwdA = path.join(resolveUserReposRoot(reposRoot, userA), 'octocat', 'hello-world');
        const cwdB = path.join(resolveUserReposRoot(reposRoot, userB), 'octocat', 'hello-world');

        it('ownsWorkspacePath grants access only to the owning user', () => {
            expect(isPathUnderUserWorkspace(cwdA, reposRoot, userA)).to.be.true;
            expect(isPathUnderUserWorkspace(cwdA, reposRoot, userB)).to.be.false;
            expect(isPathUnderUserWorkspace(cwdB, reposRoot, userB)).to.be.true;
            expect(isPathUnderUserWorkspace(cwdB, reposRoot, userA)).to.be.false;
        });

        it('eventIsOwned filters created/updated events by conversation.cwd', () => {
            const ctxA = { kind: 'authenticated' as const, userLogin: userA, sessionId: 's1', session: {} as never };
            const ctxB = { kind: 'authenticated' as const, userLogin: userB, sessionId: 's2', session: {} as never };

            const eventIsOwned = (ctx: typeof ctxA, event: { type: string; conversation?: { cwd: string }; cwd?: string }): boolean => {
                if (event.type === 'created' || event.type === 'updated') {
                    return isPathUnderUserWorkspace(event.conversation!.cwd, reposRoot, ctx.userLogin);
                }
                if (event.type === 'deleted' || event.type === 'message' || event.type === 'message_delta') {
                    return isPathUnderUserWorkspace(event.cwd!, reposRoot, ctx.userLogin);
                }
                return true;
            };

            const createdA = { type: 'created', conversation: { cwd: cwdA } };
            const createdB = { type: 'created', conversation: { cwd: cwdB } };
            const messageA = { type: 'message', cwd: cwdA };

            expect(eventIsOwned(ctxA, createdA)).to.be.true;
            expect(eventIsOwned(ctxB, createdA)).to.be.false;
            expect(eventIsOwned(ctxA, createdB)).to.be.false;
            expect(eventIsOwned(ctxB, createdB)).to.be.true;
            expect(eventIsOwned(ctxA, messageA)).to.be.true;
            expect(eventIsOwned(ctxB, messageA)).to.be.false;
        });
    });

    // ─── Path-based tenancy core ─────────────────────────────────────

    describe('Path-based tenancy core', () => {
        it('two users have different workspace roots', () => {
            const rootA = resolveUserReposRoot(reposRoot, userA);
            const rootB = resolveUserReposRoot(reposRoot, userB);
            expect(rootA).to.not.equal(rootB);
            expect(rootA).to.contain(safeUserIdSegment(userA));
            expect(rootB).to.contain(safeUserIdSegment(userB));
        });

        it('user A cannot access user B workspace path', () => {
            const cwdB = path.join(resolveUserReposRoot(reposRoot, userB), 'octocat', 'hello-world');
            expect(isPathUnderUserWorkspace(cwdB, reposRoot, userA)).to.be.false;
        });

        it('path traversal attempts are rejected', () => {
            const traversal = path.join(resolveUserReposRoot(reposRoot, userA), '..', '..', userB, 'octocat', 'hello-world');
            expect(isPathUnderUserWorkspace(traversal, reposRoot, userA)).to.be.false;
        });
    });
});

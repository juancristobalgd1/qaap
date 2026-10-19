// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveQaapWorktreesRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapTerminalCwdGuard } from './qaap-terminal-cwd-guard';

describe('QaapTerminalCwdGuard', () => {
    const ENV_KEYS = ['QAAP_REPOS_ROOT', 'QAAP_TENANT_BACKEND_MODE', 'QAAP_TENANT_LOGIN'] as const;
    const savedEnv = new Map<string, string | undefined>(ENV_KEYS.map(key => [key, process.env[key]]));
    let reposRoot: string;
    let aliceRepo: string;
    let bobRepo: string;
    const guard = new QaapTerminalCwdGuard();

    beforeEach(() => {
        reposRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-terminal-cwd-')));
        aliceRepo = path.join(reposRoot, 'users', 'Alice', 'acme', 'app');
        bobRepo = path.join(reposRoot, 'users', 'bob', 'acme', 'secret');
        fs.mkdirSync(aliceRepo, { recursive: true });
        fs.mkdirSync(bobRepo, { recursive: true });
        process.env.QAAP_REPOS_ROOT = reposRoot;
        delete process.env.QAAP_TENANT_BACKEND_MODE;
        delete process.env.QAAP_TENANT_LOGIN;
    });

    afterEach(() => {
        fs.rmSync(reposRoot, { recursive: true, force: true });
        for (const [key, value] of savedEnv) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    });

    it('opens the terminal in a repository the caller owns', () => {
        expect(guard.resolveHostedTerminalCwd(aliceRepo, 'Alice')).to.equal(aliceRepo);
    });

    it('defaults to the caller workspace when the client sends no rootURI', () => {
        expect(guard.resolveHostedTerminalCwd(undefined, 'Alice')).to.equal(path.join(reposRoot, 'users', 'Alice'));
    });

    it('allows the caller own conversation worktrees', () => {
        const worktree = path.join(resolveQaapWorktreesRoot(), 'Alice', 'conversation-1');
        expect(guard.resolveHostedTerminalCwd(worktree, 'Alice')).to.equal(worktree);
    });

    it('refuses another tenant repository chosen through the client rootURI', () => {
        expect(() => guard.resolveHostedTerminalCwd(bobRepo, 'Alice')).to.throw(/restricted to the authenticated tenant/);
    });

    it('refuses an anonymous caller', () => {
        expect(() => guard.resolveHostedTerminalCwd(aliceRepo, undefined)).to.throw(/requires an authenticated tenant/);
        expect(() => guard.resolveHostedTerminalCwd(aliceRepo, '  ')).to.throw(/requires an authenticated tenant/);
    });

    it('refuses paths outside every tenant tree, including traversal', () => {
        expect(() => guard.resolveHostedTerminalCwd('/', 'Alice')).to.throw(/restricted/);
        expect(() => guard.resolveHostedTerminalCwd(os.homedir(), 'Alice')).to.throw(/restricted/);
        expect(() => guard.resolveHostedTerminalCwd(path.join(aliceRepo, '..', '..', '..', 'bob'), 'Alice')).to.throw(/restricted/);
    });

    it('refuses a symlink in the caller tree that points into another tenant', () => {
        const link = path.join(reposRoot, 'users', 'Alice', 'acme', 'link');
        fs.symlinkSync(bobRepo, link);
        expect(() => guard.resolveHostedTerminalCwd(link, 'Alice')).to.throw(/restricted/);
    });

    it('on a tenant backend only accepts the tenant pinned by QAAP_TENANT_LOGIN', () => {
        process.env.QAAP_TENANT_BACKEND_MODE = '1';
        process.env.QAAP_TENANT_LOGIN = 'alice';
        expect(guard.resolveHostedTerminalCwd(aliceRepo, 'Alice')).to.equal(aliceRepo);
        expect(() => guard.resolveHostedTerminalCwd(bobRepo, 'bob')).to.throw(/tenant this backend serves/);
        delete process.env.QAAP_TENANT_LOGIN;
        expect(() => guard.resolveHostedTerminalCwd(aliceRepo, 'Alice')).to.throw(/tenant this backend serves/);
    });
});

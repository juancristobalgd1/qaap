// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import type { Request, Response } from 'express';
import { resolveQaapWorktreesRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { QaapGithubAuthGuard, type QaapGithubAuthContext } from './qaap-github-auth-guard';

class AliceGuard extends QaapGithubAuthGuard {
    override authenticate(): QaapGithubAuthContext {
        return { kind: 'authenticated', userLogin: 'alice' } as unknown as QaapGithubAuthContext;
    }
    override logSecurityEvent(): void {
        // quiet in specs
    }
}

function fakeResponse(): { readonly res: Response; status(): number | undefined } {
    let code: number | undefined;
    const res = {
        status(value: number) {
            code = value;
            return this;
        },
        json() {
            return this;
        },
    } as unknown as Response;
    return { res, status: () => code };
}

describe('QaapGithubAuthGuard.assertWorkspacePathOwned and New Worktree checkouts', () => {

    const created: string[] = [];
    const worktree = (login: string): string => {
        const dir = path.join(resolveQaapWorktreesRoot(), login, `spec-${process.pid}-${created.length}`);
        fs.mkdirSync(dir, { recursive: true });
        created.push(dir);
        return fs.realpathSync(dir);
    };

    after(() => {
        for (const dir of created) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('accepts the caller\'s own worktree (preview claim, upload, review)', () => {
        const target = worktree('alice');
        const response = fakeResponse();
        // Was: 403, so a worktree conversation could not reserve its preview port (staging, 24 Nov 2026).
        expect(new AliceGuard().assertWorkspacePathOwned({} as Request, response.res, target, 'workspace_path')).to.equal(true);
        expect(response.status()).to.equal(undefined);
    });

    it('still refuses another user\'s worktree and paths outside both trees', () => {
        const guard = new AliceGuard();
        const other = fakeResponse();
        expect(guard.assertWorkspacePathOwned({} as Request, other.res, worktree('bob'), 'workspace_path')).to.equal(false);
        expect(other.status()).to.equal(403);
        const outside = fakeResponse();
        expect(guard.assertWorkspacePathOwned({} as Request, outside.res, '/etc', 'workspace_path')).to.equal(false);
        expect(outside.status()).to.equal(403);
    });
});

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { resolveThreadPreviewRoot, resolveThreadPreviewWorktree } from './qaap-thread-preview-root';

const REPO = '/workspace/repos/users/alice/acme/shop';
const WORKTREE = '/tmp/qaap-worktrees/alice/e895ac21';

describe('qaap-thread-preview-root', () => {

    it('keeps the project root for a thread on the main tree', () => {
        const summary = { cwd: REPO };
        expect(resolveThreadPreviewWorktree(summary)).to.equal(undefined);
        expect(resolveThreadPreviewRoot(summary, REPO)).to.equal(REPO);
    });

    it('previews the worktree of an auto-isolated thread instead of the project root', () => {
        const summary = { cwd: WORKTREE, parallelBaseCwd: REPO, worktreeBranch: 'qaap/e895ac21' };
        expect(resolveThreadPreviewWorktree(summary)).to.equal(WORKTREE);
        expect(resolveThreadPreviewRoot(summary, REPO)).to.equal(WORKTREE);
    });

    it('previews the worktree of an isolated fork', () => {
        const summary = { cwd: WORKTREE, parallelBaseCwd: REPO, worktreeBranch: 'qaap/e895ac21', forkedFromId: 'source' };
        expect(resolveThreadPreviewRoot(summary, REPO)).to.equal(WORKTREE);
    });

    it('keeps Run variants on the base workspace', () => {
        const summary = { cwd: WORKTREE, parallelBaseCwd: REPO, worktreeBranch: 'qaap/run-1', parallelRunId: 'run-1' };
        expect(resolveThreadPreviewWorktree(summary)).to.equal(undefined);
        expect(resolveThreadPreviewRoot(summary, REPO)).to.equal(REPO);
        expect(resolveThreadPreviewRoot(summary)).to.equal(REPO);
    });

    it('does not treat a thread without a worktree branch or a distinct base as isolated', () => {
        expect(resolveThreadPreviewRoot({ cwd: WORKTREE, parallelBaseCwd: REPO }, REPO)).to.equal(REPO);
        expect(resolveThreadPreviewRoot({ cwd: WORKTREE, worktreeBranch: 'qaap/x' }, REPO)).to.equal(REPO);
        expect(resolveThreadPreviewRoot({ cwd: REPO, parallelBaseCwd: `${REPO}/`, worktreeBranch: 'qaap/x' }, REPO)).to.equal(REPO);
    });

    it('falls back to the conversation base workspace, then its cwd, without a project root', () => {
        expect(resolveThreadPreviewRoot({ cwd: WORKTREE, parallelBaseCwd: REPO })).to.equal(REPO);
        expect(resolveThreadPreviewRoot({ cwd: REPO })).to.equal(REPO);
        expect(resolveThreadPreviewRoot(undefined, REPO)).to.equal(REPO);
        expect(resolveThreadPreviewRoot(undefined)).to.equal(undefined);
    });
});

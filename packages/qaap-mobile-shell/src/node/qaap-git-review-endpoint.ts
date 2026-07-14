// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { inject, injectable } from '@theia/core/shared/inversify';
import { Application, Request, Response } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
    QAAP_GIT_REVIEW_API_PATH,
    buildSingleHunkPatch,
    computePrReadiness,
    isBinaryGitPatch,
    parseUnifiedDiff,
    type QaapGitChangedFile,
    type QaapGitChangesResponse,
    type QaapGitPrReadiness,
    type QaapGitCommitContextResponse,
    type QaapGitCommitWorkflowAction,
    type QaapGitFileDiffResponse,
    type QaapGitBranchesResponse,
    type QaapGitHistoryCommit,
    type QaapGitHistoryResponse,
} from '../common/qaap-git-review';
import { QaapGithubAuthGuard } from './qaap-github-auth-guard';

/** Diffs can be large; allow up to 16 MB of git output. */
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
/** Keep one expanded file from monopolizing the review response/browser. */
const FILE_DIFF_RESPONSE_LIMIT = 2 * 1024 * 1024;

/**
 * Flags for every git invocation whose stdout is parsed as a unified patch. A host-level
 * `diff.external` / `GIT_EXTERNAL_DIFF` / `.gitattributes` diff driver (difftastic, delta, …)
 * replaces or breaks the patch format — and errors out entirely when the tool is missing on the
 * server — while `color.ui=always` injects ANSI codes the parser reads as context lines. Plumbing
 * calls (`--numstat`, `status --porcelain`) ignore external diff drivers, which is how a broken
 * host config makes `/changes` succeed while every `/diff` fails.
 */
const PATCH_SAFETY_FLAGS = ['--no-ext-diff', '--no-color'] as const;

class QaapGitDiffTooLargeError extends Error {
    constructor(readonly size: number) {
        super(`Text diff is too large to display (${size} bytes; limit ${FILE_DIFF_RESPONSE_LIMIT} bytes). Open the file in the editor.`);
    }
}

/** Max characters of combined diff returned by `commit-context` (roughly 6k tokens for the LLM prompt). */
const COMMIT_CONTEXT_DIFF_LIMIT = 24_000;

/**
 * Exposes read-only `git` working-tree information for the mobile diff-review surface.
 * The agent (or the user) writes to the workspace on disk; this endpoint reports what changed.
 */
@injectable()
export class QaapGitReviewEndpoint implements BackendApplicationContribution {

    @inject(QaapGithubAuthGuard)
    protected readonly auth: QaapGithubAuthGuard;

    configure(app: Application): void {
        app.get(`${QAAP_GIT_REVIEW_API_PATH}/changes`, (req, res) => {
            void this.handleChanges(req, res);
        });
        app.get(`${QAAP_GIT_REVIEW_API_PATH}/diff`, (req, res) => {
            void this.handleDiff(req, res);
        });
        app.get(`${QAAP_GIT_REVIEW_API_PATH}/history`, (req, res) => {
            void this.handleHistory(req, res);
        });
        app.get(`${QAAP_GIT_REVIEW_API_PATH}/branches`, (req, res) => {
            void this.handleBranches(req, res);
        });
        app.post(`${QAAP_GIT_REVIEW_API_PATH}/checkout`, (req, res) => {
            void this.handleCheckout(req, res);
        });
        app.post(`${QAAP_GIT_REVIEW_API_PATH}/stage`, (req, res) => {
            void this.handleStage(req, res);
        });
        app.post(`${QAAP_GIT_REVIEW_API_PATH}/stage-hunk`, (req, res) => {
            void this.handleStageHunk(req, res);
        });
        app.post(`${QAAP_GIT_REVIEW_API_PATH}/discard-hunk`, (req, res) => {
            void this.handleDiscardHunk(req, res);
        });
        app.post(`${QAAP_GIT_REVIEW_API_PATH}/discard`, (req, res) => {
            void this.handleDiscard(req, res);
        });
        app.post(`${QAAP_GIT_REVIEW_API_PATH}/commit-workflow`, (req, res) => {
            void this.handleCommitWorkflow(req, res);
        });
        app.get(`${QAAP_GIT_REVIEW_API_PATH}/commit-context`, (req, res) => {
            void this.handleCommitContext(req, res);
        });
    }

    /** Changed files plus a truncated combined diff — input for AI commit-message generation. */
    protected async handleCommitContext(req: Request, res: Response): Promise<void> {
        const root = await this.resolveRepository(req, res);
        if (!root) {
            return;
        }
        try {
            const [files, branch, diff] = await Promise.all([
                this.collectChangedFiles(root),
                this.readCurrentBranch(root),
                this.collectCommitDiff(root),
            ]);
            const truncated = diff.length > COMMIT_CONTEXT_DIFF_LIMIT;
            res.json({
                root,
                branch,
                files,
                diff: truncated ? diff.slice(0, COMMIT_CONTEXT_DIFF_LIMIT) : diff,
                truncated,
            } satisfies QaapGitCommitContextResponse);
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    /** Combined staged + unstaged diff against HEAD (falls back when the repo has no commits yet). */
    protected async collectCommitDiff(root: string): Promise<string> {
        try {
            return await this.git(root, ['diff', ...PATCH_SAFETY_FLAGS, 'HEAD']);
        } catch {
            const [staged, unstaged] = await Promise.all([
                this.git(root, ['diff', ...PATCH_SAFETY_FLAGS, '--cached']).catch(() => ''),
                this.git(root, ['diff', ...PATCH_SAFETY_FLAGS]).catch(() => ''),
            ]);
            return `${staged}\n${unstaged}`.trim();
        }
    }

    protected async handleChanges(req: Request, res: Response): Promise<void> {
        const root = await this.resolveRepository(req, res);
        if (!root) {
            return;
        }
        try {
            const [files, branch, prReadiness] = await Promise.all([
                this.collectChangedFiles(root),
                this.readCurrentBranch(root),
                this.readPrReadiness(root),
            ]);
            res.json({ root, branch, files, prReadiness } satisfies QaapGitChangesResponse);
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    /** Resolves whether the current branch has committed work worth opening a PR for. */
    protected async readPrReadiness(root: string): Promise<QaapGitPrReadiness | undefined> {
        try {
            const currentBranch = await this.readCurrentBranch(root);
            const defaultBranch = await this.readDefaultBranch(root);
            let aheadCount = 0;
            if (currentBranch && defaultBranch && currentBranch !== defaultBranch) {
                aheadCount = await this.countCommitsAhead(root, defaultBranch);
            }
            return computePrReadiness(currentBranch, defaultBranch, aheadCount);
        } catch {
            return undefined;
        }
    }

    /** Best-effort default branch: origin/HEAD symref, else a local main/master, else undefined. */
    protected async readDefaultBranch(root: string): Promise<string | undefined> {
        try {
            const symref = (await this.git(root, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])).trim();
            if (symref && symref !== 'origin/HEAD') {
                return symref.replace(/^origin\//, '');
            }
        } catch {
            // No remote HEAD; fall through to local defaults.
        }
        for (const candidate of ['main', 'master']) {
            try {
                await this.git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidate}`]);
                return candidate;
            } catch {
                // Not present; try the next.
            }
        }
        return undefined;
    }

    /** Count of commits on HEAD not reachable from the default branch (local ref, else origin/<ref>). */
    protected async countCommitsAhead(root: string, defaultBranch: string): Promise<number> {
        for (const base of [defaultBranch, `origin/${defaultBranch}`]) {
            try {
                const out = (await this.git(root, ['rev-list', '--count', `${base}..HEAD`])).trim();
                const count = Number.parseInt(out, 10);
                if (Number.isFinite(count)) {
                    return count;
                }
            } catch {
                // Base ref not found; try the next form.
            }
        }
        return 0;
    }

    protected async handleStage(req: Request, res: Response): Promise<void> {
        const root = await this.resolveRepositoryBody(req, res);
        if (!root) {
            return;
        }
        const file = this.sanitizeRelativePath(req.body?.file);
        if (!file) {
            res.status(400).json({ error: 'Missing or invalid "file" in request body.' });
            return;
        }
        try {
            await this.git(root, ['add', '--', file]);
            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    protected async handleDiscard(req: Request, res: Response): Promise<void> {
        const root = await this.resolveRepositoryBody(req, res);
        if (!root) {
            return;
        }
        const file = this.sanitizeRelativePath(req.body?.file);
        if (!file) {
            res.status(400).json({ error: 'Missing or invalid "file" in request body.' });
            return;
        }
        try {
            await this.discardFile(root, file);
            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    protected async discardFile(root: string, file: string): Promise<void> {
        const status = await this.readFileStatus(root, file);
        if (status?.indexStatus === '?') {
            await fs.promises.rm(path.join(root, file), { recursive: true, force: true });
        } else if (status) {
            const paths = status.oldPath ? [file, status.oldPath] : [file];
            try {
                await this.git(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...paths]);
            } catch {
                // Unborn repository: a staged addition has no HEAD version to restore.
                await this.git(root, ['rm', '--cached', '--ignore-unmatch', '--', ...paths]);
                for (const candidate of paths) {
                    await fs.promises.rm(path.join(root, candidate), { recursive: true, force: true });
                }
            }
        }
    }

    protected async handleCommitWorkflow(req: Request, res: Response): Promise<void> {
        const root = await this.resolveRepositoryBody(req, res);
        if (!root) {
            return;
        }
        const action = req.body?.action as QaapGitCommitWorkflowAction | undefined;
        const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
        const branchName = this.sanitizeBranchName(req.body?.branchName);
        if (!action || !this.isCommitWorkflowAction(action)) {
            res.status(400).json({ error: 'Missing or invalid "action" in request body.' });
            return;
        }
        if (!message) {
            res.status(400).json({ error: 'Missing or invalid "message" in request body.' });
            return;
        }
        if (this.requiresNewBranch(action) && !branchName) {
            res.status(400).json({ error: 'Missing or invalid "branchName" for this action.' });
            return;
        }
        try {
            if (branchName) {
                await this.git(root, ['checkout', '-b', branchName]);
            }
            await this.git(root, ['add', '-A']);
            await this.git(root, ['commit', '-m', message]);
            const stat = await this.readLastCommitStat(root);
            if (this.shouldPush(action)) {
                await this.pushCurrentBranch(root);
            }
            res.json({ ok: true, action, branch: branchName ?? await this.readCurrentBranch(root), stat });
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    protected isCommitWorkflowAction(value: string): value is QaapGitCommitWorkflowAction {
        return value === 'create-branch-commit'
            || value === 'create-branch-commit-push'
            || value === 'commit-push'
            || value === 'commit'
            || value === 'commit-create-pr';
    }

    protected requiresNewBranch(action: QaapGitCommitWorkflowAction): boolean {
        return action === 'create-branch-commit' || action === 'create-branch-commit-push';
    }

    protected shouldPush(action: QaapGitCommitWorkflowAction): boolean {
        return action === 'create-branch-commit-push'
            || action === 'commit-push'
            || action === 'commit-create-pr';
    }

    protected async pushCurrentBranch(root: string): Promise<void> {
        try {
            await this.git(root, ['rev-parse', '--abbrev-ref', '@{u}']);
            await this.git(root, ['push']);
        } catch {
            const branch = (await this.git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
            await this.git(root, ['push', '-u', 'origin', branch]);
        }
    }

    protected sanitizeBranchName(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        const trimmed = value.trim();
        if (!trimmed || trimmed.includes('..') || /[\s~^:?*[\]\\]/.test(trimmed)) {
            return undefined;
        }
        return trimmed;
    }

    protected async resolveRepositoryBody(req: Request, res: Response): Promise<string | undefined> {
        const raw = typeof req.body?.root === 'string' ? req.body.root : '';
        return this.resolveRepositoryRoot(raw, req, res);
    }

    /** Validate the client-supplied repository root and confirm it is a git work tree. */
    protected async resolveRepository(req: Request, res: Response): Promise<string | undefined> {
        const raw = typeof req.query.root === 'string' ? req.query.root : '';
        return this.resolveRepositoryRoot(raw, req, res);
    }

    protected async resolveRepositoryRoot(raw: string, req: Request, res: Response): Promise<string | undefined> {
        const root = raw ? path.resolve(raw) : '';
        if (!root || !path.isAbsolute(root) || !this.isExistingDirectory(root)) {
            res.status(400).json({ error: 'Missing or invalid "root" query parameter.' });
            return undefined;
        }
        if (!this.auth.assertWorkspacePathOwned(req, res, root, 'git_review')) {
            return undefined;
        }
        try {
            const inside = (await this.git(root, ['rev-parse', '--is-inside-work-tree'])).trim();
            if (inside !== 'true') {
                throw new Error('not a work tree');
            }
        } catch {
            res.status(400).json({ error: 'The given root is not a git repository.' });
            return undefined;
        }
        return root;
    }

    protected async handleDiff(req: Request, res: Response): Promise<void> {
        const root = await this.resolveRepository(req, res);
        if (!root) {
            return;
        }
        const file = this.sanitizeRelativePath(req.query.file);
        if (!file) {
            res.status(400).json({ error: 'Missing or invalid "file" query parameter.' });
            return;
        }
        try {
            const patch = await this.computeFileDiff(root, file);
            const hunks = parseUnifiedDiff(patch);
            const binary = isBinaryGitPatch(patch);
            const metadataOnlyUntracked = !patch.trim() && await this.isMetadataOnlyUntrackedFile(root, file);
            if (!binary && hunks.length === 0 && !patch.trim() && !metadataOnlyUntracked) {
                res.status(409).json({ error: 'Git reports this file as changed, but returned no diff data. Refresh and retry.' });
                return;
            }
            res.json({
                path: file,
                binary,
                kind: binary ? 'binary' : hunks.length > 0 ? 'text' : 'metadata',
                hunks,
            } satisfies QaapGitFileDiffResponse);
        } catch (error) {
            // Per-file diff failures are invisible in the UI accordion — leave a server-side trace
            // so a hosted deployment's journal shows which git invocation failed and why.
            console.warn('[qaap-git-review] diff failed', JSON.stringify({ root, file, error: this.errorMessage(error) }));
            res.status(error instanceof QaapGitDiffTooLargeError ? 413 : 500).json({ error: this.errorMessage(error) });
        }
    }

    protected async handleHistory(req: Request, res: Response): Promise<void> {
        const root = await this.resolveRepository(req, res);
        if (!root) {
            return;
        }
        try {
            const [branch, commits] = await Promise.all([
                this.readCurrentBranch(root),
                this.collectHistory(root),
            ]);
            res.json({ root, branch, commits } satisfies QaapGitHistoryResponse);
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    protected async handleBranches(req: Request, res: Response): Promise<void> {
        const root = await this.resolveRepository(req, res);
        if (!root) {
            return;
        }
        try {
            const [current, branches] = await Promise.all([
                this.readCurrentBranch(root),
                this.listLocalBranches(root),
            ]);
            res.json({ root, current, branches } satisfies QaapGitBranchesResponse);
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    protected async handleCheckout(req: Request, res: Response): Promise<void> {
        const root = await this.resolveRepositoryBody(req, res);
        if (!root) {
            return;
        }
        const branch = this.sanitizeBranchName(req.body?.branch);
        if (!branch) {
            res.status(400).json({ error: 'Missing or invalid "branch" in request body.' });
            return;
        }
        try {
            await this.git(root, ['checkout', branch]);
            res.json({ ok: true, branch: await this.readCurrentBranch(root) ?? branch });
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    protected async collectChangedFiles(root: string): Promise<QaapGitChangedFile[]> {
        const status = await this.git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
        const counts = await this.combinedNumstat(root);
        const files: QaapGitChangedFile[] = [];
        const entries = status.split('\0');
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            if (entry.length < 4) {
                continue;
            }
            const indexStatus = entry[0];
            const worktreeStatus = entry[1];
            const filePath = entry.slice(3);
            const renamed = indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C';
            const oldPath = renamed ? entries[++index] : undefined;
            const untracked = indexStatus === '?';
            const isStaged = !untracked && indexStatus !== ' ' && worktreeStatus === ' ';
            const stats = counts.get(filePath);
            files.push({
                path: filePath,
                ...(oldPath ? { oldPath } : {}),
                status: untracked ? 'U' : (worktreeStatus !== ' ' ? worktreeStatus : indexStatus),
                adds: stats?.adds ?? (untracked ? await this.countLines(root, filePath) : 0),
                dels: stats?.dels ?? 0,
                staged: isStaged,
            });
        }
        return files;
    }

    /** Diff the final working-tree state against HEAD, including staged and unstaged edits together. */
    protected async computeFileDiff(root: string, file: string): Promise<string> {
        const status = await this.readFileStatus(root, file);
        // Include both sides so Git's rename detection is not suppressed by a one-sided pathspec.
        const pathspec = status?.oldPath ? [status.oldPath, file] : [file];
        let trackedPatch = '';
        try {
            trackedPatch = await this.git(root, ['diff', ...PATCH_SAFETY_FLAGS, 'HEAD', '--', ...pathspec]);
        } catch {
            // Unborn repository: combine index and worktree patches below.
            const [staged, unstaged] = await Promise.all([
                this.git(root, ['diff', ...PATCH_SAFETY_FLAGS, '--cached', '--', ...pathspec]).catch(() => ''),
                this.git(root, ['diff', ...PATCH_SAFETY_FLAGS, '--', ...pathspec]).catch(() => ''),
            ]);
            trackedPatch = `${staged}\n${unstaged}`.trim();
        }
        if (trackedPatch.trim()) {
            return this.enforceFileDiffLimit(trackedPatch);
        }
        if (status?.indexStatus !== '?') {
            return trackedPatch;
        }
        // Untracked file — diff against /dev/null so the whole file shows as added.
        try {
            return this.enforceFileDiffLimit(await this.git(root, ['diff', ...PATCH_SAFETY_FLAGS, '--no-index', '--', '/dev/null', file]));
        } catch (error) {
            // `git diff --no-index` exits 1 when files differ; its stdout still holds the patch.
            const stdout = (error as { stdout?: string }).stdout;
            if (typeof stdout === 'string' && stdout.trim()) {
                return this.enforceFileDiffLimit(stdout);
            }
            // Git treats a symlink-to-directory as a directory in --no-index mode and emits no
            // patch. It is still a legitimate metadata-only untracked entry, like an empty file.
            if (await this.isMetadataOnlyUntrackedFile(root, file)) {
                return '';
            }
            throw error;
        }
    }

    protected enforceFileDiffLimit(patch: string): string {
        const size = Buffer.byteLength(patch, 'utf8');
        if (size > FILE_DIFF_RESPONSE_LIMIT) {
            throw new QaapGitDiffTooLargeError(size);
        }
        return patch;
    }

    /** Stats against the same final tree shown by /diff; fallback supports repositories without HEAD. */
    protected async combinedNumstat(root: string): Promise<Map<string, { adds: number; dels: number }>> {
        try {
            return await this.numstat(root, ['diff', '--numstat', '-z', 'HEAD']);
        } catch {
            const [unstaged, staged] = await Promise.all([
                this.numstat(root, ['diff', '--numstat', '-z']).catch(() => new Map()),
                this.numstat(root, ['diff', '--cached', '--numstat', '-z']).catch(() => new Map()),
            ]);
            for (const [file, value] of staged) {
                const current = unstaged.get(file);
                unstaged.set(file, {
                    adds: value.adds + (current?.adds ?? 0),
                    dels: value.dels + (current?.dels ?? 0),
                });
            }
            return unstaged;
        }
    }

    protected async readFileStatus(root: string, file: string): Promise<{
        indexStatus: string;
        worktreeStatus: string;
        oldPath?: string;
    } | undefined> {
        const entries = (await this.git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])).split('\0');
        for (let index = 0; index < entries.length; index++) {
            const entry = entries[index];
            if (entry.length < 4) {
                continue;
            }
            const indexStatus = entry[0];
            const worktreeStatus = entry[1];
            const renamed = indexStatus === 'R' || indexStatus === 'C' || worktreeStatus === 'R' || worktreeStatus === 'C';
            const oldPath = renamed ? entries[++index] : undefined;
            if (entry.slice(3) === file) {
                return { indexStatus, worktreeStatus, ...(oldPath ? { oldPath } : {}) };
            }
        }
        return undefined;
    }

    protected async isMetadataOnlyUntrackedFile(root: string, file: string): Promise<boolean> {
        const status = await this.readFileStatus(root, file);
        if (status?.indexStatus !== '?') {
            return false;
        }
        try {
            const stat = await fs.promises.lstat(path.join(root, file));
            return stat.isSymbolicLink() || (stat.isFile() && stat.size === 0);
        } catch {
            return false;
        }
    }

    protected async collectHistory(root: string): Promise<QaapGitHistoryCommit[]> {
        const format = '%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%D%x1e';
        const out = await this.git(root, ['log', '--decorate=short', '--date=iso-strict', `--pretty=format:${format}`, '-n', '80']);
        return out.split('\x1e')
            .map(entry => entry.trim())
            .filter(Boolean)
            .map(entry => {
                const [hash = '', shortHash = '', subject = '', authorName = '', authorEmail = '', authoredAt = '', refsRaw = ''] = entry.split('\x1f');
                return {
                    hash,
                    shortHash,
                    subject,
                    authorName,
                    authorEmail,
                    authoredAt,
                    refs: refsRaw.split(',').map(ref => ref.trim()).filter(Boolean),
                };
            });
    }

    protected async readCurrentBranch(root: string): Promise<string | undefined> {
        try {
            const name = (await this.git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
            return name && name !== 'HEAD' ? name : undefined;
        } catch {
            return undefined;
        }
    }

    /** Files changed + insertions/deletions of the just-created HEAD commit, for commit feedback. */
    protected async readLastCommitStat(root: string): Promise<{ files: number; insertions: number; deletions: number } | undefined> {
        try {
            // --numstat with an empty format prints only "<added>\t<deleted>\t<path>" rows for HEAD.
            const out = await this.git(root, ['show', '--numstat', '--format=', 'HEAD']);
            let files = 0;
            let insertions = 0;
            let deletions = 0;
            for (const line of out.split('\n')) {
                const parts = line.trim().split('\t');
                if (parts.length < 3) {
                    continue;
                }
                files += 1;
                // Binary files report "-"; count them as a changed file but add 0 lines.
                insertions += Number.parseInt(parts[0], 10) || 0;
                deletions += Number.parseInt(parts[1], 10) || 0;
            }
            return { files, insertions, deletions };
        } catch {
            return undefined;
        }
    }

    protected async listLocalBranches(root: string): Promise<string[]> {
        try {
            const out = await this.git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
            return out.split('\n').map(line => line.trim()).filter(Boolean);
        } catch {
            return [];
        }
    }

    protected async numstat(root: string, args: string[]): Promise<Map<string, { adds: number; dels: number }>> {
        const out = await this.git(root, args);
        const map = new Map<string, { adds: number; dels: number }>();
        // `-z` numstat output: "adds\tdels\t" followed by a NUL-terminated path.
        const tokens = out.split('\0');
        for (let i = 0; i < tokens.length; i++) {
            const match = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(tokens[i]);
            if (!match) {
                continue;
            }
            let filePath = match[3];
            if (!filePath && i + 1 < tokens.length) {
                // Rename/copy under -z: counts, NUL, old path, NUL, new path, NUL.
                const oldPath = tokens[++i];
                filePath = i + 1 < tokens.length ? tokens[++i] : oldPath;
            }
            map.set(filePath, {
                adds: match[1] === '-' ? 0 : Number(match[1]),
                dels: match[2] === '-' ? 0 : Number(match[2]),
            });
        }
        return map;
    }

    protected async countLines(root: string, file: string): Promise<number> {
        try {
            const content = await fs.promises.readFile(path.join(root, file), 'utf8');
            return content ? content.split('\n').length : 0;
        } catch {
            return 0;
        }
    }

    protected git(root: string, args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile('git', args, { cwd: root, maxBuffer: GIT_MAX_BUFFER }, (error, stdout) => {
                if (error) {
                    reject(Object.assign(error, { stdout }));
                } else {
                    resolve(stdout);
                }
            });
        });
    }

    /** Run git feeding `input` on stdin (for `git apply -`). Rejects with stderr on non-zero exit. */
    protected gitStdin(root: string, args: string[], input: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = execFile('git', args, { cwd: root, maxBuffer: GIT_MAX_BUFFER }, (error, stdout, stderr) => {
                if (error) {
                    reject(Object.assign(error, { stdout, stderr }));
                } else {
                    resolve(stdout);
                }
            });
            child.stdin?.end(input);
        });
    }

    /** Stage or discard a single hunk by index, from the authoritative unstaged diff of the file. */
    protected async applyFileHunk(root: string, file: string, hunkIndex: number, mode: 'stage' | 'discard'): Promise<boolean> {
        // Working-tree-vs-index diff for the file; -U3 keeps enough context for a clean apply.
        const diffText = await this.git(root, ['diff', ...PATCH_SAFETY_FLAGS, '-U3', '--', file]);
        const patch = buildSingleHunkPatch(diffText, hunkIndex);
        if (!patch) {
            return false;
        }
        // Stage: apply the hunk to the index. Discard: reverse-apply it to the working tree.
        // --recount lets git fix up line numbers so a slightly stale hunk index still applies.
        const args = mode === 'stage'
            ? ['apply', '--cached', '--recount', '-']
            : ['apply', '--reverse', '--recount', '-'];
        await this.gitStdin(root, args, patch);
        return true;
    }

    protected async handleStageHunk(req: Request, res: Response): Promise<void> {
        return this.handleHunkAction(req, res, 'stage');
    }

    protected async handleDiscardHunk(req: Request, res: Response): Promise<void> {
        return this.handleHunkAction(req, res, 'discard');
    }

    protected async handleHunkAction(req: Request, res: Response, mode: 'stage' | 'discard'): Promise<void> {
        const root = await this.resolveRepositoryBody(req, res);
        if (!root) {
            return;
        }
        const file = this.sanitizeRelativePath(req.body?.file);
        const hunkIndex = Number(req.body?.hunkIndex);
        if (!file || !Number.isInteger(hunkIndex) || hunkIndex < 0) {
            res.status(400).json({ error: 'Missing or invalid "file"/"hunkIndex" in request body.' });
            return;
        }
        try {
            const applied = await this.applyFileHunk(root, file, hunkIndex, mode);
            if (!applied) {
                res.status(409).json({ error: 'Hunk no longer exists — the file changed. Refresh the diff.' });
                return;
            }
            res.json({ ok: true });
        } catch (error) {
            res.status(500).json({ error: this.errorMessage(error) });
        }
    }

    /** Reject absolute paths and parent-directory traversal so git stays inside the repo. */
    protected sanitizeRelativePath(value: unknown): string | undefined {
        if (typeof value !== 'string' || !value) {
            return undefined;
        }
        const normalized = value.replace(/\\/g, '/');
        if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
            return undefined;
        }
        return normalized;
    }

    protected isExistingDirectory(target: string): boolean {
        try {
            return fs.statSync(target).isDirectory();
        } catch {
            return false;
        }
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}

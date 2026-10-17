// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node';
import { nls } from '@theia/core/lib/common/nls';
import { isQaapHostedEnvironment } from '@theia/qaap-adapters/lib/common/qaap-hosted-runtime';
import type { QaapTaskPullRequest } from '@theia/qaap-shared-core/lib/common/qaap-task-pull-request';
import {
    addGithubIssueLabels,
    createGithubPullRequest,
    fetchGithubPullRequestRecord,
    fetchGithubRepository,
    removeGithubIssueLabel,
    setGithubPullRequestDraft,
    updateGithubPullRequest,
    type QaapGithubPullRequestRecord,
} from '@theia/qaap-shared-core/lib/node/qaap-github-api';
import { QaapGithubSessionStore } from '@theia/qaap-shared-core/lib/node/qaap-github-session-store';
import { QaapHostedGitPush } from '@theia/qaap-shared-core/lib/node/qaap-hosted-git-push';
import { QaapHostedProjectResolver } from '@theia/qaap-shared-core/lib/node/qaap-hosted-project-resolver';
import type { QaapAgentConversation, QaapAgentConversationEvent, QaapAgentMessage, QaapConversationCheckpoint } from '../common/qaap-agent-conversation';
import { isGoalLoopActive } from '../common/qaap-agent-goal-loop';
import type { QaapAgentTask } from '../common/qaap-agent-task';
import {
    buildTaskPullRequestEvidenceSection,
    buildTaskPullRequestTitle,
    isTaskPullRequestRed,
    mergeTaskPullRequestBody,
    QAAP_TASK_PR_ATTENTION_LABEL,
    type QaapTaskPullRequestBodyInput,
    type QaapTaskPullRequestScreenshot,
} from '../common/qaap-task-pull-request-body';
import { QaapAgentConversationStore } from './qaap-agent-conversation-store';
import { VISUAL_EVIDENCE_DIR } from './qaap-agent-conversation-store-constants';
import { runGitAsync, type QaapGitRunResult } from './qaap-agent-conversation-store-git';
import type { QaapTaskPullRequestRecordOptions } from './qaap-agent-conversation-store-task-pr';

/** Default quiet period before a settled conversation is turned into (or pushed to) its pull request. */
export const QAAP_TASK_PR_DEFAULT_DEBOUNCE_MS = 10_000;
/** Screenshots published per pull request (the newest ones). */
const MAX_SCREENSHOTS = 6;
const EVIDENCE_ID = /visual-verifications\/([a-f\d-]{36})(?!\.webm)/gi;

/** Where a task branch goes: a GitHub project (hosted push) or, in the local e2e mode only, a bare remote. */
export interface QaapTaskPullRequestDestination {
    readonly owner: string;
    readonly repo: string;
    /** Real objects directory of the project clone (hosted push reads it as an alternate). */
    readonly objectsDirectory?: string;
    /** Local bare repository path; only ever set in {@link QaapTaskPullRequestService.isTestMode}. */
    readonly localRemote?: string;
}

/** The GitHub REST calls the service makes; replaced wholesale by specs. */
export interface QaapTaskPullRequestGithub {
    createPull(
        token: string,
        input: { owner: string; repo: string; title: string; head: string; base: string; body: string; draft: boolean },
    ): Promise<QaapGithubPullRequestRecord>;
    getPull(token: string, owner: string, repo: string, pullNumber: number): Promise<QaapGithubPullRequestRecord>;
    updatePull(token: string, input: { owner: string; repo: string; number: number; title: string; body: string }): Promise<QaapGithubPullRequestRecord>;
    addLabel(token: string, owner: string, repo: string, pullNumber: number, label: string): Promise<void>;
    removeLabel(token: string, owner: string, repo: string, pullNumber: number, label: string): Promise<void>;
    setDraft(token: string, nodeId: string, draft: boolean): Promise<void>;
    isPrivate(token: string, owner: string, repo: string): Promise<boolean>;
}

const DEFAULT_GITHUB: QaapTaskPullRequestGithub = {
    createPull: (token, input) => createGithubPullRequest(token, input),
    getPull: (token, owner, repo, pullNumber) => fetchGithubPullRequestRecord(token, owner, repo, pullNumber),
    updatePull: (token, input) => updateGithubPullRequest(token, input),
    addLabel: (token, owner, repo, pullNumber, label) => addGithubIssueLabels(token, owner, repo, pullNumber, [label]),
    removeLabel: (token, owner, repo, pullNumber, label) => removeGithubIssueLabel(token, owner, repo, pullNumber, label),
    setDraft: (token, nodeId, draft) => setGithubPullRequestDraft(token, nodeId, draft),
    isPrivate: async (token, owner, repo) => (await fetchGithubRepository(token, owner, repo)).private,
};

/** One user turn with the checkpoints that bracket it. */
interface QaapTaskTurn {
    readonly userMessage: QaapAgentMessage;
    readonly pre: QaapConversationCheckpoint;
    readonly post: QaapConversationCheckpoint;
}

/**
 * Turns finished chat tasks into GitHub pull requests with evidence (roadmap H3.1/H3.2, see
 * `doc/qaap-task-to-pr.md`). When a conversation has been quiet (idle, nothing queued, no goal loop,
 * no run) for {@link QAAP_TASK_PR_DEFAULT_DEBOUNCE_MS}, its new turns are replayed from their pre/post
 * checkpoints onto `qaap/task/<conversationId>` with `git merge-tree` — so dirty files that predate a
 * turn and other threads never reach the PR — pushed with the owner's token (never the agent's), and
 * one PR per conversation is opened or updated. The PR body carries the summary, diffstat, checks,
 * reviewer verdict and screenshots between `<!-- qaap:evidence -->` markers; a red turn makes it a
 * labelled draft and the conversation lands in "Needs you".
 *
 * `QAAP_TASK_PR=0|off|false` disables it. Without a token, a GitHub project checkout or a change it
 * does nothing; failures are recorded on the conversation, never swallowed.
 */
@injectable()
export class QaapTaskPullRequestService implements BackendApplicationContribution {

    @inject(QaapAgentConversationStore)
    protected readonly store: QaapAgentConversationStore;

    @inject(QaapGithubSessionStore) @optional()
    protected readonly sessions: QaapGithubSessionStore | undefined;

    @inject(QaapHostedGitPush) @optional()
    protected readonly hostedPush: QaapHostedGitPush | undefined;

    @inject(QaapHostedProjectResolver) @optional()
    protected readonly projectResolver: QaapHostedProjectResolver | undefined;

    protected github: QaapTaskPullRequestGithub = DEFAULT_GITHUB;

    protected readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    protected readonly chains = new Map<string, Promise<void>>();
    protected readonly skipLogged = new Set<string>();

    @postConstruct()
    protected init(): void {
        if (!this.isEnabled()) {
            return;
        }
        this.store.onDidChange(event => this.onConversationEvent(event));
    }

    /** Bound as a contribution only so it is instantiated (and subscribed) at startup. */
    initialize(): void {
        // The store subscription happens in init().
    }

    /** `QAAP_TASK_PR` is on unless set to `0`, `off`, `false` or `no`. */
    isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
        const value = env.QAAP_TASK_PR?.trim().toLowerCase();
        return !value || !['0', 'off', 'false', 'no'].includes(value);
    }

    /**
     * Local e2e only: skip-auth, `QAAP_CLOUD_MODE=local`, not hosted, not production, and an explicit
     * `QAAP_TASK_PR_TEST_TOKEN`. Then the token comes from that variable and the branch may go to a local
     * bare `origin`. A hosted deployment can never reach this path.
     */
    isTestMode(env: NodeJS.ProcessEnv = process.env): boolean {
        const skipAuth = env.QAAP_SKIP_AUTH === 'true' || env.QAAP_SKIP_AUTH === '1';
        return skipAuth
            && env.QAAP_CLOUD_MODE?.trim().toLowerCase() === 'local'
            && env.NODE_ENV !== 'production'
            && !isQaapHostedEnvironment(env)
            && !!env.QAAP_TASK_PR_TEST_TOKEN?.trim();
    }

    protected debounceMs(): number {
        const configured = Number.parseInt(process.env.QAAP_TASK_PR_DEBOUNCE_MS?.trim() ?? '', 10);
        return Number.isInteger(configured) && configured >= 0 ? configured : QAAP_TASK_PR_DEFAULT_DEBOUNCE_MS;
    }

    protected onConversationEvent(event: QaapAgentConversationEvent): void {
        if (event.type === 'deleted') {
            this.clearTimer(event.conversationId);
            return;
        }
        if (event.type === 'updated' || event.type === 'created') {
            this.schedule(event.conversation.id);
        }
    }

    /** (Re)starts the quiet-period timer of `conversationId`. */
    schedule(conversationId: string): void {
        this.clearTimer(conversationId);
        const timer = setTimeout(() => {
            this.timers.delete(conversationId);
            void this.sync(conversationId);
        }, this.debounceMs());
        timer.unref?.();
        this.timers.set(conversationId, timer);
    }

    protected clearTimer(conversationId: string): void {
        const timer = this.timers.get(conversationId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(conversationId);
        }
    }

    /** Serialized per conversation; resolves once this sync (and the ones before it) finished. */
    sync(conversationId: string): Promise<void> {
        const previous = this.chains.get(conversationId) ?? Promise.resolve();
        const next = previous.then(() => this.syncNow(conversationId)).catch(error => {
            console.warn('[qaap-task-pr] sync failed unexpectedly:', error);
        });
        this.chains.set(conversationId, next);
        void next.finally(() => {
            if (this.chains.get(conversationId) === next) {
                this.chains.delete(conversationId);
            }
        });
        return next;
    }

    /** Idle, nothing queued, no goal loop, no run, and not a read-only (plan / ask) thread. */
    isQuiescent(conv: QaapAgentConversation): boolean {
        if (conv.status !== 'idle' || (conv.pendingUserMessages?.length ?? 0) > 0 || isGoalLoopActive(conv)) {
            return false;
        }
        if (conv.interactionModeId === 'plan' || conv.interactionModeId === 'ask') {
            return false;
        }
        return this.store.getActiveTaskIdsForConversation(conv.id).length === 0;
    }

    protected async syncNow(conversationId: string): Promise<void> {
        const conv = this.store.get(conversationId);
        if (!conv || conv.archived || !this.isQuiescent(conv)) {
            return;
        }
        const state = conv.taskPullRequest;
        const turns = this.collectNewTurns(conv, state?.lastUserMessageId);
        const evidenceIds = this.collectEvidenceIds(conv);
        const latestTask = this.latestTask(conv);
        const bodyInputBase = this.bodyInput(conv, latestTask);
        const wantsRed = isTaskPullRequestRed(bodyInputBase);
        const isRed = state?.state === 'draft-needs-attention';
        const evidenceChanged = evidenceIds.join(',') !== (state?.evidenceIds ?? []).join(',');
        if (turns.length === 0 && (!state || (state.number && !state.lastError && wantsRed === isRed && !evidenceChanged))) {
            return;
        }
        const token = this.resolveToken(conv);
        if (!token) {
            this.logSkipOnce(conversationId, 'no GitHub token for the conversation owner');
            return;
        }
        const destination = await this.resolveDestination(conv);
        if (!destination) {
            this.logSkipOnce(conversationId, 'the checkout is not a GitHub project clone');
            return;
        }
        const branch = `qaap/task/${conversationId}`;
        let current: QaapTaskPullRequest = state ?? {
            owner: destination.owner,
            repo: destination.repo,
            branch,
            state: 'open',
            updatedAt: Date.now(),
        };
        try {
            const built = await this.buildBranchHead(conv, current, turns);
            const conflictReason = built?.conflict ? nls.localize('qaap/taskPullRequest/traceConflict',
                'the latest turn conflicts with {0} ({1}) and was not pushed', branch, built.conflict) : undefined;
            if (conflictReason && state?.lastError === conflictReason) {
                return;
            }
            if (conflictReason && !state?.headSha) {
                this.record(conversationId, { ...current, state: 'draft-needs-attention', lastError: conflictReason, updatedAt: Date.now() }, {
                    traceNote: nls.localize('qaap/taskPullRequest/traceFailed', 'Task pull request was not updated: {0}', conflictReason),
                });
                return;
            }
            if (!built) {
                // Nothing reached the branch yet (every turn left the tree as it was).
                if (!state?.number) {
                    return;
                }
            } else {
                current = { ...current, ...built.base, lastUserMessageId: built.lastUserMessageId };
                if (built.head !== current.headSha) {
                    await this.pushCommit(destination, token, built.head, `refs/heads/${branch}`, conv.cwd);
                    current = { ...current, headSha: built.head };
                }
            }
            const conflict = built?.conflict;
            if (current.repoPrivate === undefined) {
                current = { ...current, repoPrivate: await this.github.isPrivate(token, destination.owner, destination.repo).catch(() => false) };
            }
            const screenshots = await this.publishScreenshots(conv, current, destination, token, evidenceIds);
            current = { ...current, ...screenshots.state };
            const bodyInput: QaapTaskPullRequestBodyInput = {
                ...bodyInputBase,
                diffstat: await this.diffstat(conv.cwd, current.baseSha, current.headSha),
                ...(conflict ? { conflict } : {}),
                screenshots: screenshots.links,
                ...(screenshots.omittedReason ? { screenshotsOmittedReason: screenshots.omittedReason } : {}),
            };
            const red = isTaskPullRequestRed(bodyInput);
            current = await this.upsertPullRequest(conv, current, token, bodyInput, red);
            current = { ...current, state: red ? 'draft-needs-attention' : 'open', lastError: conflictReason, updatedAt: Date.now() };
            this.record(conversationId, current, {
                ...(current.number ? {
                    linkedPullRequest: {
                        owner: current.owner,
                        repo: current.repo,
                        number: current.number,
                        branch,
                        title: buildTaskPullRequestTitle(conv.title, red),
                        state: 'open' as const,
                        draft: red,
                    },
                } : {}),
                ...(conflictReason ? { traceNote: nls.localize('qaap/taskPullRequest/traceFailed', 'Task pull request was not updated: {0}', conflictReason) } : {}),
            });
        } catch (error) {
            const reason = this.describeError(error);
            if (state?.lastError === reason) {
                return;
            }
            this.record(conversationId, { ...current, lastError: reason, updatedAt: Date.now() }, {
                traceNote: nls.localize('qaap/taskPullRequest/traceFailed', 'Task pull request was not updated: {0}', reason),
            });
        }
    }

    protected record(conversationId: string, taskPullRequest: QaapTaskPullRequest, options: QaapTaskPullRequestRecordOptions): void {
        this.store.recordTaskPullRequest(conversationId, taskPullRequest, options);
    }

    /** Turns after `afterUserMessageId` that have both a pre-turn and a post-turn checkpoint. */
    protected collectNewTurns(conv: QaapAgentConversation, afterUserMessageId: string | undefined): QaapTaskTurn[] {
        const users = conv.messages.filter(message => message.role === 'user');
        const startIndex = afterUserMessageId ? users.findIndex(message => message.id === afterUserMessageId) + 1 : 0;
        const checkpoints = conv.checkpoints ?? [];
        const turns: QaapTaskTurn[] = [];
        let previousPost: QaapConversationCheckpoint | undefined;
        for (let index = 0; index < users.length; index++) {
            const user = users[index];
            const post = [...checkpoints].reverse().find(checkpoint => checkpoint.messageId === user.id && checkpoint.kind !== 'pre-turn'
                && !checkpoint.restoredFrom && !!checkpoint.commit);
            const pre = [...checkpoints].reverse().find(checkpoint => checkpoint.messageId === user.id && checkpoint.kind === 'pre-turn' && !!checkpoint.commit)
                ?? previousPost;
            if (index >= startIndex && post && pre) {
                turns.push({ userMessage: user, pre, post });
            }
            previousPost = post ?? previousPost;
        }
        return turns;
    }

    /**
     * Replays `turns` onto the branch tip (or the remote base branch the first time): for each turn,
     * `merge-tree --merge-base=<pre> <tip> <post>` keeps exactly what that turn changed. Returns
     * `undefined` when no turn changed anything and the branch does not exist yet.
     */
    protected async buildBranchHead(conv: QaapAgentConversation, state: QaapTaskPullRequest, turns: readonly QaapTaskTurn[]): Promise<{
        head: string;
        base: Pick<QaapTaskPullRequest, 'baseBranch' | 'baseSha'>;
        lastUserMessageId?: string;
        conflict?: string;
    } | undefined> {
        const cwd = conv.cwd;
        return this.store.runSerializedGit(cwd, async () => {
            let base: Pick<QaapTaskPullRequest, 'baseBranch' | 'baseSha'> = { baseBranch: state.baseBranch, baseSha: state.baseSha };
            let tip = state.headSha;
            if (!tip) {
                const resolved = await this.resolveBaseBranch(cwd);
                base = resolved;
                tip = resolved.baseSha;
            }
            let lastUserMessageId = state.lastUserMessageId;
            let conflict: string | undefined;
            for (const turn of turns) {
                if (await this.sameTree(cwd, turn.pre.commit, turn.post.commit)) {
                    lastUserMessageId = turn.userMessage.id;
                    continue;
                }
                const merged = await this.git(cwd, ['merge-tree', '--write-tree', `--merge-base=${turn.pre.commit}`, tip, turn.post.commit]);
                if (merged.status === 1) {
                    conflict = this.conflictSummary(merged.stdout);
                    break;
                }
                const tree = merged.stdout.split('\n')[0]?.trim();
                if (merged.status !== 0 || !/^[0-9a-f]{40,64}$/.test(tree ?? '')) {
                    throw new Error(`git merge-tree failed: ${(merged.stderr || merged.stdout).trim().slice(0, 300)}`);
                }
                if (!(await this.sameTree(cwd, tip, tree))) {
                    tip = await this.commitTree(cwd, tree, tip, this.commitMessage(conv, turn.userMessage));
                }
                lastUserMessageId = turn.userMessage.id;
            }
            if (tip === base.baseSha && !state.headSha) {
                return conflict ? { head: tip, base, lastUserMessageId, conflict } : undefined;
            }
            await this.git(cwd, ['update-ref', `refs/qaap/task-pr/${conv.id}`, tip]);
            return { head: tip, base, lastUserMessageId, ...(conflict ? { conflict } : {}) };
        });
    }

    /** `origin/HEAD` (else `origin/main`, `origin/master`) as `{ baseBranch, baseSha }`. */
    protected async resolveBaseBranch(cwd: string): Promise<{ baseBranch: string; baseSha: string }> {
        const symbolic = await this.git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
        const candidates = [
            ...(symbolic.status === 0 ? [symbolic.stdout.trim()] : []),
            'refs/remotes/origin/main',
            'refs/remotes/origin/master',
        ];
        for (const ref of candidates) {
            if (!ref.startsWith('refs/remotes/origin/')) {
                continue;
            }
            const sha = await this.git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
            if (sha.status === 0 && sha.stdout.trim()) {
                return { baseBranch: ref.slice('refs/remotes/origin/'.length), baseSha: sha.stdout.trim() };
            }
        }
        throw new Error(nls.localize('qaap/taskPullRequest/noBase', 'the checkout has no origin default branch to open the pull request against'));
    }

    protected async sameTree(cwd: string, left: string, right: string): Promise<boolean> {
        const result = await this.git(cwd, ['rev-parse', `${left}^{tree}`, `${right}^{tree}`]);
        const [a, b] = result.stdout.trim().split('\n');
        return result.status === 0 && !!a && a === b;
    }

    protected async commitTree(cwd: string, tree: string, parent: string, message: string): Promise<string> {
        const name = process.env.QAAP_GIT_USER_NAME?.trim() || 'Qaap';
        const email = process.env.QAAP_GIT_USER_EMAIL?.trim() || 'qaap@local';
        const result = await this.git(cwd, ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit-tree', tree, '-p', parent, '-m', message]);
        const sha = result.stdout.trim();
        if (result.status !== 0 || !/^[0-9a-f]{40,64}$/.test(sha)) {
            throw new Error(`git commit-tree failed: ${result.stderr.trim().slice(0, 300)}`);
        }
        return sha;
    }

    protected commitMessage(conv: QaapAgentConversation, userMessage: QaapAgentMessage): string {
        const request = (userMessage.content ?? '').replace(/\s+/g, ' ').trim();
        const subject = request.length > 72 ? `${request.slice(0, 71)}…` : request || conv.title;
        return `${subject}\n\nQaap task ${conv.id}`;
    }

    protected conflictSummary(stdout: string): string {
        const files = stdout.split('\n').slice(1)
            .map(line => /^CONFLICT \([^)]*\): .* in (.+)$/.exec(line.trim())?.[1] ?? /^\d+ [0-9a-f]+ \d\t(.+)$/.exec(line)?.[1])
            .filter((file): file is string => !!file);
        const unique = [...new Set(files)].slice(0, 10);
        return unique.length ? unique.join(', ') : 'merge conflict';
    }

    protected async diffstat(cwd: string, baseSha: string | undefined, headSha: string | undefined): Promise<string | undefined> {
        if (!baseSha || !headSha) {
            return undefined;
        }
        const result = await this.git(cwd, ['--no-pager', 'diff', '--no-color', '--no-ext-diff', '--stat=100', baseSha, headSha]);
        return result.status === 0 ? result.stdout.trimEnd() : undefined;
    }

    protected latestTask(conv: QaapAgentConversation): QaapAgentTask | undefined {
        const lastUser = [...conv.messages].reverse().find(message => message.role === 'user' && message.taskId);
        return lastUser?.taskId ? this.store.taskRunner.list().find(task => task.id === lastUser.taskId) : undefined;
    }

    protected bodyInput(conv: QaapAgentConversation, task: QaapAgentTask | undefined): QaapTaskPullRequestBodyInput {
        const lastAgent = [...conv.messages].reverse().find(message => message.role === 'agent');
        const summary = lastAgent?.content?.trim()
            || (lastAgent?.segments ?? []).filter(segment => segment.type === 'text').map(segment => segment.content ?? '').join('\n').trim();
        return {
            summary,
            ...(task?.verification ? { verification: task.verification } : {}),
            ...(task?.review ? { review: task.review } : {}),
            ...(task ? { taskState: task.state } : {}),
        };
    }

    /** Opens the conversation's PR or rewrites its evidence section; keeps draft state and label in step with `red`. */
    protected async upsertPullRequest(
        conv: QaapAgentConversation,
        state: QaapTaskPullRequest,
        token: string,
        bodyInput: QaapTaskPullRequestBodyInput,
        red: boolean,
    ): Promise<QaapTaskPullRequest> {
        const section = buildTaskPullRequestEvidenceSection(bodyInput);
        const title = buildTaskPullRequestTitle(conv.title, red);
        if (!state.headSha || !state.baseBranch) {
            return state;
        }
        let record: QaapGithubPullRequestRecord;
        if (!state.number) {
            record = await this.github.createPull(token, {
                owner: state.owner, repo: state.repo, title, head: state.branch, base: state.baseBranch, body: section, draft: red,
            });
            if (red) {
                await this.github.addLabel(token, state.owner, state.repo, record.number, QAAP_TASK_PR_ATTENTION_LABEL);
            }
        } else {
            const existing = await this.github.getPull(token, state.owner, state.repo, state.number);
            record = await this.github.updatePull(token, {
                owner: state.owner, repo: state.repo, number: state.number, title, body: mergeTaskPullRequestBody(existing.body, section),
            });
            if (red) {
                await this.github.addLabel(token, state.owner, state.repo, state.number, QAAP_TASK_PR_ATTENTION_LABEL);
            } else if (state.state === 'draft-needs-attention') {
                await this.github.removeLabel(token, state.owner, state.repo, state.number, QAAP_TASK_PR_ATTENTION_LABEL);
            }
            const nodeId = existing.nodeId ?? state.nodeId;
            if (nodeId && existing.state === 'open' && existing.draft !== red) {
                await this.github.setDraft(token, nodeId, red);
            }
        }
        return { ...state, number: record.number, url: record.url, ...(record.nodeId ? { nodeId: record.nodeId } : {}) };
    }

    /** Evidence ids (PNG screenshots) referenced by the conversation, oldest first, newest {@link MAX_SCREENSHOTS}. */
    protected collectEvidenceIds(conv: QaapAgentConversation): string[] {
        const ids: string[] = [];
        for (const message of conv.messages) {
            for (const match of (message.content ?? '').matchAll(EVIDENCE_ID)) {
                const id = match[1].toLowerCase();
                if (!ids.includes(id) && fs.existsSync(path.join(this.evidenceDirectory(conv.id), `${id}.png`))) {
                    ids.push(id);
                }
            }
        }
        return ids.slice(-MAX_SCREENSHOTS);
    }

    protected evidenceDirectory(conversationId: string): string {
        return path.join(VISUAL_EVIDENCE_DIR, conversationId);
    }

    /**
     * Pushes the screenshots as a commit on `refs/qaap/evidence/<conversationId>` (parent: the previous
     * evidence commit), built in a backend-owned bare repository so the PNGs never enter the project's
     * object store, the diff or the branch list. Public repositories get no screenshots unless
     * `QAAP_TASK_PR_PUBLIC_SCREENSHOTS=1`: a capture can leak data.
     */
    protected async publishScreenshots(
        conv: QaapAgentConversation,
        state: QaapTaskPullRequest,
        destination: QaapTaskPullRequestDestination,
        token: string,
        evidenceIds: readonly string[],
    ): Promise<{ state: Pick<QaapTaskPullRequest, 'evidenceSha' | 'evidenceIds'>; links: QaapTaskPullRequestScreenshot[]; omittedReason?: string }> {
        const keep = { evidenceSha: state.evidenceSha, evidenceIds: state.evidenceIds };
        if (evidenceIds.length === 0) {
            return { state: keep, links: [] };
        }
        if (!state.repoPrivate && process.env.QAAP_TASK_PR_PUBLIC_SCREENSHOTS !== '1') {
            return {
                state: { evidenceSha: state.evidenceSha, evidenceIds: [...evidenceIds] }, links: [],
                omittedReason: nls.localize('qaap/taskPullRequest/screenshotsPublic',
                    'Screenshots are not published on public repositories; open the task in Qaap to see them.'),
            };
        }
        let evidenceSha = state.evidenceSha;
        if (!evidenceSha || evidenceIds.join(',') !== (state.evidenceIds ?? []).join(',')) {
            evidenceSha = await this.commitEvidence(conv.id, evidenceIds, state.evidenceSha);
            await this.pushEvidence(destination, token, conv.id, evidenceSha);
        }
        const links = evidenceIds.map((id, index) => ({
            url: `https://github.com/${state.owner}/${state.repo}/raw/${evidenceSha}/screenshots/${id}.png`,
            label: nls.localize('qaap/taskPullRequest/screenshotLabel', 'Preview {0}', String(index + 1)),
        }));
        return { state: { evidenceSha, evidenceIds: [...evidenceIds] }, links };
    }

    protected evidenceRepository(conversationId: string): string {
        return path.join(path.dirname(VISUAL_EVIDENCE_DIR), 'task-pr-evidence', `${conversationId}.git`);
    }

    protected async commitEvidence(conversationId: string, evidenceIds: readonly string[], parent: string | undefined): Promise<string> {
        const gitDir = this.evidenceRepository(conversationId);
        if (!fs.existsSync(path.join(gitDir, 'objects'))) {
            await fs.promises.mkdir(path.dirname(gitDir), { recursive: true, mode: 0o700 });
            await this.backendGit(['init', '--bare', '--quiet', gitDir]);
        }
        const index = path.join(os.tmpdir(), `qaap-task-pr-evidence-${randomUUID()}.index`);
        const env = { ...process.env, GIT_INDEX_FILE: index };
        try {
            for (const id of evidenceIds) {
                const blob = (await this.backendGit(['--git-dir', gitDir, 'hash-object', '-w', path.join(this.evidenceDirectory(conversationId), `${id}.png`)])).trim();
                await this.backendGit(['--git-dir', gitDir, 'update-index', '--add', '--cacheinfo', `100644,${blob},screenshots/${id}.png`], env);
            }
            const tree = (await this.backendGit(['--git-dir', gitDir, 'write-tree'], env)).trim();
            const hasParent = !!parent && (await runGitAsync('git', ['--git-dir', gitDir, 'cat-file', '-e', `${parent}^{commit}`], { cwd: os.tmpdir(), timeoutMs: 10_000 })).status === 0;
            const commit = (await this.backendGit(['--git-dir', gitDir, '-c', 'user.name=Qaap', '-c', 'user.email=qaap@local', 'commit-tree', tree,
                ...(hasParent && parent ? ['-p', parent] : []), '-m', `Qaap task ${conversationId} evidence`])).trim();
            await this.backendGit(['--git-dir', gitDir, 'update-ref', `refs/qaap/evidence/${conversationId}`, commit]);
            return commit;
        } finally {
            await fs.promises.rm(index, { force: true }).catch(() => undefined);
        }
    }

    protected async pushEvidence(destination: QaapTaskPullRequestDestination, token: string, conversationId: string, sha: string): Promise<void> {
        const gitDir = this.evidenceRepository(conversationId);
        const ref = `refs/qaap/evidence/${conversationId}`;
        if (destination.localRemote) {
            await this.backendGit(['--git-dir', gitDir, 'push', '--quiet', destination.localRemote, `${sha}:${ref}`]);
            return;
        }
        if (!this.hostedPush) {
            throw new Error('hosted push is not available');
        }
        await this.hostedPush.push({
            objectsDirectory: path.join(gitDir, 'objects'),
            url: `https://github.com/${destination.owner}/${destination.repo}.git`,
            sha,
            ref,
            token,
        });
    }

    /** Pushes `sha` from the project checkout to `ref`: hosted push with the owner's token, or a plain push to the e2e bare remote. */
    protected async pushCommit(destination: QaapTaskPullRequestDestination, token: string, sha: string, ref: string, cwd: string): Promise<void> {
        if (destination.localRemote) {
            const pushed = await this.git(cwd, ['push', '--quiet', '--force', destination.localRemote, `${sha}:${ref}`]);
            if (pushed.status !== 0) {
                throw new Error(`git push failed: ${pushed.stderr.trim().slice(0, 300)}`);
            }
            return;
        }
        if (!this.hostedPush || !destination.objectsDirectory) {
            throw new Error('hosted push is not available');
        }
        await this.hostedPush.push({
            objectsDirectory: destination.objectsDirectory,
            url: `https://github.com/${destination.owner}/${destination.repo}.git`,
            sha,
            ref,
            token,
        });
    }

    /** The owner's GitHub token (by login, request-less); the test token only in {@link isTestMode}. */
    protected resolveToken(conv: QaapAgentConversation): string | undefined {
        if (this.isTestMode()) {
            return process.env.QAAP_TASK_PR_TEST_TOKEN?.trim();
        }
        return this.sessions?.findAccessTokenForLogin(conv.ownerLogin);
    }

    /**
     * The GitHub project of the checkout, from backend-held state only ({@link QaapHostedProjectResolver}).
     * In {@link isTestMode} a local bare `origin` (`…/<owner>/<repo>.git`) is accepted as well.
     */
    protected async resolveDestination(conv: QaapAgentConversation): Promise<QaapTaskPullRequestDestination | undefined> {
        if (this.isTestMode()) {
            return this.resolveLocalTestRemote(conv.cwd);
        }
        if (!this.projectResolver) {
            return undefined;
        }
        return this.projectResolver.resolve(conv.ownerLogin, conv.cwd, async (cwd, args) => {
            const result = await this.git(cwd, args);
            if (result.status !== 0) {
                throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
            }
            return result.stdout;
        });
    }

    protected async resolveLocalTestRemote(cwd: string): Promise<QaapTaskPullRequestDestination | undefined> {
        const url = (await this.git(cwd, ['remote', 'get-url', 'origin'])).stdout.trim();
        const remote = url.startsWith('file://') ? url.slice('file://'.length) : url;
        if (!path.isAbsolute(remote) || !remote.endsWith('.git') || !fs.existsSync(path.join(remote, 'objects'))) {
            return undefined;
        }
        const repo = path.basename(remote, '.git');
        const owner = path.basename(path.dirname(remote));
        return { owner, repo, localRemote: remote };
    }

    /** Git in the project checkout, as the tenant (the store's hardened runner). */
    protected git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<QaapGitRunResult> {
        return this.store.mutatingGit(cwd, args, env);
    }

    /** Git as the backend uid on backend-owned directories (the evidence repository). */
    protected async backendGit(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
        const result = await runGitAsync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: os.tmpdir(), env: env ?? process.env, timeoutMs: 60_000 });
        if (result.status !== 0) {
            throw new Error(`git ${args.find(arg => !arg.startsWith('-') && !arg.includes('/')) ?? ''} failed: ${result.stderr.trim().slice(0, 300)}`);
        }
        return result.stdout;
    }

    protected describeError(error: unknown): string {
        const message = error instanceof Error ? error.message : String(error);
        return message.replace(/\s+/g, ' ').trim().slice(0, 400) || 'unknown error';
    }

    protected logSkipOnce(conversationId: string, reason: string): void {
        const key = `${conversationId}:${reason}`;
        if (!this.skipLogged.has(key)) {
            this.skipLogged.add(key);
            console.info(`[qaap-task-pr] ${conversationId}: skipped, ${reason}.`);
        }
    }
}

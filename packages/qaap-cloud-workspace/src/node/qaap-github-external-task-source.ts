// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import {
    createGithubIssueComment,
    fetchGithubIssue,
    fetchGithubIssueComment,
    fetchGithubIssueLabelEvents,
    fetchGithubRepositoryAccess,
    GithubApiError,
} from '@theia/qaap-shared-core/lib/node/qaap-github-api';
import {
    buildExternalTaskStatusComment,
    normalizeExternalTaskText,
    QAAP_EXTERNAL_TASK_GITHUB_LABEL,
    QAAP_EXTERNAL_TASK_TRUSTED_ASSOCIATIONS,
    type QaapExternalTaskOrigin,
    type QaapExternalTaskStatus,
    type QaapExternalTaskTriggerEvent,
} from '../common/qaap-external-task';
import type { QaapExternalTaskSource, QaapExternalTaskVerification } from './qaap-external-task-source';

/** The GitHub calls, swappable in specs. */
export interface QaapGithubExternalTaskApi {
    repositoryAccess: typeof fetchGithubRepositoryAccess;
    issue: typeof fetchGithubIssue;
    issueComment: typeof fetchGithubIssueComment;
    labelEvents: typeof fetchGithubIssueLabelEvents;
    createComment: typeof createGithubIssueComment;
}

const DEFAULT_API: QaapGithubExternalTaskApi = {
    repositoryAccess: fetchGithubRepositoryAccess,
    issue: fetchGithubIssue,
    issueComment: fetchGithubIssueComment,
    labelEvents: fetchGithubIssueLabelEvents,
    createComment: createGithubIssueComment,
};

function sameLogin(left: string | undefined, right: string | undefined): boolean {
    return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

/**
 * GitHub issues as a task source: an `issues.labeled` (`qaap`) or `issue_comment.created` (`@qaap …`)
 * delivery, confirmed with the requester's own token before anything runs.
 */
@injectable()
export class QaapGithubExternalTaskSource implements QaapExternalTaskSource {

    readonly id = 'github' as const;

    protected api: QaapGithubExternalTaskApi = DEFAULT_API;

    async verify(event: QaapExternalTaskTriggerEvent, token: string): Promise<QaapExternalTaskVerification> {
        try {
            // Bound by id: a forged or stale payload naming a renamed / recreated repository does not match.
            const access = await this.api.repositoryAccess(token, event.owner, event.repo);
            if (access.id !== event.repositoryId) {
                return { ok: false, reason: 'not-confirmed', detail: 'repository id differs' };
            }
            if (!access.push) {
                return { ok: false, reason: 'no-push-permission' };
            }
            const issue = await this.api.issue(token, event.owner, event.repo, event.issueNumber);
            if (issue.pullRequest) {
                return { ok: false, reason: 'not-confirmed', detail: 'a pull request' };
            }
            // The prompt uses the signed snapshot; refuse when GitHub now holds other text (edited after the trigger,
            // or a forged payload), so the requester never authorizes text they did not see.
            if (normalizeExternalTaskText(issue.title) !== normalizeExternalTaskText(event.issueTitle)
                || normalizeExternalTaskText(issue.body) !== normalizeExternalTaskText(event.issueBody)) {
                return { ok: false, reason: 'issue-edited' };
            }
            // CI of the pushed branch runs the agent's code with the repository's secrets before any review: text by
            // someone without write access never becomes a prompt (doc/qaap-external-task-inputs.md, "CI").
            if (!sameLogin(issue.authorLogin, event.requester) && !QAAP_EXTERNAL_TASK_TRUSTED_ASSOCIATIONS.includes(issue.authorAssociation)) {
                return { ok: false, reason: 'untrusted-author', detail: issue.authorAssociation };
            }
            if (event.trigger === 'label') {
                const events = await this.api.labelEvents(token, event.owner, event.repo, event.issueNumber);
                const labelled = events.some(candidate => candidate.label.toLowerCase() === QAAP_EXTERNAL_TASK_GITHUB_LABEL
                    && sameLogin(candidate.actorLogin, event.requester));
                return labelled ? { ok: true } : { ok: false, reason: 'not-confirmed', detail: 'no qaap label event by the requester' };
            }
            if (!event.comment) {
                return { ok: false, reason: 'not-confirmed', detail: 'no comment' };
            }
            const comment = await this.api.issueComment(token, event.owner, event.repo, event.comment.id);
            if (!sameLogin(comment.authorLogin, event.requester)) {
                return { ok: false, reason: 'not-confirmed', detail: 'comment author differs' };
            }
            if (normalizeExternalTaskText(comment.body) !== normalizeExternalTaskText(event.comment.body) || comment.createdAt !== comment.updatedAt) {
                return { ok: false, reason: 'issue-edited', detail: 'comment edited' };
            }
            return { ok: true };
        } catch (error) {
            if (error instanceof GithubApiError && (error.status === 403 || error.status === 404) && !error.rateLimited) {
                return { ok: false, reason: 'not-confirmed', detail: `GitHub ${error.status}` };
            }
            return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : String(error) };
        }
    }

    async postStatus(origin: QaapExternalTaskOrigin, token: string, status: QaapExternalTaskStatus): Promise<void> {
        await this.api.createComment(token, origin.owner, origin.repo, origin.issueNumber, buildExternalTaskStatusComment(status, origin));
    }
}

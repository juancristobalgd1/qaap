// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as http from 'http';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { QAAP_SKIP_AUTH_USER_LOGIN, resolveQaapReposRoot, resolveUserReposRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';
import { createQaapTenantBackendAssertion, QAAP_TENANT_BACKEND_ASSERTION_HEADER } from '@theia/qaap-adapters/lib/common/qaap-tenant-backend-auth';
import { QaapGithubSessionStore, type QaapGithubStoredSession } from '@theia/qaap-shared-core/lib/node/qaap-github-session-store';
import type { QaapGithubWebhookDelivery, QaapGithubWebhookListener } from '@theia/qaap-shared-core/lib/node/qaap-github-webhook-listener';
import {
    parseGithubExternalTaskTrigger,
    QAAP_EXTERNAL_TASK_INTAKE_PATH,
    QAAP_EXTERNAL_TASK_SIGNATURE_HEADER,
    type QaapExternalTaskIntakeRequest,
    type QaapExternalTaskRefusal,
    type QaapExternalTaskTriggerEvent,
} from '../common/qaap-external-task';
import { QaapDockerOrchestrator } from './qaap-docker-orchestrator';
import { signQaapExternalTaskIntake } from './qaap-external-task-intake-signature';
import { QaapExternalTaskLauncher } from './qaap-external-task-launcher';
import { QaapGithubExternalTaskSource } from './qaap-github-external-task-source';
import { QaapTaskPullRequestService } from './qaap-task-pull-request-service';
import { QaapTenantActivityTracker } from './qaap-tenant-activity-tracker';

/** `QAAP_EXTERNAL_TASKS_GITHUB=1` turns GitHub issue tasks on (off by default). */
export function isQaapExternalTasksGithubEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return /^(1|true|on|yes)$/i.test(env.QAAP_EXTERNAL_TASKS_GITHUB?.trim() ?? '');
}

/** `QAAP_EXTERNAL_TASKS_REPO_ALLOWLIST`: comma-separated `owner/repo` or `owner/*`; unset allows every repository. */
export function isExternalTaskRepositoryAllowed(owner: string, repo: string, env: NodeJS.ProcessEnv = process.env): boolean {
    const raw = env.QAAP_EXTERNAL_TASKS_REPO_ALLOWLIST?.trim();
    if (!raw) {
        return true;
    }
    const full = `${owner}/${repo}`.toLowerCase();
    return raw.split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean)
        .some(entry => entry === full || (entry.endsWith('/*') && entry.slice(0, -2) === owner.toLowerCase()));
}

function positiveInt(raw: string | undefined, fallback: number): number {
    const value = Number.parseInt(raw?.trim() ?? '', 10);
    return Number.isInteger(value) && value > 0 ? value : fallback;
}

const HOUR_MS = 60 * 60 * 1000;
const DELIVERY_CACHE_SIZE = 5000;
/** Refusals the requester can act on; the others (possibly forged, transient) are only logged. */
const TOLD_REFUSALS: ReadonlySet<QaapExternalTaskRefusal> = new Set(['no-push-permission', 'untrusted-author', 'issue-edited']);

/**
 * Control-plane side of external tasks (doc/qaap-external-task-inputs.md): receives every verified GitHub
 * webhook delivery, keeps the ones that ask for a task, identifies the requester (a Qaap user with a live
 * session), applies the operator allowlist and the rate limits BEFORE waking any tenant, confirms the
 * request with the GitHub API as the requester, and hands it to the requester's backend.
 */
@injectable()
export class QaapExternalTaskIntake implements QaapGithubWebhookListener {

    @inject(QaapGithubSessionStore)
    protected readonly sessions: QaapGithubSessionStore;

    @inject(QaapGithubExternalTaskSource)
    protected readonly github: QaapGithubExternalTaskSource;

    @inject(QaapTaskPullRequestService)
    protected readonly pullRequests: QaapTaskPullRequestService;

    @inject(QaapExternalTaskLauncher)
    protected readonly launcher: QaapExternalTaskLauncher;

    @inject(QaapDockerOrchestrator) @optional()
    protected readonly docker: QaapDockerOrchestrator | undefined;

    @inject(QaapTenantActivityTracker) @optional()
    protected readonly activity: QaapTenantActivityTracker | undefined;

    /** A cache in front of the durable dedup in the requester's backend. */
    protected readonly recentDeliveries = new Map<string, number>();
    protected readonly requesterHits = new Map<string, number[]>();
    protected readonly repositoryHits = new Map<string, number[]>();

    async onGithubWebhook(delivery: QaapGithubWebhookDelivery): Promise<void> {
        if (!isQaapExternalTasksGithubEnabled()) {
            return;
        }
        const parsed = parseGithubExternalTaskTrigger(delivery.event, delivery.deliveryId, delivery.payload);
        if (parsed.kind === 'ignored') {
            return;
        }
        await this.accept(parsed.event);
    }

    /** Everything after parsing; returns what happened, for logs and specs. */
    async accept(event: QaapExternalTaskTriggerEvent, now: number = Date.now()): Promise<string> {
        const label = `delivery ${event.deliveryId} (${event.owner}/${event.repo}#${event.issueNumber}, @${event.requester})`;
        if (!this.rememberDelivery(event.deliveryId, now)) {
            return this.log(label, 'duplicate');
        }
        const requester = this.resolveRequester(event.requester);
        if (!requester) {
            // Not a Qaap user (or no live session): stay silent, the webhook is not an oracle.
            return this.log(label, 'ignored: not a Qaap user');
        }
        if (!isExternalTaskRepositoryAllowed(event.owner, event.repo)) {
            return this.log(label, 'ignored: repository not in QAAP_EXTERNAL_TASKS_REPO_ALLOWLIST');
        }
        if (!this.withinRateLimits(requester.login, `${event.owner}/${event.repo}`, now)) {
            return this.log(label, 'ignored: rate limited');
        }
        const verified = await this.github.verify(event, requester.token);
        if (!verified.ok) {
            if (TOLD_REFUSALS.has(verified.reason)) {
                await this.dispatch(requester, { kind: 'refused', requester: requester.login, event, reason: verified.reason });
            }
            return this.log(label, `refused: ${verified.reason}${verified.detail ? ` (${verified.detail})` : ''}`);
        }
        const result = await this.dispatch(requester, { kind: 'launch', requester: requester.login, event });
        return this.log(label, `dispatched: ${result}`);
    }

    protected log(label: string, outcome: string): string {
        console.info(`[qaap-external-task] ${label}: ${outcome}`);
        return outcome;
    }

    protected rememberDelivery(deliveryId: string, now: number): boolean {
        for (const [id, at] of this.recentDeliveries) {
            if (now - at < 24 * HOUR_MS && this.recentDeliveries.size < DELIVERY_CACHE_SIZE) {
                break;
            }
            this.recentDeliveries.delete(id);
        }
        if (this.recentDeliveries.has(deliveryId)) {
            return false;
        }
        this.recentDeliveries.set(deliveryId, now);
        return true;
    }

    /** The requester's login (as Qaap knows it), token and session, or `undefined` for anyone without a live session. */
    protected resolveRequester(login: string): { login: string; token: string; session?: QaapGithubStoredSession } | undefined {
        if (this.pullRequests.isTestMode()) {
            // Local e2e only (skip-auth, local, never hosted): the single local user with the test token.
            const token = this.pullRequests.resolveOwnerToken(QAAP_SKIP_AUTH_USER_LOGIN);
            return token && login.toLowerCase() === QAAP_SKIP_AUTH_USER_LOGIN ? { login: QAAP_SKIP_AUTH_USER_LOGIN, token } : undefined;
        }
        const wanted = login.toLowerCase();
        const session = this.sessions.listSessions().find(candidate => candidate.user.provider === 'github'
            && candidate.user.login.toLowerCase() === wanted && !!candidate.accessToken);
        return session ? { login: session.user.login, token: session.accessToken, session } : undefined;
    }

    /**
     * `QAAP_EXTERNAL_TASKS_MAX_PER_HOUR` (10) per requester and `QAAP_EXTERNAL_TASKS_MAX_PER_REPO_HOUR` (20) per
     * repository, counted on every trigger that reaches the GitHub check.
     */
    protected withinRateLimits(login: string, repository: string, now: number): boolean {
        const perRequester = positiveInt(process.env.QAAP_EXTERNAL_TASKS_MAX_PER_HOUR, 10);
        const perRepository = positiveInt(process.env.QAAP_EXTERNAL_TASKS_MAX_PER_REPO_HOUR, 20);
        const requesterKey = login.toLowerCase();
        const repositoryKey = repository.toLowerCase();
        const recent = (hits: Map<string, number[]>, key: string): number[] => (hits.get(key) ?? []).filter(at => now - at < HOUR_MS);
        const requesterRecent = recent(this.requesterHits, requesterKey);
        const repositoryRecent = recent(this.repositoryHits, repositoryKey);
        if (requesterRecent.length >= perRequester || repositoryRecent.length >= perRepository) {
            this.requesterHits.set(requesterKey, requesterRecent);
            this.repositoryHits.set(repositoryKey, repositoryRecent);
            return false;
        }
        this.requesterHits.set(requesterKey, [...requesterRecent, now]);
        this.repositoryHits.set(repositoryKey, [...repositoryRecent, now]);
        return true;
    }

    /** In-process in a shared backend; otherwise a signed call to the requester's tenant backend. */
    protected async dispatch(requester: { login: string; token: string; session?: QaapGithubStoredSession }, request: QaapExternalTaskIntakeRequest): Promise<string> {
        if (!this.docker?.isBackendPerTenantEnabled()) {
            return (await this.launcher.launch(request)).status;
        }
        if (!requester.session) {
            return 'no session for the tenant assertion';
        }
        const body = JSON.stringify(request);
        const root = resolveUserReposRoot(resolveQaapReposRoot(), requester.login);
        const target = await this.docker.ensureTenantBackend(requester.login, root);
        this.activity?.touch(requester.login, 'agent');
        const secret = this.docker.getTenantBackendAssertionSecret(requester.login);
        const assertion = createQaapTenantBackendAssertion({
            tenantLogin: requester.login,
            user: requester.session.user,
            githubAccessToken: requester.token,
        }, secret);
        const signature = signQaapExternalTaskIntake(secret, requester.login, request.event.deliveryId, body);
        return new Promise<string>(resolve => {
            const upstream = http.request({
                host: target.host,
                port: target.port,
                method: 'POST',
                path: QAAP_EXTERNAL_TASK_INTAKE_PATH,
                headers: {
                    host: `${target.host}:${target.port}`,
                    'content-type': 'application/json',
                    'content-length': String(Buffer.byteLength(body)),
                    [QAAP_TENANT_BACKEND_ASSERTION_HEADER]: assertion,
                    [QAAP_EXTERNAL_TASK_SIGNATURE_HEADER]: signature,
                },
                timeout: 60_000,
            }, response => {
                let text = '';
                response.setEncoding('utf8');
                response.on('data', chunk => { text += chunk; });
                response.on('end', () => resolve(`tenant HTTP ${response.statusCode} ${text.slice(0, 200)}`));
            });
            upstream.on('timeout', () => upstream.destroy(new Error('tenant intake timed out')));
            upstream.on('error', error => resolve(`tenant intake failed: ${error.message}`));
            upstream.end(body);
        });
    }
}

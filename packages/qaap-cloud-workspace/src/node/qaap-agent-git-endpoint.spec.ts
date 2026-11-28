// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import type { Request, Response } from '@theia/core/shared/express';
import type { QaapHostedGitPushRequest } from '@theia/qaap-shared-core/lib/node/qaap-hosted-git-push';
import type { QaapHostedProject } from '@theia/qaap-shared-core/lib/node/qaap-hosted-project-resolver';
import { QAAP_AGENT_GIT_TOKEN_HEADER } from '../common/qaap-agent-git-protocol';
import { QaapAgentGitEndpoint } from './qaap-agent-git-endpoint';
import { QaapToolGateTokenService } from './qaap-tool-gate-token-service';

class TestableAgentGitEndpoint extends QaapAgentGitEndpoint {
    branch = 'feat/demo';
    sha = 'a'.repeat(40);
    defaultBranch = 'master';
    pushed: QaapHostedGitPushRequest[] = [];
    prs: Array<{ token: string; input: Record<string, unknown> }> = [];
    overrideEnv: NodeJS.ProcessEnv = {};

    async callPush(req: Request, res: Response): Promise<void> {
        try {
            await this.handlePush(req, res);
        } catch (error) {
            this.sendError(res, error);
        }
    }

    async callPr(req: Request, res: Response): Promise<void> {
        try {
            await this.handlePr(req, res);
        } catch (error) {
            this.sendError(res, error);
        }
    }

    protected override async runReadOnlyGit(_cwd: string, args: string[]): Promise<string> {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
            return `${this.branch}\n`;
        }
        if (args[0] === 'rev-parse' && args[1] === '--verify') {
            return `${this.sha}\n`;
        }
        return '';
    }

    protected override async fetchRepositoryMeta(): Promise<{ defaultBranch?: string }> {
        return { defaultBranch: this.defaultBranch };
    }

    protected override async createPullRequest(
        token: string,
        input: { owner: string; repo: string; title: string; head: string; base: string; body: string; draft: boolean },
    ): ReturnType<QaapAgentGitEndpoint['createPullRequest']> {
        this.prs.push({ token, input });
        return {
            number: 42,
            url: `https://github.com/${input.owner}/${input.repo}/pull/42`,
            nodeId: 'PR_42',
            body: input.body,
            draft: input.draft,
            state: 'open',
            merged: false,
        };
    }

    protected override env(): NodeJS.ProcessEnv {
        return this.overrideEnv;
    }
}

function makeReq(token: string | undefined, body: unknown = {}): Request {
    return {
        body,
        header: (name: string) => name.toLowerCase() === QAAP_AGENT_GIT_TOKEN_HEADER ? token : undefined,
    } as unknown as Request;
}

function makeRes(): { statusCode: number; body: unknown; res: Response } {
    const out = { statusCode: 200, body: undefined as unknown };
    const res = {
        headersSent: false,
        status(code: number) {
            out.statusCode = code;
            return res;
        },
        json(payload: unknown) {
            out.body = payload;
            (res as { headersSent: boolean }).headersSent = true;
            return res;
        },
    } as unknown as Response;
    return { get statusCode() { return out.statusCode; }, get body() { return out.body; }, res };
}

describe('QaapAgentGitEndpoint', () => {
    const project: QaapHostedProject = {
        owner: 'octo',
        repo: 'demo',
        objectsDirectory: '/repos/users/alice/octo/demo/.git/objects',
    };

    function createHarness(options: {
        readonly readOnly?: boolean;
        readonly ownerToken?: string;
        readonly resolvedProject?: QaapHostedProject | undefined;
    } = {}): {
        endpoint: TestableAgentGitEndpoint;
        tokens: QaapToolGateTokenService;
        gitToken: string;
        gateToken: string;
        linkedPrs: unknown[];
    } {
        const tokens = new QaapToolGateTokenService();
        const gitToken = tokens.issueAgentGit('t1', 'alice', '/repos/users/alice/octo/demo');
        const gateToken = tokens.issue('t1', 'alice', '/repos/users/alice/octo/demo');
        const linkedPrs: unknown[] = [];
        const endpoint = new TestableAgentGitEndpoint();
        Object.assign(endpoint, {
            tokens,
            store: {
                findTaskById: (id: string) => id === 't1'
                    ? { id: 't1', cwd: '/repos/users/alice/octo/demo', ownerLogin: 'alice', readOnlyWorkspace: options.readOnly === true }
                    : undefined,
                taskToConversation: new Map([['t1', { conversationId: 'conv-1' }]]),
                update: (_id: string, patch: { linkedPullRequest?: unknown }) => { linkedPrs.push(patch.linkedPullRequest); },
            },
            hostedPush: {
                push: async (req: QaapHostedGitPushRequest) => { endpoint.pushed.push(req); },
            },
            projectResolver: {
                resolve: async () => ('resolvedProject' in options ? options.resolvedProject : project),
            },
            ownerTokens: {
                get: () => ('ownerToken' in options ? options.ownerToken : 'gho_secret_token_never_leaked'),
                forget: () => undefined,
            },
            sessions: undefined,
        });
        return { endpoint, tokens, gitToken, gateToken, linkedPrs };
    }

    it('pushes a feature branch through QaapHostedGitPush with force=false and never exposes the GitHub token', async () => {
        const { endpoint, gitToken } = createHarness();
        const response = makeRes();
        await endpoint.callPush(makeReq(gitToken), response.res);
        expect(response.statusCode).to.equal(200);
        expect(response.body).to.deep.equal({
            ok: true,
            owner: 'octo',
            repo: 'demo',
            branch: 'feat/demo',
            sha: 'a'.repeat(40),
            remoteUrl: 'https://github.com/octo/demo.git',
            pushedTo: 'octo/demo@feat/demo',
        });
        expect(JSON.stringify(response.body)).to.not.include('gho_secret_token_never_leaked');
        expect(endpoint.pushed).to.have.length(1);
        expect(endpoint.pushed[0]).to.deep.equal({
            objectsDirectory: project.objectsDirectory,
            url: 'https://github.com/octo/demo.git',
            sha: 'a'.repeat(40),
            ref: 'refs/heads/feat/demo',
            token: 'gho_secret_token_never_leaked',
            force: false,
        });
    });

    it('refuses direct push to main, master, default branch, and detached HEAD', async () => {
        const { endpoint, gitToken } = createHarness();
        endpoint.defaultBranch = 'develop';
        for (const branch of ['main', 'master', 'develop', 'HEAD']) {
            endpoint.branch = branch;
            const response = makeRes();
            await endpoint.callPush(makeReq(gitToken), response.res);
            expect(response.statusCode, branch).to.equal(400);
            expect(endpoint.pushed, branch).to.have.length(0);
        }
    });

    it('enforces scope isolation: gate tokens are rejected by agent-git, and git tokens are rejected by gate', async () => {
        const { endpoint, tokens, gitToken, gateToken } = createHarness();
        const response = makeRes();
        await endpoint.callPush(makeReq(gateToken), response.res);
        expect(response.statusCode).to.equal(403);
        expect(tokens.resolve(gitToken)).to.equal(undefined);
        expect(tokens.authorize(gitToken, 'preview').ok).to.equal(false);
        expect(tokens.authorize(gitToken, 'delegate').ok).to.equal(false);
    });

    it('refuses read-only turns, non-project checkouts, and missing GitHub sign-in', async () => {
        const readOnly = createHarness({ readOnly: true });
        const r1 = makeRes();
        await readOnly.endpoint.callPush(makeReq(readOnly.gitToken), r1.res);
        expect(r1.statusCode).to.equal(403);

        const nonProject = createHarness({ resolvedProject: undefined });
        const r2 = makeRes();
        await nonProject.endpoint.callPush(makeReq(nonProject.gitToken), r2.res);
        expect(r2.statusCode).to.equal(403);

        const noToken = createHarness({ ownerToken: undefined });
        const r3 = makeRes();
        await noToken.endpoint.callPush(makeReq(noToken.gitToken), r3.res);
        expect(r3.statusCode).to.equal(401);
    });

    it('pushes and creates a pull request in one call and links it to the conversation', async () => {
        const { endpoint, gitToken, linkedPrs } = createHarness();
        const response = makeRes();
        await endpoint.callPr(makeReq(gitToken, { title: 'Add E2E test', body: 'Details', draft: true }), response.res);
        expect(response.statusCode).to.equal(200);
        expect(endpoint.pushed).to.have.length(1);
        expect(endpoint.prs).to.have.length(1);
        expect(endpoint.prs[0].input).to.deep.equal({
            owner: 'octo',
            repo: 'demo',
            title: 'Add E2E test',
            head: 'feat/demo',
            base: 'master',
            body: 'Details',
            draft: true,
        });
        expect(response.body).to.deep.equal({
            ok: true,
            owner: 'octo',
            repo: 'demo',
            branch: 'feat/demo',
            base: 'master',
            number: 42,
            url: 'https://github.com/octo/demo/pull/42',
            title: 'Add E2E test',
            draft: true,
        });
        expect(linkedPrs).to.have.length(1);
    });
});

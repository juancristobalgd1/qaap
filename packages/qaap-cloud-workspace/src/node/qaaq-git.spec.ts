// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import {
    QAAP_AGENT_GIT_API_PATH,
    QAAP_AGENT_GIT_ROUTES,
    QAAP_AGENT_GIT_TOKEN_FILE_ENV,
    QAAP_AGENT_GIT_TOKEN_HEADER,
    QAAP_AGENT_GIT_URL_ENV,
} from '../common/qaap-agent-git-protocol';
import { applyQaapGitCli, releaseQaapDelegationMcpConfigFile, resolveQaapGitCliPath } from './qaap-agent-delegation-launch';

interface QaaqGitModule {
    readonly GIT_API_PATH: string;
    readonly GIT_TOKEN_HEADER: string;
    readonly GIT_URL_ENV: string;
    readonly GIT_TOKEN_FILE_ENV: string;
    readonly GIT_ROUTES: Record<string, string>;
    parseGitCliArgs(argv: string[]): { help?: boolean; operation?: string; body?: Record<string, unknown> };
    runGitCli(argv: string[], deps?: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch }): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

describe('qaaq-git sealed agent CLI', () => {
    let mod: QaaqGitModule;
    const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<QaaqGitModule>;

    before(async () => {
        mod = await dynamicImport(pathToFileURL(resolveQaapGitCliPath()).href);
    });

    it('keeps its protocol constants aligned with qaap-agent-git-protocol', () => {
        expect(mod.GIT_API_PATH).to.equal(QAAP_AGENT_GIT_API_PATH);
        expect(mod.GIT_TOKEN_HEADER).to.equal(QAAP_AGENT_GIT_TOKEN_HEADER);
        expect(mod.GIT_URL_ENV).to.equal(QAAP_AGENT_GIT_URL_ENV);
        expect(mod.GIT_TOKEN_FILE_ENV).to.equal(QAAP_AGENT_GIT_TOKEN_FILE_ENV);
        expect(mod.GIT_ROUTES).to.deep.equal(QAAP_AGENT_GIT_ROUTES);
    });

    it('parses push and pr create args and rejects force-push / delete flags', () => {
        expect(mod.parseGitCliArgs(['push'])).to.deep.equal({ operation: 'push', body: {} });
        expect(mod.parseGitCliArgs(['pr', 'create', '--title', 'Fix bug', '--body', 'Details', '--base', 'main', '--draft', '--no-push'])).to.deep.equal({
            operation: 'pr',
            body: { title: 'Fix bug', body: 'Details', base: 'main', draft: true, push: false },
        });
        expect(() => mod.parseGitCliArgs(['push', '--force'])).to.throw('Force-push is not supported');
        expect(() => mod.parseGitCliArgs(['push', '--delete'])).to.throw('Deleting remote branches is not supported');
        expect(() => mod.parseGitCliArgs(['pr', 'create'])).to.throw('--title');
    });

    it('posts to the backend with the 0600 task token and formats success/error cleanly', async () => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaaq-git-test-'));
        const tokenFile = path.join(tmpDir, 'token');
        fs.writeFileSync(tokenFile, 'task-git-secret\n', { mode: 0o600 });
        try {
            const seen: Array<{ url: string; header?: string; body?: string }> = [];
            const fetchStub = (async (url: string | URL, init?: RequestInit) => {
                seen.push({
                    url: String(url),
                    header: (init?.headers as Record<string, string>)?.[QAAP_AGENT_GIT_TOKEN_HEADER],
                    body: typeof init?.body === 'string' ? init.body : undefined,
                });
                return new Response(JSON.stringify({ ok: true, pushedTo: 'octo/demo@feat/a' }), { status: 200 });
            }) as unknown as typeof fetch;
            const env = { [QAAP_AGENT_GIT_URL_ENV]: 'http://127.0.0.1:4873', [QAAP_AGENT_GIT_TOKEN_FILE_ENV]: tokenFile };
            const res = await mod.runGitCli(['push'], { env, fetch: fetchStub });
            expect(res.exitCode).to.equal(0);
            expect(JSON.parse(res.stdout).pushedTo).to.equal('octo/demo@feat/a');
            expect(seen[0]).to.deep.equal({
                url: 'http://127.0.0.1:4873/qaap/api/agent-git/push',
                header: 'task-git-secret',
                body: '{}',
            });
        } finally {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('stages an executable wrapper on PATH with a 0600 token file and cleans it up on task release', () => {
        const taskId = `git-cli-stage-${Date.now()}`;
        const env: NodeJS.ProcessEnv = { PATH: '/usr/bin' };
        const staged = applyQaapGitCli(env, taskId, { url: 'http://127.0.0.1:4873', token: 'tok-git-123' }, undefined);
        expect(staged).to.not.equal(undefined);
        expect(env[QAAP_AGENT_GIT_URL_ENV]).to.equal('http://127.0.0.1:4873');
        expect(env[QAAP_AGENT_GIT_TOKEN_FILE_ENV]).to.equal(staged!.tokenFile);
        expect(env.PATH?.startsWith(staged!.binDir)).to.equal(true);
        expect(fs.readFileSync(staged!.tokenFile, 'utf8')).to.equal('tok-git-123');
        expect(fs.existsSync(path.join(staged!.binDir, process.platform === 'win32' ? 'qaaq-git.cmd' : 'qaaq-git'))).to.equal(true);

        releaseQaapDelegationMcpConfigFile(taskId);
        expect(fs.existsSync(staged!.binDir)).to.equal(false);
        expect(fs.existsSync(staged!.tokenFile)).to.equal(false);
    });
});

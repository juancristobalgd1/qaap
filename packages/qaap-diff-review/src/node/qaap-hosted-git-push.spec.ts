// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { QaapHostedGitPush, type QaapHostedGitPushRequest } from './qaap-hosted-git-push';

const TOKEN = 'gho_secretTokenForSpec123';

/** Pushes to a local bare repository instead of GitHub and records every git invocation. */
class LocalHostedGitPush extends QaapHostedGitPush {
    readonly calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];

    protected override isAllowedUrl(url: string): boolean {
        return url.startsWith('file://');
    }

    protected override allowedProtocol(): string {
        return 'file';
    }

    protected override runGit(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
        this.calls.push({ args, env });
        return super.runGit(args, env);
    }
}

function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
}

describe('qaap-hosted-git-push', function (): void {
    this.timeout(20_000);

    it('accepts only GitHub remotes and canonicalizes them to HTTPS', () => {
        const push = new QaapHostedGitPush();
        expect(push.toGithubHttpsUrl('https://github.com/acme/widget.git')).to.equal('https://github.com/acme/widget.git');
        expect(push.toGithubHttpsUrl('https://github.com/acme/widget\n')).to.equal('https://github.com/acme/widget.git');
        expect(push.toGithubHttpsUrl('git@github.com:acme/my.repo.git')).to.equal('https://github.com/acme/my.repo.git');
        expect(push.toGithubHttpsUrl('ssh://git@github.com/acme/widget')).to.equal('https://github.com/acme/widget.git');
        expect(push.toGithubHttpsUrl('https://user:pw@github.com/acme/widget')).to.equal('https://github.com/acme/widget.git');
        for (const foreign of [
            'https://github.com.evil.test/acme/widget.git',
            'https://evil.test/github.com/acme/widget.git',
            'http://github.com/acme/widget.git',
            'https://github.com/acme/widget/extra',
            'https://github.com/acme/..',
            '/srv/git/widget.git',
            'ext::sh -c touch% /tmp/x',
        ]) {
            expect(push.toGithubHttpsUrl(foreign), foreign).to.equal(undefined);
        }
    });

    it('refuses a request that is not exactly one commit to one GitHub branch', async () => {
        const push = new QaapHostedGitPush();
        const valid: QaapHostedGitPushRequest = {
            objectsDirectory: '/workspace/repos/users/a/acme/widget/.git/objects',
            url: 'https://github.com/acme/widget.git',
            sha: 'a'.repeat(40),
            ref: 'refs/heads/feature/x',
            token: TOKEN,
        };
        for (const bad of [
            { url: 'https://evil.test/acme/widget.git' },
            { sha: 'HEAD' },
            { ref: 'refs/heads/a..b' },
            { ref: 'refs/heads/x:refs/heads/main' },
            { ref: 'refs/tags/v1' },
            { ref: 'refs/heads/-f' },
            { objectsDirectory: 'relative/objects' },
            { objectsDirectory: '/a/objects:/etc' },
            { token: '' },
        ] as Array<Partial<QaapHostedGitPushRequest>>) {
            let error: unknown;
            try {
                await push.push({ ...valid, ...bad });
            } catch (caught) {
                error = caught;
            }
            expect(error, JSON.stringify(bad)).to.be.instanceOf(Error);
        }
    });

    describe('push', () => {
        let base: string;
        let project: string;
        let remote: string;
        let marker: string;

        beforeEach(() => {
            base = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-hosted-push-spec-'));
            project = path.join(base, 'project');
            remote = path.join(base, 'remote.git');
            marker = path.join(base, 'pwned');
            git(base, 'init', '--bare', '--quiet', remote);
            git(base, 'init', '--quiet', '-b', 'main', project);
            git(project, 'config', 'user.email', 'spec@qaap.test');
            git(project, 'config', 'user.name', 'Spec');
            fs.writeFileSync(path.join(project, 'a.txt'), 'one\n');
            git(project, 'add', 'a.txt');
            git(project, 'commit', '--quiet', '-m', 'one');
            // An agent controls the project's config and hooks: none of it may run in the push.
            const hooks = path.join(base, 'hooks');
            fs.mkdirSync(hooks);
            fs.writeFileSync(path.join(hooks, 'pre-push'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
            git(project, 'config', 'core.hooksPath', hooks);
            git(project, 'config', 'credential.helper', `!f() { cat > '${marker}'; }; f`);
            git(project, 'config', 'http.sslVerify', 'false');
        });

        afterEach(() => {
            fs.rmSync(base, { recursive: true, force: true });
        });

        it('pushes the commit from the project objects without running its config, and keeps the token out of argv', async () => {
            const push = new LocalHostedGitPush();
            const sha = git(project, 'rev-parse', 'HEAD');
            await push.push({
                objectsDirectory: path.join(project, '.git', 'objects'),
                url: `file://${remote}`,
                sha,
                ref: 'refs/heads/feature/x',
                token: TOKEN,
            });

            expect(git(remote, 'rev-parse', 'refs/heads/feature/x')).to.equal(sha);
            expect(fs.existsSync(marker)).to.equal(false);
            const pushCall = push.calls.find(call => call.args.includes('push'));
            expect(pushCall?.env.QAAP_GIT_PUSH_TOKEN).to.equal(TOKEN);
            expect(pushCall?.env.GIT_CONFIG_NOSYSTEM).to.equal('1');
            for (const call of push.calls) {
                expect(call.args.join(' ')).not.to.contain(TOKEN);
                expect(call.args).not.to.include(project);
            }
            const scratch = pushCall!.args[pushCall!.args.indexOf('--git-dir') + 1];
            expect(fs.existsSync(scratch)).to.equal(false);
        });

        it('answers credentials only from the token env, for this one push', async () => {
            const push = new LocalHostedGitPush();
            await push.push({
                objectsDirectory: path.join(project, '.git', 'objects'),
                url: `file://${remote}`,
                sha: git(project, 'rev-parse', 'HEAD'),
                ref: 'refs/heads/main',
                token: TOKEN,
            });
            const pushCall = push.calls.find(call => call.args.includes('push'))!;
            const helpers = pushCall.args.filter((arg, index) => pushCall.args[index - 1] === '-c' && arg.startsWith('credential.helper='));
            expect(helpers[0]).to.equal('credential.helper=');
            // Git runs a `!` helper as `sh -c '<helper> "$@"' <helper> <action>`.
            const helper = `${helpers[1].slice('credential.helper=!'.length)} "$@"`;
            const answer = execFileSync('sh', ['-c', helper, 'helper', 'get'], { encoding: 'utf8', env: { QAAP_GIT_PUSH_TOKEN: TOKEN } });
            expect(answer).to.equal(`username=x-access-token\npassword=${TOKEN}\n`);
            const onStore = execFileSync('sh', ['-c', helper, 'helper', 'store'], { encoding: 'utf8', env: { QAAP_GIT_PUSH_TOKEN: TOKEN } });
            expect(onStore).to.equal('');
        });
    });
});

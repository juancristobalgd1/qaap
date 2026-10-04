// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';

/** What the hosted Work Hub pushes: a commit of the project repository to one GitHub branch. */
export interface QaapHostedGitPushRequest {
    /** Absolute `objects` directory of the project repository (read as an alternate object store). */
    readonly objectsDirectory: string;
    /** Canonical `https://github.com/<owner>/<repo>.git`, see {@link QaapHostedGitPush.toGithubHttpsUrl}. */
    readonly url: string;
    /** Full commit id to push. */
    readonly sha: string;
    /** Full destination ref, `refs/heads/<branch>`. */
    readonly ref: string;
    /** The signed-in user's GitHub token. Lives only in this backend and the push child's env. */
    readonly token: string;
}

const PUSH_TIMEOUT_MS = 5 * 60 * 1000;
const PUSH_MAX_BUFFER = 4 * 1024 * 1024;
const TOKEN_ENV = 'QAAP_GIT_PUSH_TOKEN';
/**
 * Egress proxy variables the orchestrator sets on this backend container (`tenantEgressProxyEnv`):
 * with a tenant egress proxy the tenant has no direct route to github.com. Agents cannot change
 * this backend's environment, so passing them on is safe.
 */
const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'] as const;

/**
 * Pushes a hosted project to GitHub with the user's token without the agent uid ever being able to
 * read it (doc/qaap-github-token-boundary.md).
 *
 * The token cannot go to a git process running as the agent uid: any process of that uid can read
 * `/proc/<pid>/environ`, open the fds and trace a same-uid process, and the project's `.git/config`
 * (written by agents) can add credential helpers that receive the password, proxies with TLS
 * verification off, or hooks. So the push runs as the backend's own uid in a fresh root-owned bare
 * repository with no hooks and no system, global or repository config of the project. It reads the
 * project's objects as an alternate object store (data only, never config) and pushes one commit to
 * a URL this backend built. The token reaches git only as an environment variable of that child,
 * answered by an inline credential helper for this one push; it is never written to a file or argv.
 */
@injectable()
export class QaapHostedGitPush {

    /**
     * The canonical HTTPS URL for a GitHub remote (`https://`, `ssh://` or scp-like `git@` forms),
     * or `undefined` for any other host. Userinfo and paths beyond `<owner>/<repo>` are refused.
     */
    toGithubHttpsUrl(remoteUrl: string): string | undefined {
        const trimmed = remoteUrl.trim();
        const match = /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|ssh:\/\/git@github\.com(?::22)?\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(trimmed);
        if (!match || match[2] === '.' || match[2] === '..') {
            return undefined;
        }
        return `https://github.com/${match[1]}/${match[2]}.git`;
    }

    async push(request: QaapHostedGitPushRequest): Promise<void> {
        this.assertValidRequest(request);
        const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'qaap-push-'));
        try {
            await this.runGit(['init', '--bare', '--quiet', '--template=', scratch], this.baseEnv(scratch));
            await this.runGit([
                '--git-dir', scratch,
                '-c', 'core.hooksPath=/dev/null',
                '-c', 'protocol.allow=never',
                '-c', `protocol.${this.allowedProtocol()}.allow=always`,
                ...this.transportConfig(),
                '-c', 'credential.helper=',
                '-c', `credential.helper=!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$${TOKEN_ENV}"; }; f`,
                'push', '--porcelain', request.url, `${request.sha}:${request.ref}`,
            ], {
                ...this.baseEnv(scratch),
                GIT_ALTERNATE_OBJECT_DIRECTORIES: request.objectsDirectory,
                [TOKEN_ENV]: request.token,
            });
        } finally {
            await fs.promises.rm(scratch, { recursive: true, force: true });
        }
    }

    protected assertValidRequest(request: QaapHostedGitPushRequest): void {
        if (!this.isAllowedUrl(request.url)) {
            throw new Error('Hosted push only targets GitHub over HTTPS.');
        }
        if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(request.sha)) {
            throw new Error('Hosted push needs a full commit id.');
        }
        // `check-ref-format` rules that matter for a refspec; `:`, `..`, control chars, `@{` and
        // spaces cannot appear, so the refspec is exactly `<sha>:<ref>`.
        if (!/^refs\/heads\/(?!-)(?!.*(?:\.\.|@\{|\/\.|\/\/|\.lock(?:\/|$)|\.$|\/$))[A-Za-z0-9._/+-]+$/.test(request.ref)) {
            throw new Error('Hosted push needs a valid branch ref.');
        }
        // Git splits the alternates variable on the platform path delimiter (`:` on POSIX, `;` on
        // Windows). A Windows drive prefix such as `C:` is the one colon an absolute path may carry.
        const objectsDirectoryBody = process.platform === 'win32'
            ? request.objectsDirectory.replace(/^[A-Za-z]:(?=[\\/])/, '')
            : request.objectsDirectory;
        if (!path.isAbsolute(request.objectsDirectory) || /[:;\n\r]/.test(objectsDirectoryBody)) {
            throw new Error('Hosted push needs the absolute objects directory of the repository.');
        }
        if (!request.token || /[\s]/.test(request.token)) {
            throw new Error('Hosted push needs a GitHub sign-in.');
        }
    }

    protected isAllowedUrl(url: string): boolean {
        return this.toGithubHttpsUrl(url) === url;
    }

    protected allowedProtocol(): string {
        return 'https';
    }

    /** TLS verification on and the proxy pinned to this backend's own egress proxy, if any. */
    protected transportConfig(): string[] {
        const proxy = (process.env.HTTPS_PROXY || process.env.https_proxy || '').trim();
        return ['-c', 'http.sslVerify=true', ...(proxy ? ['-c', `http.proxy=${proxy}`] : [])];
    }

    /**
     * No inherited git configuration, prompts or helpers; `HOME` is the private scratch directory.
     * Only `PATH`, the locale and the orchestrator's egress proxy variables are inherited.
     */
    protected baseEnv(scratch: string): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {
            HOME: scratch,
            GIT_CONFIG_NOSYSTEM: '1',
            // Git for Windows maps the literal /dev/null to NUL itself; it cannot read os.devNull (\\.\nul).
            GIT_CONFIG_GLOBAL: '/dev/null',
            GIT_TERMINAL_PROMPT: '0',
        };
        for (const key of ['PATH', 'LANG', 'LC_ALL', ...PROXY_ENV_KEYS]) {
            const value = process.env[key];
            if (value) {
                env[key] = value;
            }
        }
        return env;
    }

    /** Runs git as this backend's uid. Errors carry git's stderr, which never contains the token. */
    protected runGit(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
        return new Promise((resolve, reject) => {
            execFile('git', args, { env, timeout: PUSH_TIMEOUT_MS, maxBuffer: PUSH_MAX_BUFFER }, (error, stdout, stderr) => {
                if (error) {
                    reject(Object.assign(new Error(String(stderr).trim() || error.message), { stdout, stderr }));
                } else {
                    resolve(stdout);
                }
            });
        });
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { resolveQaapReposRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

/** Options of one sealed git child. */
export interface QaapSealedGitRunOptions {
    /** Kills the child when aborted. */
    readonly signal?: AbortSignal;
    /** Defaults to five minutes. */
    readonly timeoutMs?: number;
    /** Receives raw stderr chunks, e.g. `--progress` output. */
    readonly onStderr?: (chunk: string) => void;
    /** Written to stdin, which is otherwise closed. */
    readonly input?: string;
    /**
     * Streams stdout into this open file (from its current position) instead of returning it; the caller
     * closes it. Stdout is paused until each chunk is written, so a slow volume never buffers the output.
     */
    readonly stdoutHandle?: fs.promises.FileHandle;
    /** Fails the call once more than this many bytes went to {@link stdoutHandle} or sit in {@link watchDirectory}. */
    readonly maxBytes?: number;
    /** Polled while git runs; its total size counts against {@link maxBytes}. */
    readonly watchDirectory?: string;
}

/** `https://[user@]github.com/`, `ssh://git@github.com[:22]/` or `git@github.com:`, then `<owner>/<repo>[.git][/]`. */
const GITHUB_REMOTE = /^(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|ssh:\/\/git@github\.com(?::22)?\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_STDOUT = 4 * 1024 * 1024;
const TOKEN_ENV = 'QAAP_GIT_PUSH_TOKEN';
/** Default for `QAAP_SEALED_GIT_MAX_BYTES`: what one sealed fetch may download, and the bundle it may write. */
const DEFAULT_MAX_TRANSFER_BYTES = 4 * 1024 * 1024 * 1024;
const WATCH_INTERVAL_MS = 500;
const SCRATCH_PREFIXES = ['qaap-fetch-', 'qaap-push-'] as const;
/** Older than any sealed command can run, so only a crashed backend leaves such a scratch directory. */
const STALE_SCRATCH_MS = 60 * 60 * 1000;
/**
 * Egress proxy variables the orchestrator sets on this backend container (`tenantEgressProxyEnv`):
 * with a tenant egress proxy the tenant has no direct route to github.com. Agents cannot change
 * this backend's environment, so passing them on is safe.
 */
const PROXY_ENV_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'] as const;

/**
 * Git with the signed-in user's GitHub token, run so that the agent uid can never read the token
 * (doc/qaap-github-token-boundary.md).
 *
 * The token cannot go to a git process running as the agent uid: any process of that uid can read
 * `/proc/<pid>/environ`, open the fds and trace a same-uid process, and the project's `.git/config`
 * (written by agents) can add credential helpers that receive the password, proxies with TLS
 * verification off, or hooks. So these commands run as the backend's own uid in a fresh private
 * bare repository with no hooks and no system, global or repository config of the project, against a
 * GitHub URL this backend built. They may read the project's objects as an alternate object store
 * (data only, never config). The token reaches git only as an environment variable of that child,
 * answered by an inline credential helper; it is never written to a file or argv.
 */
@injectable()
export class QaapSealedGithubGit {

    /**
     * The canonical HTTPS URL for a GitHub remote (`https://`, `ssh://` or scp-like `git@` forms),
     * or `undefined` for any other host. Userinfo and paths beyond `<owner>/<repo>` are refused.
     */
    toGithubHttpsUrl(remoteUrl: string): string | undefined {
        const trimmed = remoteUrl.trim();
        const match = GITHUB_REMOTE.exec(trimmed);
        if (!match || match[2] === '.' || match[2] === '..') {
            return undefined;
        }
        return `https://github.com/${match[1]}/${match[2]}.git`;
    }

    protected isAllowedUrl(url: string): boolean {
        return this.toGithubHttpsUrl(url) === url;
    }

    protected allowedProtocol(): string {
        return 'https';
    }

    /**
     * `-c` options of every sealed command: no hooks, one transport, TLS verified, pinned proxy. No
     * background gc or maintenance, and `core.alternateRefsCommand` replaced by a no-op: by default
     * git runs `git --git-dir=<alternate> for-each-ref` to learn the alternates' refs, which would
     * read the project's agent-written config as this backend's uid.
     */
    protected sealedConfig(): string[] {
        return [
            '-c', 'core.hooksPath=/dev/null',
            '-c', 'core.alternateRefsCommand=true',
            '-c', 'gc.auto=0',
            '-c', 'maintenance.auto=false',
            '-c', 'protocol.allow=never',
            '-c', `protocol.${this.allowedProtocol()}.allow=always`,
            ...this.transportConfig(),
        ];
    }

    /**
     * TLS verification on. The egress proxy comes only from the inherited `HTTPS_PROXY` environment
     * ({@link baseEnv}): no git config but these `-c` options is read, so pinning `http.proxy` would add
     * nothing and would put a proxy URL (possibly with credentials) in the child's argv, readable from
     * `/proc/<pid>/cmdline` by other uids of the pid namespace (R3-4).
     */
    protected transportConfig(): string[] {
        return ['-c', 'http.sslVerify=true'];
    }

    /**
     * The only credential helper: answers `get` from the token env, and only when git asks for
     * {@link credentialHost} over HTTPS (a redirect to another host gets nothing, R3-3); ignores
     * `store`/`erase`.
     */
    protected credentialConfig(token: string | undefined): string[] {
        return [
            '-c', 'credential.helper=',
            ...(token ? ['-c', `credential.helper=${this.credentialHelper()}`] : []),
        ];
    }

    /** Shell helper reading git's `key=value` request on stdin. */
    protected credentialHelper(): string {
        return '!f() { test "$1" = get || exit 0; protocol=; host=; '
            + 'while IFS== read -r key value; do case "$key" in protocol) protocol=$value;; host) host=$value;; esac; done; '
            + `test "$protocol" = https && test "$host" = ${this.credentialHost()} || exit 0; `
            + `echo username=x-access-token; echo "password=$${TOKEN_ENV}"; }; f`;
    }

    protected credentialHost(): string {
        return 'github.com';
    }

    protected credentialEnv(token: string | undefined): NodeJS.ProcessEnv {
        return token ? { [TOKEN_ENV]: token } : {};
    }

    protected assertValidToken(token: string | undefined, required: boolean): void {
        if ((required && !token) || (token !== undefined && (!token || /[\s]/.test(token)))) {
            throw new Error('Hosted GitHub git needs a GitHub sign-in.');
        }
    }

    protected assertValidObjectsDirectory(objectsDirectory: string): void {
        // Git splits the alternates variable on the platform path delimiter (`:` on POSIX, `;` on
        // Windows). A Windows drive prefix such as `C:` is the one colon an absolute path may carry.
        const objectsDirectoryBody = process.platform === 'win32'
            ? objectsDirectory.replace(/^[A-Za-z]:(?=[\\/])/, '')
            : objectsDirectory;
        if (!path.isAbsolute(objectsDirectory) || /[:;\n\r]/.test(objectsDirectoryBody)) {
            throw new Error('Hosted GitHub git needs the absolute objects directory of the repository.');
        }
    }

    protected staleScratchSwept = false;

    /** A fresh `0700` directory under {@link scratchRoot}, never shared with the agent uid. */
    protected async createScratch(prefix: string): Promise<string> {
        const root = await this.ensureScratchRoot();
        return fs.promises.mkdtemp(path.join(root, prefix));
    }

    /**
     * Where sealed git works: `QAAP_SEALED_GIT_SCRATCH_ROOT`, else `{volume}/.qaap/sealed-git` next to a
     * `.../repos` root (the backend-owned directory of the project-session store), so a whole repository
     * is never downloaded into a tmpfs `/tmp`; else `{tmpdir}/qaap-sealed-git`.
     */
    protected scratchRoot(): string {
        const configured = process.env.QAAP_SEALED_GIT_SCRATCH_ROOT?.trim();
        if (configured) {
            return path.resolve(configured);
        }
        const reposRoot = resolveQaapReposRoot();
        return path.basename(reposRoot) === 'repos'
            ? path.join(path.dirname(reposRoot), '.qaap', 'sealed-git')
            : path.join(os.tmpdir(), 'qaap-sealed-git');
    }

    /**
     * Creates the scratch root `0700` and refuses one that is a symlink, or (POSIX) not owned by this
     * uid or open to others. The first call also removes scratch directories a crashed backend left.
     */
    protected async ensureScratchRoot(): Promise<string> {
        const root = this.scratchRoot();
        await fs.promises.mkdir(root, { recursive: true, mode: 0o700 });
        const stat = await fs.promises.lstat(root);
        const foreign = process.platform !== 'win32' && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0);
        if (stat.isSymbolicLink() || !stat.isDirectory() || foreign) {
            throw new Error(`The sealed git scratch directory ${root} must be a private (0700) directory of this backend.`);
        }
        if (!this.staleScratchSwept) {
            this.staleScratchSwept = true;
            await this.removeStaleScratch(root);
        }
        return root;
    }

    protected async removeStaleScratch(root: string): Promise<void> {
        const now = Date.now();
        for (const entry of await fs.promises.readdir(root)) {
            if (!SCRATCH_PREFIXES.some(prefix => entry.startsWith(prefix))) {
                continue;
            }
            const target = path.join(root, entry);
            const stat = await fs.promises.lstat(target).catch(() => undefined);
            if (stat && now - stat.mtimeMs > STALE_SCRATCH_MS) {
                await this.removeScratch(target).catch(() => undefined);
            }
        }
    }

    /** `QAAP_SEALED_GIT_MAX_BYTES`, default 4 GiB. */
    protected maxTransferBytes(): number {
        const configured = Number(process.env.QAAP_SEALED_GIT_MAX_BYTES);
        return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_MAX_TRANSFER_BYTES;
    }

    /** Total size of the regular files under `directory`; entries that vanish meanwhile count as empty. */
    protected async directorySize(directory: string): Promise<number> {
        let total = 0;
        const entries = await fs.promises.readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                total += await this.directorySize(target);
            } else if (entry.isFile()) {
                total += (await fs.promises.lstat(target).catch(() => undefined))?.size ?? 0;
            }
        }
        return total;
    }

    protected transferLimitError(maxBytes: number): Error {
        return new Error(`The repository is larger than the ${maxBytes}-byte limit for a hosted fetch (QAAP_SEALED_GIT_MAX_BYTES).`);
    }

    protected removeScratch(scratch: string): Promise<void> {
        return fs.promises.rm(scratch, { recursive: true, force: true });
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
    protected runGit(args: string[], env: NodeJS.ProcessEnv, options: QaapSealedGitRunOptions = {}): Promise<string> {
        return new Promise((resolve, reject) => {
            if (options.signal?.aborted) {
                reject(new Error('Git operation cancelled: the request was closed.'));
                return;
            }
            const output = options.stdoutHandle;
            const maxBytes = options.maxBytes;
            // Chunks are appended in order; a failed write fails the call.
            let written: Promise<unknown> = Promise.resolve();
            let outputBytes = 0;
            // cwd: the private scratch ({@link baseEnv}'s HOME), so no repository discovery or early config
            // read happens in this backend's own working directory (R3-4).
            const child = spawn('git', args, { env, cwd: env.HOME, stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            let settled = false;
            const finish = (error: Error | undefined): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                clearInterval(watcher);
                options.signal?.removeEventListener('abort', onAbort);
                if (error) {
                    child.kill();
                    reject(error);
                } else if (output) {
                    written.then(() => resolve(''), reject);
                } else {
                    resolve(stdout);
                }
            };
            const onAbort = (): void => finish(new Error('Git operation cancelled: the request was closed.'));
            const timer = setTimeout(() => finish(new Error('Git operation timed out.')), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
            const watchDirectory = options.watchDirectory;
            const watcher = watchDirectory && maxBytes !== undefined ? setInterval(() => {
                this.directorySize(watchDirectory).then(size => {
                    if (size > maxBytes) {
                        finish(this.transferLimitError(maxBytes));
                    }
                }, () => undefined);
            }, WATCH_INTERVAL_MS) : undefined;
            options.signal?.addEventListener('abort', onAbort, { once: true });
            if (output) {
                child.stdout?.on('data', (chunk: Buffer) => {
                    outputBytes += chunk.length;
                    if (maxBytes !== undefined && outputBytes > maxBytes) {
                        finish(this.transferLimitError(maxBytes));
                        return;
                    }
                    // Backpressure: no further chunk is read until this one is on disk.
                    child.stdout?.pause();
                    written = written.then(() => output.write(chunk)).then(() => {
                        child.stdout?.resume();
                    });
                    written.catch(error => finish(error instanceof Error ? error : new Error(String(error))));
                });
            } else {
                child.stdout?.on('data', chunk => {
                    stdout += String(chunk);
                    if (stdout.length > MAX_STDOUT) {
                        finish(new Error(`Git output exceeded ${MAX_STDOUT} bytes.`));
                    }
                });
            }
            child.stderr?.on('data', chunk => {
                const text = String(chunk);
                stderr += text;
                options.onStderr?.(text);
            });
            if (options.input !== undefined) {
                // A git that exits before reading all of stdin fails through `close`, not EPIPE.
                child.stdin?.on('error', () => undefined);
                child.stdin?.end(options.input);
            }
            child.on('error', error => finish(error));
            child.on('close', code => finish(code === 0 ? undefined : Object.assign(new Error(stderr.trim() || `git exited with code ${code}`), { stderr })));
        });
    }
}

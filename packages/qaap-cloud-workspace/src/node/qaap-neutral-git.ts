// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Invocation settings for git runs that touch a repository a model can write to (the delegated child's
 * worktree and the shared common git dir) and must therefore never run a program from user-level config.
 *
 * The user's global and system git configuration is NOT read at all: `GIT_CONFIG_GLOBAL` points at the null
 * device (it replaces both `~/.gitconfig` and `$XDG_CONFIG_HOME/git/config`) and `GIT_CONFIG_NOSYSTEM` drops the
 * system file. In a hosted agent the HOME of the git process is writable by the agent itself, so the global file
 * is as model-controlled as the repository's own config and cannot be trusted either. Without a definition no
 * `filter.*`, `diff.*.textconv`, `merge.*.driver` or external-diff driver can be selected by a `.gitattributes`.
 * What is left (the repository's local and worktree config) is vetted by `QaapGitExecConfigChecker`.
 *
 * Both halves travel in the command line too (`ARGS`), because not every tenant transport forwards the
 * environment (`docker exec` only passes variables it is given explicitly, see {@link forwardedEnv}).
 */
export namespace QaapNeutralGit {

    let emptyFile: string | undefined;

    /**
     * The "nothing here" file for GIT_CONFIG_GLOBAL and the file-valued `-c` options. POSIX has `/dev/null`, valid in
     * every tenant transport (a docker worker has no access to a host path). Git for Windows only special-cases the
     * literal `/dev/null` in its own `open`, and rejects the `os.devNull` device path (`\\.\nul`) as a config file, so
     * there a real empty file, created once per process in a private directory, stands in for it.
     */
    export function nullFile(platform: NodeJS.Platform = process.platform): string {
        if (platform !== 'win32') {
            return '/dev/null';
        }
        if (!emptyFile || !fs.existsSync(emptyFile)) {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qaap-neutral-git-'));
            emptyFile = path.join(dir, 'empty').replace(/\\/g, '/');
            fs.writeFileSync(emptyFile, '', { mode: 0o600 });
        }
        return emptyFile;
    }

    /** Config the command line pins (it beats every file): no hooks, fsmonitor, pagers, signing, helpers or auto-gc. */
    export function args(platform: NodeJS.Platform = process.platform): readonly string[] {
        const none = nullFile(platform);
        return [
            // Kept as `/dev/null`: it already worked everywhere before this module existed.
            '-c', 'core.hooksPath=/dev/null',
            '-c', 'core.fsmonitor=false',
            '-c', `core.attributesFile=${none}`,
            // The global ignore file (XDG default included) would hide files from `add -A` and from LFS detection.
            '-c', `core.excludesFile=${none}`,
            // A nested repository (a gitlink without .gitmodules) carries its own config: git must never recurse into it.
            '-c', 'diff.ignoreSubmodules=all',
            '-c', 'submodule.recurse=false',
            '-c', 'status.submoduleSummary=false',
            '-c', 'core.pager=cat',
            '-c', 'core.sshCommand=',
            '-c', 'credential.helper=',
            '-c', 'commit.gpgSign=false',
            '-c', 'gc.auto=0',
            '-c', 'maintenance.auto=false',
            '-c', 'protocol.ext.allow=never',
            // Trust is decided by the caller (worktree identity + local config vetting), not by user-level safe.directory.
            '-c', 'safe.directory=*',
        ];
    }

    /** {@link args} for this platform. */
    export const ARGS: readonly string[] = args();

    /** The variables that carry the neutralization; the only ones forwarded to a tenant worker. */
    const NEUTRAL_KEYS = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_ATTR_NOSYSTEM', 'GIT_TERMINAL_PROMPT'] as const;

    /** Inherited git variables that name a program or inject config; never passed on. */
    const STRIPPED_KEY_RE = /^(?:GIT_CONFIG(?:_.*)?|GIT_EXTERNAL_DIFF|GIT_PAGER|GIT_SSH(?:_COMMAND)?|GIT_ASKPASS|SSH_ASKPASS|GIT_EDITOR|GIT_SEQUENCE_EDITOR|GIT_PROXY_COMMAND|GIT_EXEC_PATH|GIT_TEMPLATE_DIR|GIT_DIR|GIT_WORK_TREE|GIT_INDEX_FILE|GIT_OBJECT_DIRECTORY|GIT_ALTERNATE_OBJECT_DIRECTORIES|GIT_NAMESPACE|GIT_CEILING_DIRECTORIES|LD_PRELOAD|DYLD_INSERT_LIBRARIES)$/;

    /**
 * `base` (default: the backend's own env) with the user-level git config switched off. `extra` is applied last, so
 * a deliberate `GIT_INDEX_FILE` (the throwaway index) survives the stripping of an inherited one.
 *
 * Known limitation: settings the user keeps in global config for correctness (`core.autocrlf`, `core.eol`,
 * `core.longpaths`) are not read either. They cannot be forwarded safely: in a hosted tenant the backend's HOME is the
 * agent's HOME, so the global file is model-writable and there is no trustworthy source for them. A Windows user
 * relying on a global `core.autocrlf=true` therefore gets git's defaults (no CRLF conversion) in `child_apply`.
 */
    export function env(base: NodeJS.ProcessEnv = process.env, extra?: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
        const result: NodeJS.ProcessEnv = {};
        for (const [key, value] of Object.entries(base)) {
            if (!STRIPPED_KEY_RE.test(key.toUpperCase())) {
                result[key] = value;
            }
        }
        result.GIT_CONFIG_GLOBAL = nullFile(platform);
        result.GIT_CONFIG_NOSYSTEM = '1';
        result.GIT_ATTR_NOSYSTEM = '1';
        result.GIT_TERMINAL_PROMPT = '0';
        return extra ? { ...result, ...extra } : result;
    }

    /** True when `env` carries the neutralization, i.e. the run asked for user-level config to be ignored. */
    export function isNeutral(env: NodeJS.ProcessEnv | undefined): boolean {
        const global = env?.GIT_CONFIG_GLOBAL;
        return global !== undefined && (global === '/dev/null' || global === emptyFile) && env?.GIT_CONFIG_NOSYSTEM === '1';
    }

    /** The neutralization variables of `env`, for a transport that must be handed its environment explicitly. */
    export function forwardedEnv(env: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv | undefined {
        if (!isNeutral(env)) {
            return undefined;
        }
        const forwarded: NodeJS.ProcessEnv = {};
        for (const key of NEUTRAL_KEYS) {
            forwarded[key] = env![key];
        }
        return forwarded;
    }
}

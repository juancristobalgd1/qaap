// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

/** Marker of a repository root: a `.git` directory, or a `.git` file for linked worktrees. */
const GIT_MARKER = '.git';

/**
 * Bash prompt hook, exported through `PROMPT_COMMAND` before every prompt.
 *
 * The label is recomputed only when the working directory changes and uses bash builtins only (no git
 * process, no fork per prompt). Inside a repository it shows the repository directory name followed by
 * the path relative to its root (`traductor`, `traductor/src`). Outside one it shows `~` or `~/<path>`
 * under `$HOME`, and the basename otherwise. The label is stored in `__qaap_p` and read from PS1 as a
 * variable, so directory names containing `$`, backslashes or backticks are never expanded.
 *
 * The container-side path is not used on purpose: the backend knows the host path of the terminal
 * cwd, but the shell runs inside the tenant container where paths differ. Walking up for `.git` from
 * `$PWD` works in both places.
 */
export const QAAP_BASH_PROMPT_COMMAND: string = [
    'if [ "$PWD" != "${__qaap_last-}" ]; then',
    '__qaap_last=$PWD; __qaap_d=$PWD;',
    'while [ -n "$__qaap_d" ] && [ ! -e "$__qaap_d/.git" ]; do __qaap_d=${__qaap_d%/*}; done;',
    'if [ -n "$__qaap_d" ]; then __qaap_p=${__qaap_d##*/}${PWD#"$__qaap_d"};',
    'elif [ "$PWD" = "${HOME-}" ]; then __qaap_p="~";',
    'elif [ -n "${HOME-}" ] && [ "${PWD#"${HOME}"/}" != "$PWD" ]; then __qaap_p="~/${PWD#"${HOME}"/}";',
    'else __qaap_p=${PWD##*/}; [ -n "$__qaap_p" ] || __qaap_p=/; fi;',
    'fi;',
    // Minimal colour: bold green label, reset, then `$` (or `#` for root) as the standard PS1 escape.
    'PS1=\'\\[\\e[1;32m\\]${__qaap_p}\\[\\e[0m\\] \\$ \'',
].join(' ');

/** Options for {@link buildTerminalPromptEnv}. */
export interface TerminalPromptEnvOptions {
    /** Shell executable as chosen by the terminal (e.g. `/bin/bash`). */
    readonly shellPath: string;
    /** Arguments the terminal passes to the shell. `-c` marks a managed, non-interactive command. */
    readonly shellArgs: readonly string[];
    /** Terminal working directory on the backend (host path). */
    readonly cwd: string;
    /** Existence check, injectable for tests. Defaults to `fs.existsSync`. */
    readonly pathExists?: (candidate: string) => boolean;
}

/**
 * Nearest ancestor of `cwd` (inclusive) that holds a `.git` marker, or `undefined` outside a repository.
 * Pure filesystem walk, so it costs a few `stat` calls and never spawns git.
 */
export function resolveTerminalRepoRoot(cwd: string, pathExists: (candidate: string) => boolean = fs.existsSync): string | undefined {
    let current = path.normalize(cwd);
    for (;;) {
        if (pathExists(path.join(current, GIT_MARKER))) {
            return current;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}

/**
 * Environment that gives an interactive terminal a short, readable prompt (no user, host or container id).
 *
 * - bash: `PROMPT_COMMAND` installs {@link QAAP_BASH_PROMPT_COMMAND}, which sets PS1 before each prompt.
 *   Setting `PROMPT_COMMAND` (not a static PS1) is required because login startup files such as
 *   `/etc/bash.bashrc` overwrite PS1 after the environment is applied.
 * - sh / dash: a static PS1 with the repository name (or cwd basename). Name characters outside
 *   `[A-Za-z0-9._-]` are replaced, so the static value needs no escaping.
 * - Any other shell (zsh uses PROMPT, not PS1) and managed `-c` commands: no change, `{}` is returned.
 *
 * The result never contains the cwd or any login/host name, and never changes HOME or the cwd.
 */
export function buildTerminalPromptEnv(options: TerminalPromptEnvOptions): Record<string, string> {
    if (options.shellArgs.includes('-c')) {
        return {};
    }
    const shellName = path.basename(options.shellPath);
    if (shellName === 'bash') {
        return { PROMPT_COMMAND: QAAP_BASH_PROMPT_COMMAND };
    }
    if (shellName === 'sh' || shellName === 'dash') {
        return { PS1: `${staticPromptName(options)} $ ` };
    }
    return {};
}

function staticPromptName(options: TerminalPromptEnvOptions): string {
    const root = resolveTerminalRepoRoot(options.cwd, options.pathExists);
    const base = path.basename(root ?? options.cwd) || 'workspace';
    return base.replace(/[^A-Za-z0-9._-]/g, '_');
}

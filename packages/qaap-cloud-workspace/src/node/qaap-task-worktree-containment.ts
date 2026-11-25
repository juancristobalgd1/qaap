// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { nls } from '@theia/core/lib/common/nls';
import { mapQaapToolKind } from '@theia/qaap-shared-core/lib/common/qaap-harness-capabilities';
import type { QaapToolKind } from '@theia/qaap-shared-core/lib/common/qaap-tool-gate-protocol';
import { resolveQaapParallelRoot, resolveQaapWorktreesRoot } from '@theia/qaap-adapters/lib/common/qaap-user-isolation';

/** Input keys that name the file a write/edit tool changes (OpenCode, Claude Code, Codex, Pi, generic). */
const WRITE_PATH_KEYS = ['filePath', 'file_path', 'notebook_path', 'notebookPath', 'path', 'target_file', 'targetFile'] as const;

/** Codex `apply_patch` envelope headers and unified-diff file headers. */
const PATCH_ENVELOPE_RE = /^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm;
const UNIFIED_DIFF_HEADER_RE = /^(?:\+\+\+|---) (?:[ab]\/)?([^\t\n]+)/gm;

/** Shell word separators for the lexical path scan (quotes are separators too, so quoted paths are seen). */
const SHELL_SPLIT_RE = /[\s'"`;|&<>(){}[\],:=]+/;

/** Device files every shell command may name. */
const ALLOWED_DEVICE_PATHS = new Set(['/dev/null', '/dev/stdin', '/dev/stdout', '/dev/stderr', '/dev/tty', '/dev/zero', '/dev/random', '/dev/urandom']);

/**
 * System locations a shell command may name to run or read tools (`/usr/bin/env node`, `/bin/sh`). Only the
 * shell scan exempts them; a write/edit tool is never allowed there.
 */
const SHELL_SYSTEM_PREFIXES = [
    '/usr', '/bin', '/sbin', '/opt', '/etc', '/System', '/Library', '/Applications', '/nix', '/proc', '/sys', '/dev',
    '/private/etc',
];

/**
 * Keeps a task that runs in its own git worktree inside that worktree. A Qaap worktree is a linked
 * checkout (its `.git` is a file that points at the base repository), so an agent can find the base
 * checkout and edit it, defeating "Start clean" and leaking a task's edits into the user's tree. Write
 * and edit tools may only target the worktree (plus scratch space); a shell command naming a path outside
 * it is not auto-approved. Reads are not restricted here.
 *
 * Shared-tree tasks (the workspace is the project root) are never checked: {@link isIsolatedWorktree} is false.
 */
export class QaapTaskWorktreeContainment {

    /** True when `workspace` is a Qaap-managed linked worktree (under the worktrees root, `.git` is a file). */
    isIsolatedWorktree(workspace: string | undefined): boolean {
        if (typeof workspace !== 'string' || !workspace || !path.isAbsolute(workspace)) {
            return false;
        }
        try {
            if (!fs.lstatSync(path.join(workspace, '.git')).isFile()) {
                return false;
            }
        } catch {
            return false;
        }
        const real = this.realpathNearest(workspace);
        return this.worktreeRoots().some(root => this.isInside(this.realpathNearest(root), real));
    }

    /**
     * Paths a write or edit tool call changes: the usual file-path keys plus every file header of a patch
     * found in any top-level string (or string array) input. Other tool kinds return none, except a
     * notebook edit, which Claude Code names `NotebookEdit` (mapped to `other`).
     */
    writeTargets(rawToolName: string, toolKind: QaapToolKind, input: Record<string, unknown>): string[] {
        if (toolKind !== 'edit' && toolKind !== 'write' && !/notebook/i.test(rawToolName)) {
            return [];
        }
        const targets: string[] = [];
        for (const key of WRITE_PATH_KEYS) {
            const value = input[key];
            if (typeof value === 'string' && value.trim()) {
                targets.push(value.trim());
            }
        }
        for (const value of Object.values(input)) {
            const texts = typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
            for (const text of texts) {
                targets.push(...this.patchTargets(text));
            }
        }
        return targets;
    }

    /** File paths named by a Codex `apply_patch` envelope or unified-diff headers in `text`. */
    patchTargets(text: string): string[] {
        if (!text.includes('*** ') && !text.includes('+++ ') && !text.includes('--- ')) {
            return [];
        }
        const targets: string[] = [];
        for (const re of [PATCH_ENVELOPE_RE, UNIFIED_DIFF_HEADER_RE]) {
            for (const match of text.matchAll(re)) {
                const target = match[1].trim();
                if (target && target !== '/dev/null') {
                    targets.push(target);
                }
            }
        }
        return targets;
    }

    /**
     * Lexical scan of a shell command for paths that may leave `cwd`: absolute paths (whose top-level
     * directory exists, so `/pattern/` regexes are skipped), `~` / `$HOME` paths and paths with a `..`
     * segment. Quoted strings are scanned too, so `node -e "fs.writeFileSync('/x')"` is seen. Returns
     * absolute paths; system tool locations are left out.
     */
    shellTargets(command: string | undefined, cwd: string): string[] {
        if (typeof command !== 'string' || !command.trim()) {
            return [];
        }
        const home = os.homedir();
        const targets = new Set<string>();
        for (const word of command.split(SHELL_SPLIT_RE)) {
            if (!word) {
                continue;
            }
            let target: string | undefined;
            if (word.startsWith('/')) {
                const top = word.split('/')[1];
                if (word.startsWith('//') || !top || !fs.existsSync(`/${top}`)) {
                    continue;
                }
                target = path.resolve(word);
            } else if (word === '~' || word.startsWith('~/')) {
                target = path.join(home, word.slice(1));
            } else if (/^\$(?:HOME|\{HOME\})(?:\/|$)/.test(word)) {
                target = path.join(home, word.replace(/^\$(?:HOME|\{HOME\})/, ''));
            } else if (word.split('/').includes('..')) {
                target = path.resolve(cwd, word);
            }
            if (target && !this.isShellSystemPath(target)) {
                targets.add(target);
            }
        }
        return [...targets];
    }

    /**
     * First of `targets` (relative to `cwd`) whose real location is outside `workspace` and outside the
     * scratch areas, or `undefined`. Symlinks are resolved on the nearest existing ancestor (and on a
     * dangling link), and the workspace is compared by its real path too (`/var` vs `/private/var`).
     */
    findOutside(targets: readonly string[], cwd: string, workspace: string): string | undefined {
        if (targets.length === 0) {
            return undefined;
        }
        const realWorkspace = this.realpathNearest(workspace);
        for (const target of targets) {
            const expanded = target === '~' || target.startsWith('~/') ? path.join(os.homedir(), target.slice(1)) : target;
            const absolute = path.resolve(cwd, expanded);
            if (ALLOWED_DEVICE_PATHS.has(absolute) || absolute.startsWith('/dev/fd/')) {
                continue;
            }
            const real = this.realpathNearest(absolute);
            if (this.isInside(realWorkspace, real) || this.isScratchPath(real)) {
                continue;
            }
            return target;
        }
        return undefined;
    }

    /** Denial for a write/edit tool call whose target leaves the worktree, or `undefined`. */
    findWriteEscape(rawToolName: string, toolKind: QaapToolKind | undefined, input: Record<string, unknown>, cwd: string, workspace: string): string | undefined {
        const kind = toolKind ?? mapQaapToolKind(rawToolName);
        const outside = this.findOutside(this.writeTargets(rawToolName, kind, input), cwd, workspace);
        return outside === undefined ? undefined : this.outsideReason(outside, workspace);
    }

    /** Denial for a shell command that names a path outside the worktree, or `undefined`. */
    findShellEscape(command: string | undefined, cwd: string, workspace: string): string | undefined {
        const outside = this.findOutside(this.shellTargets(command, cwd), cwd, workspace);
        return outside === undefined ? undefined : this.outsideReason(outside, workspace);
    }

    /** What the agent is told: the path is outside the task worktree, and what to do instead. */
    outsideReason(target: string, workspace: string): string {
        return nls.localize(
            'theia/qaap-cloud-workspace/toolGateOutsideWorktree',
            '{0} is outside the task worktree ({1}). This task runs in an isolated git worktree: read and change files only inside it, '
            + 'never in the parent repository its .git file points to. If files you expected are missing from the worktree, stop and report it to the user.',
            target,
            workspace,
        );
    }

    /** Roots under which Qaap creates task worktrees (one per tenant and task below them). */
    protected worktreeRoots(): string[] {
        return [resolveQaapWorktreesRoot(), resolveQaapParallelRoot()];
    }

    /** Scratch space any task may write: `/tmp` and the OS temp dir (which also holds the gate's own overlays). */
    protected scratchRoots(): string[] {
        return ['/tmp', os.tmpdir()];
    }

    /** Inside a scratch root but never inside a worktree root: other tasks' worktrees live in the temp dir. */
    protected isScratchPath(real: string): boolean {
        if (this.worktreeRoots().some(root => this.isInside(this.realpathNearest(root), real))) {
            return false;
        }
        return this.scratchRoots().some(root => this.isInside(this.realpathNearest(root), real));
    }

    protected isShellSystemPath(absolute: string): boolean {
        const real = this.realpathNearest(absolute);
        return SHELL_SYSTEM_PREFIXES.some(prefix => this.isInside(prefix, absolute) || this.isInside(prefix, real));
    }

    protected isInside(root: string, target: string): boolean {
        const relative = path.relative(root, target);
        return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
    }

    /**
     * Real path of `target`: the nearest existing ancestor is resolved with `realpath`, the missing rest is
     * appended. A dangling symlink on the way is followed through its link text (bounded), so a new file
     * written through a link that points outside is still seen as outside.
     */
    realpathNearest(target: string, depth = 0): string {
        const absolute = path.resolve(target);
        const rest: string[] = [];
        let current = absolute;
        for (;;) {
            try {
                return path.join(fs.realpathSync.native(current), ...rest.reverse());
            } catch {
                // fall through
            }
            if (depth < 32) {
                try {
                    if (fs.lstatSync(current).isSymbolicLink()) {
                        const linked = path.resolve(path.dirname(current), fs.readlinkSync(current));
                        return this.realpathNearest(path.join(linked, ...[...rest].reverse()), depth + 1);
                    }
                } catch {
                    // missing: walk up
                }
            }
            const parent = path.dirname(current);
            if (parent === current) {
                return absolute;
            }
            rest.push(path.basename(current));
            current = parent;
        }
    }
}

export namespace QaapTaskWorktreeContainment {
    /** Shared stateless instance. */
    export const shared = new QaapTaskWorktreeContainment();
}

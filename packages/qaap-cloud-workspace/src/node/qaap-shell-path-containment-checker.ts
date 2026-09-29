// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';

const GLOB_CHARS_RE = /[*?[]/;

/**
 * Filesystem half of the read-only shell auto-approval: the classifier only checks paths lexically,
 * so a symlink inside the workspace (`docs -> ~`) could still point a "read-only" command at files
 * outside it. Resolves every path argument the way the shell would (symlinks followed, `..` applied
 * to the physical directory) and reports the first one that ends outside the task cwd.
 */
export class QaapShellPathContainmentChecker {

    /** Returns a reason when a path escapes `cwd` (or cannot be verified); `undefined` when all stay inside. */
    check(cwd: string, paths: readonly string[]): string | undefined {
        let root: string;
        try {
            root = fs.realpathSync(cwd);
        } catch {
            return 'working directory not resolvable';
        }
        for (const candidate of paths) {
            const resolved = this.resolvePhysical(root, candidate);
            if (!resolved || !this.isInside(root, resolved)) {
                return `path leaves the working directory: ${candidate}`;
            }
        }
        return undefined;
    }

    /**
     * Walks `candidate` one segment at a time from `root` (or from the filesystem root when absolute),
     * resolving symlinks after every existing segment. Stops at the first glob segment (its matches
     * live in the directory reached so far) or the first missing one (nothing below it can be a link).
     */
    protected resolvePhysical(root: string, candidate: string): string | undefined {
        const normalized = candidate.replace(/\\/g, '/');
        const absolute = path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized);
        let current = absolute ? path.parse(path.resolve(normalized)).root : root;
        for (const segment of normalized.split('/')) {
            if (!segment || segment === '.' || (absolute && /^[A-Za-z]:$/.test(segment))) {
                continue;
            }
            if (GLOB_CHARS_RE.test(segment)) {
                break;
            }
            current = segment === '..' ? path.dirname(current) : path.join(current, segment);
            if (!this.exists(current)) {
                break;
            }
            try {
                current = fs.realpathSync(current);
            } catch {
                return undefined;
            }
        }
        return current;
    }

    protected isInside(root: string, target: string): boolean {
        const relative = path.relative(root, target);
        return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    }

    protected exists(target: string): boolean {
        try {
            fs.lstatSync(target);
            return true;
        } catch {
            return false;
        }
    }
}

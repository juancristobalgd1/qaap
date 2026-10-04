// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';

/** Where a previous build published the user's GitHub token for the agent uid (removed, see doc/qaap-github-token-boundary.md). */
export const QAAP_LEGACY_GIT_CREDENTIAL_DIR = '/tmp/qaap-git-credential';

/**
 * Deletes the GitHub credential an older tenant backend may have left on the container's `/tmp`.
 * Its expiry was an in-memory timer, so after a restart the raw token stayed readable there. Runs on
 * every backend start. Only a real directory owned by this backend is touched: an entry an agent
 * planted (a symlink, a directory of its own) is never followed, and nothing outside it is removed.
 */
@injectable()
export class QaapLegacyGitCredentialCleanup implements BackendApplicationContribution {

    initialize(): void {
        try {
            if (this.removeLegacyCredential(this.legacyDirectory())) {
                console.info('[qaap-security] removed a GitHub credential left by an earlier build');
            }
        } catch (error) {
            console.warn(`[qaap-security] could not remove the legacy git credential: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    protected legacyDirectory(): string {
        return QAAP_LEGACY_GIT_CREDENTIAL_DIR;
    }

    /** True when the directory existed and was removed. */
    removeLegacyCredential(directory: string): boolean {
        const stat = this.lstatIfExists(directory);
        const self = process.getuid?.();
        if (!stat || !stat.isDirectory() || (self !== undefined && stat.uid !== self)) {
            return false;
        }
        for (const name of fs.readdirSync(directory)) {
            const entry = path.join(directory, name);
            if (this.lstatIfExists(entry)?.isFile()) {
                this.blank(entry);
            }
            fs.rmSync(entry, { force: true, recursive: false });
        }
        fs.rmdirSync(directory);
        return true;
    }

    /** Best effort: drop the content before the name, never through a symlink. */
    protected blank(file: string): void {
        let descriptor: number | undefined;
        try {
            descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW);
            fs.ftruncateSync(descriptor, 0);
        } catch {
            // An agent-owned 0600 file cannot be opened without CAP_DAC_OVERRIDE; unlinking still works.
        } finally {
            if (descriptor !== undefined) {
                fs.closeSync(descriptor);
            }
        }
    }

    protected lstatIfExists(file: string): fs.Stats | undefined {
        try {
            return fs.lstatSync(file);
        } catch {
            return undefined;
        }
    }
}

// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import { QaapGitCredentialFile, QaapGitCredentialLookup } from './qaap-tenant-git-credential';

/**
 * Runs inside a tenant container (terminal, agent turn) without the backend's DI container:
 * - `get` is a git credential helper (`git config --system credential.https://github.com.helper`):
 *   answers `https://github.com` with the user's published token, stays silent otherwise so git
 *   falls back to its usual prompt/helpers. `store`/`erase` are ignored (the file is not git's).
 * - `gh …` runs the real GitHub CLI with `GH_TOKEN` from the same credential (installed as `gh`).
 */
export const QAAP_GH_BIN_ENV = 'QAAP_GH_BIN';
export const QAAP_GH_DEFAULT_BIN = '/usr/local/lib/qaap-gh/bin/gh';

const EXPIRED_HINT = 'qaap: the GitHub sign-in shared with this project expired. Open Qaap in the browser (or call its API) to renew it.';

export interface QaapGitCredentialCliIo {
    readonly stdin: string;
    readonly env: NodeJS.ProcessEnv;
    readonly now: number;
    writeStdout(text: string): void;
    writeStderr(text: string): void;
}

export namespace QaapGitCredentialCli {

    /** Git credential protocol: `key=value` lines. Only https://github.com is answered. */
    export function get(io: QaapGitCredentialCliIo): void {
        const fields = new Map<string, string>();
        for (const line of io.stdin.split('\n')) {
            const separator = line.indexOf('=');
            if (separator > 0) {
                fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
            }
        }
        if (fields.get('protocol') !== 'https' || fields.get('host')?.toLowerCase() !== 'github.com') {
            return;
        }
        const lookup = lookupCredential(io);
        if (lookup.kind === 'valid') {
            io.writeStdout(`username=x-access-token\npassword=${lookup.record.token}\n`);
        }
    }

    /** Environment for the real `gh`: an explicit GH_TOKEN/GITHUB_TOKEN set by the user wins. */
    export function ghEnvironment(io: QaapGitCredentialCliIo): NodeJS.ProcessEnv {
        if (io.env.GH_TOKEN || io.env.GITHUB_TOKEN) {
            return io.env;
        }
        const lookup = lookupCredential(io);
        return lookup.kind === 'valid' ? { ...io.env, GH_TOKEN: lookup.record.token } : io.env;
    }

    function lookupCredential(io: QaapGitCredentialCliIo): QaapGitCredentialLookup {
        const lookup = QaapGitCredentialFile.read(QaapGitCredentialFile.resolvePath(io.env), io.now);
        if (lookup.kind === 'expired') {
            io.writeStderr(`${EXPIRED_HINT}\n`);
        }
        return lookup;
    }

    export function main(argv: readonly string[]): number {
        const [command, ...rest] = argv;
        const io: QaapGitCredentialCliIo = {
            stdin: command === 'get' ? readStdin() : '',
            env: process.env,
            now: Date.now(),
            writeStdout: text => process.stdout.write(text),
            writeStderr: text => process.stderr.write(text),
        };
        if (command === 'get') {
            get(io);
            return 0;
        }
        if (command === 'gh') {
            const result = spawnSync(io.env[QAAP_GH_BIN_ENV]?.trim() || QAAP_GH_DEFAULT_BIN, rest, { stdio: 'inherit', env: ghEnvironment(io) });
            if (result.error) {
                io.writeStderr(`qaap: could not run gh: ${result.error.message}\n`);
                return 127;
            }
            return result.status ?? 1;
        }
        // store / erase / unknown: nothing to do.
        return 0;
    }

    function readStdin(): string {
        try {
            return fs.readFileSync(0, 'utf8');
        } catch {
            return '';
        }
    }
}

if (require.main === module) {
    process.exitCode = QaapGitCredentialCli.main(process.argv.slice(2));
}

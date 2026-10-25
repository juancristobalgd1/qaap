// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as path from 'path';
import {
    QAAP_BASH_PROMPT_COMMAND,
    buildTerminalPromptEnv,
    resolveTerminalRepoRoot,
} from './qaap-terminal-prompt';

/** Fake filesystem: only the listed paths exist. */
const existingOnly = (...paths: string[]) => (candidate: string): boolean => paths.includes(candidate);

describe('terminal prompt environment', () => {

    describe('resolveTerminalRepoRoot', () => {
        const repo = path.normalize('/workspace/repos/users/alice/alice/traductor');

        it('returns the repository itself when the cwd is its root', () => {
            expect(resolveTerminalRepoRoot(repo, existingOnly(path.join(repo, '.git')))).to.equal(repo);
        });

        it('walks up from a subdirectory to the nearest .git marker', () => {
            const cwd = path.join(repo, 'src', 'components');
            expect(resolveTerminalRepoRoot(cwd, existingOnly(path.join(repo, '.git')))).to.equal(repo);
        });

        it('accepts a .git file (linked worktree) as the marker', () => {
            const worktree = path.normalize('/workspace/worktrees/alice/traductor-task');
            expect(resolveTerminalRepoRoot(worktree, existingOnly(path.join(worktree, '.git')))).to.equal(worktree);
        });

        it('prefers the nearest repository when repositories are nested', () => {
            const inner = path.join(repo, 'vendor', 'lib');
            const exists = existingOnly(path.join(repo, '.git'), path.join(inner, '.git'));
            expect(resolveTerminalRepoRoot(path.join(inner, 'src'), exists)).to.equal(inner);
        });

        it('returns undefined outside any repository', () => {
            expect(resolveTerminalRepoRoot('/home/qaap-agent/notes', existingOnly())).to.be.undefined;
        });
    });

    describe('buildTerminalPromptEnv', () => {
        const cwd = path.normalize('/workspace/repos/users/alice/alice/traductor/src');
        const repo = path.normalize('/workspace/repos/users/alice/alice/traductor');
        const exists = existingOnly(path.join(repo, '.git'));

        it('sets PROMPT_COMMAND for bash interactive shells and leaves PS1 to that hook', () => {
            const env = buildTerminalPromptEnv({ shellPath: '/bin/bash', shellArgs: ['-l'], cwd, pathExists: exists });
            expect(Object.keys(env)).to.deep.equal(['PROMPT_COMMAND']);
            expect(env.PROMPT_COMMAND).to.equal(QAAP_BASH_PROMPT_COMMAND);
        });

        it('matches bash by basename so a bare `bash` on PATH also gets the hook', () => {
            const env = buildTerminalPromptEnv({ shellPath: 'bash', shellArgs: [], cwd, pathExists: exists });
            expect(env.PROMPT_COMMAND).to.equal(QAAP_BASH_PROMPT_COMMAND);
        });

        it('never embeds the cwd, user or host in the env values', () => {
            const env = buildTerminalPromptEnv({ shellPath: '/bin/bash', shellArgs: ['-l'], cwd, pathExists: exists });
            const values = Object.values(env).join('\n');
            expect(values).to.not.include('/workspace');
            expect(values).to.not.include('alice');
            expect(values).to.not.include('traductor');
        });

        it('gives sh/dash a static PS1 named after the repository root', () => {
            expect(buildTerminalPromptEnv({ shellPath: '/bin/sh', shellArgs: ['-l'], cwd, pathExists: exists }))
                .to.deep.equal({ PS1: 'traductor $ ' });
            expect(buildTerminalPromptEnv({ shellPath: 'dash', shellArgs: [], cwd, pathExists: exists }))
                .to.deep.equal({ PS1: 'traductor $ ' });
        });

        it('falls back to the cwd basename for sh outside a repository', () => {
            const outside = '/home/qaap-agent/notes';
            expect(buildTerminalPromptEnv({ shellPath: '/bin/sh', shellArgs: [], cwd: outside, pathExists: existingOnly() }))
                .to.deep.equal({ PS1: 'notes $ ' });
        });

        it('replaces characters that are special in prompts when naming a static PS1', () => {
            const hostile = '/workspace/repos/users/alice/alice/$(id)`x`';
            const env = buildTerminalPromptEnv({ shellPath: '/bin/sh', shellArgs: [], cwd: hostile, pathExists: existingOnly() });
            expect(env.PS1).to.equal('__id__x_ $ ');
        });

        it('adds nothing for managed `-c` commands (project bootstrap, preview install)', () => {
            expect(buildTerminalPromptEnv({ shellPath: '/bin/bash', shellArgs: ['-l', '-c', 'npm install'], cwd, pathExists: exists }))
                .to.deep.equal({});
        });

        it('adds nothing for shells that do not read PS1 or PROMPT_COMMAND (zsh)', () => {
            expect(buildTerminalPromptEnv({ shellPath: '/bin/zsh', shellArgs: ['-l'], cwd, pathExists: exists }))
                .to.deep.equal({});
        });
    });

    describe('QAAP_BASH_PROMPT_COMMAND', () => {
        it('uses only bash builtins: no git process, no command substitution', () => {
            expect(QAAP_BASH_PROMPT_COMMAND).to.not.match(/\bgit\s/);
            expect(QAAP_BASH_PROMPT_COMMAND).to.not.include('$(');
            expect(QAAP_BASH_PROMPT_COMMAND).to.not.include('`');
        });

        it('recomputes only when the working directory changed', () => {
            expect(QAAP_BASH_PROMPT_COMMAND.startsWith('if [ "$PWD" != "${__qaap_last-}" ]; then')).to.be.true;
        });

        it('reads the label through a variable so directory names are never expanded in PS1', () => {
            expect(QAAP_BASH_PROMPT_COMMAND).to.include('PS1=\'\\[\\e[1;32m\\]${__qaap_p}\\[\\e[0m\\] \\$ \'');
        });

        it('keeps the if/fi blocks balanced', () => {
            const opens = QAAP_BASH_PROMPT_COMMAND.match(/\bif \[/g)?.length ?? 0;
            const closes = QAAP_BASH_PROMPT_COMMAND.match(/\bfi;/g)?.length ?? 0;
            expect(opens).to.equal(2);
            expect(closes).to.equal(2);
        });
    });
});

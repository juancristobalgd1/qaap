// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import * as fs from 'fs';
import { QaapNeutralGit } from './qaap-neutral-git';

describe('QaapNeutralGit', () => {

    it('switches the user-level config off', () => {
        const env = QaapNeutralGit.env({ PATH: '/bin', HOME: '/home/agent' });
        expect(env).to.include({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_ATTR_NOSYSTEM: '1', PATH: '/bin' });
        expect(QaapNeutralGit.isNeutral(env)).to.equal(true);
        expect(QaapNeutralGit.isNeutral({ PATH: '/bin' })).to.equal(false);
    });

    it('drops inherited variables that redirect git or name a program', () => {
        const env = QaapNeutralGit.env({
            PATH: '/bin', GIT_DIR: '/x', GIT_WORK_TREE: '/y', GIT_INDEX_FILE: '/z', GIT_OBJECT_DIRECTORY: '/o',
            GIT_ALTERNATE_OBJECT_DIRECTORIES: '/a', GIT_NAMESPACE: 'n', GIT_CEILING_DIRECTORIES: '/c', LD_PRELOAD: '/evil.so',
            GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.pager', GIT_CONFIG_VALUE_0: 'x', GIT_EXTERNAL_DIFF: 'x', GIT_SSH_COMMAND: 'x',
        });
        expect(Object.keys(env).sort()).to.have.members(['GIT_ATTR_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT', 'PATH']);
    });

    it('keeps a deliberate GIT_INDEX_FILE (the throwaway index) even though an inherited one is dropped', () => {
        const env = QaapNeutralGit.env({ GIT_INDEX_FILE: '/inherited' }, { GIT_INDEX_FILE: '/scratch' });
        expect(env.GIT_INDEX_FILE).to.equal('/scratch');
    });

    it('forwards only the neutralization variables to a tenant transport', () => {
        const env = QaapNeutralGit.env({ PATH: '/bin', SECRET: 'x' });
        expect(Object.keys(QaapNeutralGit.forwardedEnv(env)!).sort()).to.deep.equal(['GIT_ATTR_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_TERMINAL_PROMPT']);
        expect(QaapNeutralGit.forwardedEnv({ PATH: '/bin' })).to.equal(undefined);
    });

    it('pins no-recursion, no-ignore-file and safe.directory on the command line', () => {
        const args = QaapNeutralGit.ARGS.join(' ');
        for (const pin of ['diff.ignoreSubmodules=all', 'submodule.recurse=false', 'status.submoduleSummary=false', 'core.excludesFile=/dev/null', 'safe.directory=*']) {
            expect(args).to.contain(pin);
        }
    });

    describe('on win32', () => {
        it('never hands git the os.devNull device path or `/dev/null` as a config or ignore file: a real empty file instead', () => {
            const env = QaapNeutralGit.env({ PATH: 'C:\\Windows' }, undefined, 'win32');
            const empty = env.GIT_CONFIG_GLOBAL!;
            expect(empty).to.not.equal('/dev/null');
            expect(empty).to.not.contain('\\');
            expect(fs.existsSync(empty)).to.equal(true);
            expect(fs.statSync(empty).size).to.equal(0);
            expect(QaapNeutralGit.isNeutral(env)).to.equal(true);

            const args = QaapNeutralGit.args('win32');
            expect(args).to.include(`core.attributesFile=${empty}`);
            expect(args).to.include(`core.excludesFile=${empty}`);
            expect(args.filter(arg => arg.startsWith('core.attributesFile=') || arg.startsWith('core.excludesFile='))
                .some(arg => arg.includes('/dev/null'))).to.equal(false);
            // the one that already worked on Windows before this module
            expect(args).to.include('core.hooksPath=/dev/null');
        });

        it('keeps /dev/null on POSIX, where every tenant transport (including a docker worker) understands it', () => {
            expect(QaapNeutralGit.nullFile('linux')).to.equal('/dev/null');
            expect(QaapNeutralGit.nullFile('darwin')).to.equal('/dev/null');
        });
    });
});

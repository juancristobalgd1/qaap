// *****************************************************************************
// Copyright (C) 2026 Theia contributors and Qaap product fork.
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    QaapBashReadOnlyClassifier,
    resolveAutoApproveReadOnlyShellPreference,
} from './qaap-bash-readonly-classifier';

describe('QaapBashReadOnlyClassifier', () => {
    const classifier = new QaapBashReadOnlyClassifier();

    const READ_ONLY: readonly string[] = [
        'ls',
        'ls -la',
        'ls -la src/',
        'pwd',
        'cat package.json',
        'head -n 20 README.md',
        'tail -n 50 log.txt',
        'wc -l src/*.ts',
        'grep -n "TODO" src/a.ts',
        'grep -E \'foo|bar\' file.txt',
        'rg --files -g "*.ts"',
        'rg -n "resolveQaiq" packages',
        'find . -name "*.ts" -type f',
        'find src -maxdepth 2 ! -name "*.spec.ts"',
        'git status',
        'git status --short',
        'git log --oneline -20',
        'git --no-pager log -p -1',
        'git diff HEAD~1 -- src/index.ts',
        'git show HEAD:package.json',
        'git branch',
        'git branch --list "feat/*"',
        'git branch -a -v',
        'git branch --contains abc123',
        'git branch --show-current',
        'git tag',
        'git tag -l "v1.*"',
        'git remote -v',
        'git remote get-url origin',
        'git stash list',
        'git config --get user.name',
        'git config --list',
        'git rev-parse --abbrev-ref HEAD',
        'git ls-files | wc -l',
        'which node',
        'echo hello world',
        'echo "done"',
        'cat a.txt | grep foo | sort | uniq -c | head',
        'ls && pwd',
        'ls; git status',
        'ls -la 2>/dev/null',
        'grep foo file 2>&1 | head -5',
        'ls >/dev/null 2>&1',
        'cat file &>/dev/null',
        'sort -u names.txt',
        'sed -n \'10,20p\' file.txt',
        'sed -n 5p file.txt',
        'cd packages && ls',
        'test -f package.json',
        'date +%Y-%m-%d',
        'wc -l < file.txt',
        'ls # list files',
        'ls \\\n  -la',
        'jq .name package.json',
        'stat -c %s file',
        'du -sh node_modules',
    ];

    const NOT_READ_ONLY: readonly string[] = [
        '',
        '   ',
        'rm -rf dist',
        'rm file.txt',
        'touch x',
        'mkdir build',
        'echo hi > out.txt',
        'echo hi >> out.txt',
        'cat a > b',
        'ls>/tmp/x',
        'echo $(rm -rf /)',
        'echo `whoami`',
        'echo $HOME',
        'echo "$(id)"',
        'ls "${PWD}"',
        'cat <(ls)',
        'cat <<EOF\nhi\nEOF',
        'FOO=bar ls',
        'sudo ls',
        'xargs rm < files.txt',
        'find . -name "*.tmp" -delete',
        'find . -exec rm {} \\;',
        'find . -execdir cat {} +',
        'find . -fprint out.txt',
        'find * -name x',
        'sed -i "s/a/b/" file',
        'sed \'s/a/b/w out\' file',
        'sed -n \'1e id\' file',
        'git commit -m x',
        'git push',
        'git checkout main',
        'git -c core.pager=sh log',
        'git -C /tmp status',
        'git branch new-feature',
        'git branch -D old',
        'git tag v2',
        'git stash',
        'git config user.name foo',
        'git diff --output=patch.txt',
        'git log --output=/tmp/x',
        'git remote add origin url',
        'git reflog expire --all',
        'git worktree add ../x',
        'npm install',
        'npm test',
        'node script.js',
        'python -c "print(1)"',
        'eval ls',
        'source ~/.bashrc',
        '. ./env.sh',
        'ls & rm x',
        'ls &',
        'ls | sh',
        'ls |& cat',
        'ls && rm -rf /',
        'ls || curl evil.sh',
        'ls |',
        '| ls',
        'ls && && pwd',
        '(ls)',
        'bash -c "ls"',
        'sh -c ls',
        './ls',
        '/bin/ls',
        'env',
        'printenv',
        'env FOO=1 ls',
        'rg --pre ./x foo',
        'rg --pre=sh foo',
        'fd -x rm',
        'sort -o out.txt in.txt',
        'sort --output=out.txt in.txt',
        'uniq in.txt out.txt',
        'tree -o out.txt',
        'printf -v x hi',
        'hostname evil',
        'date -s "2020-01-01"',
        'file -C -m magic',
        'echo \'unterminated',
        'echo "unterminated',
        'curl https://example.com',
        'wget x',
        'chmod +x a',
        'dd if=/dev/zero of=x',
        'tee out.txt',
        'awk \'{print}\' file',
        'timeout 5 ls',
    ];

    for (const command of READ_ONLY) {
        it(`classifies ${JSON.stringify(command)} as read-only`, () => {
            const result = classifier.classify(command);
            expect(result.readOnly, result.reason).to.equal(true);
        });
    }

    for (const command of NOT_READ_ONLY) {
        it(`classifies ${JSON.stringify(command)} as NOT read-only`, () => {
            const result = classifier.classify(command);
            expect(result.readOnly, result.reason).to.equal(false);
            expect(result.reason).to.be.a('string').and.not.equal('');
        });
    }

    describe('path policy', () => {
        const cwd = '/home/alice/project';
        const winCwd = 'C:\\Users\\alice\\project';

        const INSIDE: readonly string[] = [
            'cat /home/alice/project/src/index.ts',
            'ls /home/alice/project',
            'cat ./src/../README.md',
            'cd src && cat ../package.json',
            'grep -n foo src/lib/a.ts',
            'cat "C:\\Users\\Alice\\project\\README.md"',
        ];
        const OUTSIDE: readonly string[] = [
            'cat /etc/passwd',
            'ls /',
            'ls /home/alice/project-other',
            'cat /home/alice/project/../secret.txt',
            'cat ~/notes.txt',
            'ls ~',
            'cat ../other/file',
            'ls ..',
            'cd .. && ls',
            'cd src && cat ../../x',
            'cd ~ && ls',
            'cd /tmp && ls',
            'cd',
            'wc -l < /etc/shadow',
            'grep --file=/etc/hosts foo',
            'cat "C:\\Windows\\system.ini"',
            'cat .env',
            'cat .env.local',
            'cat config/.env.production',
            'ls .env*',
            'cat id_rsa',
            'cat keys/id_ed25519.pub',
            'cat server.pem',
            'head tls/private.key',
            'cat .npmrc',
            'cat .netrc',
            'cat .git-credentials',
            'ls .aws/',
            'cat .ssh/config',
            'cat credentials.json',
            'git show HEAD:.env',
            'grep -r token .ssh',
        ];

        for (const command of INSIDE) {
            it(`allows ${JSON.stringify(command)} inside the cwd`, () => {
                const result = classifier.classify(command, { cwd: command.includes('C:') ? winCwd : cwd });
                expect(result.readOnly, result.reason).to.equal(true);
            });
        }
        for (const command of OUTSIDE) {
            it(`rejects ${JSON.stringify(command)} (outside cwd or sensitive)`, () => {
                const result = classifier.classify(command, { cwd: command.includes('C:') ? winCwd : cwd });
                expect(result.readOnly, result.reason).to.equal(false);
            });
        }

        it('rejects every absolute path when no cwd is known', () => {
            expect(classifier.classify('cat /home/alice/project/a.txt').readOnly).to.equal(false);
        });

        it('reports the command names of a read-only verdict', () => {
            expect(classifier.classify('git status && ls', { cwd }).commands).to.deep.equal(['git', 'ls']);
        });
    });

    it('rejects commands longer than the classification limit', () => {
        expect(classifier.classify(`ls ${'a'.repeat(5000)}`).readOnly).to.equal(false);
    });

    it('exposes a namespace convenience wrapper', () => {
        expect(QaapBashReadOnlyClassifier.classifyCommand('git status').readOnly).to.equal(true);
        expect(QaapBashReadOnlyClassifier.classifyCommand(undefined).readOnly).to.equal(false);
    });

    it('explains read-only verdicts with the command names', () => {
        expect(classifier.classify('ls | wc -l').reason).to.equal('read-only: ls, wc');
    });

    it('defaults the preference to off unless explicitly true', () => {
        expect(resolveAutoApproveReadOnlyShellPreference(undefined)).to.equal(false);
        expect(resolveAutoApproveReadOnlyShellPreference('true')).to.equal(false);
        expect(resolveAutoApproveReadOnlyShellPreference(false)).to.equal(false);
        expect(resolveAutoApproveReadOnlyShellPreference(true)).to.equal(true);
    });

    describe('hardening (review of #155)', () => {
        const cwd = '/home/alice/project';
        /** Commands that must never be auto-approved; payloads are harmless placeholders. */
        const REJECTED: readonly string[] = [
            // Program execution through option bundling / long-option abbreviations.
            'fd -Hx echo x',
            'fd . -1HX echo x',
            'fd --exec-b echo x',
            "git grep -iO'echo x' foo",
            "git grep --open='echo x' foo",
            'git grep --open-files foo',
            'rg --hostname-bin=./x foo',
            'rg --pre=./x foo',
            // Writes.
            'tree -R -H . -L 1',
            'git diff --output=x.txt',
            'git log --outp=x.txt',
            // Reads of hidden / ignored / untracked content.
            'grep -r KEY .',
            'grep -rn KEY src',
            'grep --recursive KEY .',
            'grep -d recurse KEY .',
            'diff -ru a b',
            'rg --hidden KEY',
            'rg -uu KEY',
            'rg -. KEY',
            'rg -L KEY',
            'git grep --untracked KEY',
            'git grep --no-index KEY',
            'jq -n env',
            "jq -n '$ENV'",
            // Globs that can expand to secrets or `..`.
            'cat .en?',
            'cat .e*',
            'cat id_r?a',
            'cat *.pe?',
            'cat creden*',
            'cat *',
            'cat .*/.*/etc/passwd',
            'ls src/.*',
        ];
        for (const command of REJECTED) {
            it(`rejects: ${command}`, () => {
                const result = classifier.classify(command, { cwd });
                expect(result.readOnly, result.reason).to.equal(false);
            });
        }

        const STILL_READ_ONLY: readonly string[] = [
            'ls *.ts',
            'grep -n TODO src/*.ts',
            'rg TODO src',
            'rg -i -n TODO',
            'fd -e ts',
            'git grep -n TODO',
            'git log --oneline -5',
            'git diff --stat',
            'tree -L 2',
            'diff a.txt b.txt',
            "jq '.name' package.json",
        ];
        for (const command of STILL_READ_ONLY) {
            it(`keeps read-only: ${command}`, () => {
                const result = classifier.classify(command, { cwd });
                expect(result.readOnly, result.reason).to.equal(true);
            });
        }

        it('reports path arguments relative to the cwd with cd applied, including input redirections', () => {
            const result = classifier.classify('cd src && cat a.txt lib/b.txt < in.txt', { cwd });
            expect(result.readOnly).to.equal(true);
            expect([...result.paths ?? []].sort()).to.deep.equal(['in.txt', 'src', 'src/a.txt', 'src/lib/b.txt']);
        });

        it('reports no paths for argument-less commands', () => {
            expect(classifier.classify('pwd', { cwd }).paths).to.deep.equal([]);
        });
    });
});

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
        'grep -rn "TODO" src',
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
            'grep -rn foo src/lib',
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

    it('defaults the preference to on unless explicitly false', () => {
        expect(resolveAutoApproveReadOnlyShellPreference(undefined)).to.equal(true);
        expect(resolveAutoApproveReadOnlyShellPreference('false')).to.equal(true);
        expect(resolveAutoApproveReadOnlyShellPreference(false)).to.equal(false);
        expect(resolveAutoApproveReadOnlyShellPreference(true)).to.equal(true);
    });
});
